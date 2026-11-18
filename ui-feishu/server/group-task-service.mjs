import { backgroundTaskRoute, employeeTaskRoute, requestedBackgroundRoute } from '../../windows/server/background-tasks/model-policy.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTaskKernel, terminalStates } from '../kernel/task-kernel.mjs';
import { createNativeTaskRuntime } from '../kernel/native-task-runtime.mjs';
import { createTaskTools } from '../kernel/task-tools.mjs';
import { createMessageInbox } from '../kernel/message-inbox.mjs';
import { groupCollaborationText, planGroupCollaboration, routeMessage } from '../kernel/message-routing.mjs';
import { mentionedAgentIds } from '../../windows/server/multi-agent/agent-routing.mjs';
import { inputFromAttachments } from '../../windows/server/app-server-conversation-store.mjs';
import { employeeTurnInstructions } from '../../windows/server/employee-definitions.mjs';
import { basePrompt } from '../../windows/server/base-prompt.mjs';
import { buildDiscussionPrompt } from '../../windows/server/multi-agent/discussion-prompt.mjs';
import { backgroundToolConfig, executionPolicy, turnExecutionPolicy } from './execution-policy.mjs';
import { followupTask } from './task-followup.mjs';
import { transferEmployeeThread } from './employee-provider-integration.mjs';

// Unaddressed messages go to 运营管理 when it is in the group, then negus助手, then the first member.
export const receptionAgentId = members => ['manager', 'negus-assistant'].find(id => members.some(member => member.id === id)) || members[0]?.id;
const clip = (value, length) => String(value || '').trim().slice(0, length);
const taskStatusLabel = state => ({
  queued: '排队中', starting: '启动中', running: '执行中', stopping: '正在停止',
  recovering: '正在恢复', 'needs-reconciliation': '等待核对', completed: '已完成',
  failed: '执行失败', interrupted: '已停止',
}[state] || state || '状态待确认');

export async function migrateGroupAgentThread({
  agent, room, modelProviders, clientFor, transferThread = transferEmployeeThread,
}) {
  const pending = agent?.pendingModelSettings;
  if (!agent?.threadId || !pending || !modelProviders) return agent;
  try {
    const route = modelProviders.resolveRoute({
      modelProviderId: pending.modelProviderId,
      model: pending.model,
    });
    const targetAgent = { ...agent, ...pending, modelProviderId: route.modelProviderId, model: route.model };
    const sourceClient = await clientFor(agent);
    const targetClient = await clientFor(targetAgent);
    await transferThread({
      source: sourceClient,
      target: targetClient,
      providers: modelProviders,
      threadId: agent.threadId,
      route,
      reasoningEffort: pending.reasoningEffort,
      config: pending.reasoningEffort ? { model_reasoning_effort: pending.reasoningEffort } : {},
      instructions: employeeTurnInstructions(agent.instructions),
      policy: executionPolicy,
    });
    await room.updateAgent(agent.id, {
      modelProviderId: route.modelProviderId,
      model: route.model,
      reasoningEffort: pending.reasoningEffort || '',
      modelSelectionSource: pending.modelSelectionSource === 'explicit' ? 'explicit' : 'default',
      pendingModelSettings: null,
    });
    return room.getAgent(agent.id) || targetAgent;
  } catch (error) {
    logMigrationFailure(agent, error);
    return agent;
  }
}

const logMigrationFailure = (agent, error) => {
  console.warn(JSON.stringify({
    scope: 'group-provider-migration',
    agentId: agent?.id || '',
    threadId: agent?.threadId || '',
    event: 'failed',
    error: error instanceof Error ? error.message : String(error),
  }));
};

export async function createGroupTaskService({ stateRoot, room, projectRoot, employeeWorkRoots = {}, modelProviders,
  appServerClient, broadcast = () => {}, attachmentContent, resolveAttachments = () => [], resolveArtifacts = () => [], onContextDelivered = async () => {}, bindings, agentTasks, queue, execution, registerSession, growthService = null, providerForThread = async () => null, transferThread = transferEmployeeThread }) {
  const roomId = room.snapshot().room.id;
  const log = event => console.log(JSON.stringify({ scope: 'negus-tasks', roomId, at: new Date().toISOString(), ...event }));
  let kernel;
  let projection = Promise.resolve();
  const coordinationFor = source => {
    if (!source || source.parentTaskId || source.resultOf
      || ['continuation', 'delegation', 'followup'].includes(source.kind)) return null;
    return source.source?.coordination || null;
  };
  const delegationSource = source => {
    const value = { ...source.source, roomId, agentId: source.agentId,
      actor: { id: source.agentId, name: room.getAgent(source.agentId)?.name || source.agentId } };
    delete value.coordination;
    return value;
  };
  const publishCoordinationPlan = async (plan, message) => {
    if (!plan?.assignments?.length || !message) return null;
    return room.addMessage({
      type: 'agent', authorId: plan.receptionId, authorName: plan.receptionName,
      agentId: plan.receptionId, workId: `coordination:${message.id}`, itemId: `plan:${message.id}`,
      phase: 'commentary', replyTo: { id: message.id }, preserveText: true,
      text: groupCollaborationText(plan),
    });
  };
  const publishCoordinationIfReady = async source => {
    const plan = coordinationFor(source);
    if (!plan?.assignments?.length) return null;
    const children = kernel.list().filter(candidate => candidate.parentTaskId === source.id);
    if (!plan.assignments.every(assignment => children.some(candidate => candidate.agentId === assignment.agentId))) return null;
    const message = source.source?.messageId ? room.getMessage(source.source.messageId) : null;
    return publishCoordinationPlan(plan, message);
  };
  const projectStates = () => {
    projection = projection.catch(() => {}).then(async () => {
      if (!kernel) return;
      const tasks = kernel.list();
      for (const agent of room.snapshot().agents) {
        const pending = tasks.filter(task => task.agentId === agent.id && !terminalStates.has(task.state));
        const selected = pending.find(task => task.state === 'stopping') || pending.find(task => ['running', 'starting', 'recovering', 'needs-reconciliation'].includes(task.state)) || pending[0]
          || tasks.filter(task => task.agentId === agent.id).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
        if (!selected) continue;
        const active = pending.length > 0;
        const phase = !active ? selected.state : selected.state === 'stopping' ? 'stopping' : selected.state === 'queued' ? 'queued' : 'working';
        const label = phase === 'queued' ? '排队中' : phase === 'stopping' ? '正在停止' : selected.state === 'needs-reconciliation' ? '等待核对状态'
          : phase === 'completed' ? '已完成' : phase === 'interrupted' ? '已停止' : phase === 'failed' ? '执行失败' : '正在处理任务';
        const detail = selected.error || '';
        if (agent.active !== active || agent.phase !== phase || agent.label !== label || agent.detail !== detail)
          await room.updateAgent(agent.id, { active, phase, label, detail });
      }
    });
    return projection;
  };
  const clientFor = async agent => modelProviders
    ? modelProviders.getClient(modelProviders.resolveRoute({ modelProviderId: agent.modelProviderId || 'current', model: agent.model || '' }))
    : appServerClient;
  const startupFor = async task => {
    const current = await kernel.waitForStart(task.id, 15000);
    const confirmed = current.state === 'running' || current.state === 'completed';
    const message = confirmed ? '已确认任务开始执行'
      : current.state === 'failed' ? `启动或执行失败：${current.error || '任务未产生错误详情'}`
        : current.state === 'queued' ? '任务已创建，仍在等待调度，尚未确认启动'
          : current.state === 'starting' ? '任务已创建，正在建立执行会话，尚未确认启动'
            : current.state === 'needs-reconciliation' ? '任务已创建，启动响应不确定，正在核对真实状态'
              : `任务已创建，当前状态为 ${current.state || '未知'}，尚未确认正常启动`;
    return { ...current, startup: { confirmed, state: current.state, message,
      threadId: current.runtime?.threadId || '', turnId: current.runtime?.turnId || '',
      modelProviderId: current.runtime?.modelProviderId || current.modelProviderId || '',
      model: current.runtime?.model || current.model || '',
      reasoningEffort: current.runtime?.reasoningEffort || current.reasoningEffort || '',
      routing: current.taskRouting || null,
      error: confirmed ? '' : current.error || message } };
  };
  const routeForTask = async (employee, input) => {
    if (input.modelProviderId || input.model)
      return requestedBackgroundRoute(modelProviders, input, kernel.list());
    return modelProviders && employeeTaskRoute(modelProviders, employee, kernel.list());
  };
  const routingFields = async agentId => {
    const selection = await routeForTask(room.getAgent(agentId), {});
    if (!selection) return {};
    const reasoningEffort = selection.reasoningEffort || '';
    return {
      modelProviderId: selection.modelProviderId,
      model: selection.model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(selection.taskRouting ? { taskRouting: selection.taskRouting } : {}),
    };
  };
  const tools = await createTaskTools({ background: true, invoke: async (sourceId, input) => {
    const source = kernel.get(sourceId);
    if (!source || terminalStates.has(source.state) || source.cancelRequested) throw Object.assign(Error('来源任务已经结束'), { statusCode: 409 });
    if (source.background) throw Object.assign(Error('后台执行者不能再次派工'), { statusCode: 403 });
    if (input.action === 'list') return { tasks: kernel.list() };
    if (input.action === 'followup') {
      const target = kernel.get(input.taskId);
      if (!target?.background || target.source?.roomId !== roomId || target.source?.agentId !== source.agentId || !queue || !execution)
        throw Object.assign(Error('不能继续此后台任务'), { statusCode: 403 });
      const attachments = resolveAttachments(source.attachmentIds || []);
      if (attachments.length !== (source.attachmentIds || []).length) throw Object.assign(Error('续派附件不可用'), { statusCode: 400 });
      return followupTask({ kernel, source, target, input, queue, execution, clientFor, providerForThread,
        actor: { id: source.agentId, name: room.getAgent(source.agentId).name },
        attachments: attachments.map(({ id, name, mimeType, url, size }) => ({ id, name, mimeType, url, size })) });
    }
    if (input.action === 'background') {
      if (!registerSession || !queue || !execution) throw Object.assign(Error('后台任务服务未连接'), { statusCode: 503 });
      const selection = await routeForTask(room.getAgent(source.agentId), input);
      const reasoningEffort = input.reasoningEffort || selection?.reasoningEffort || '';
      const conversationId = `handoff-${createHash('sha256').update(`${sourceId}:${input.requestId}`).digest('hex').slice(0, 32)}`;
      const task = await kernel.delegate(sourceId, { requestId: input.requestId, agentId: source.agentId, background: true,
        title: input.title, instructions: input.instructions, conversationId, lane: `${roomId}:${conversationId}:${source.agentId}`,
        ...(selection ? { modelProviderId: selection.modelProviderId, model: selection.model,
          ...(selection.taskRouting ? { taskRouting: selection.taskRouting } : {}) } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        attachmentIds: source.attachmentIds || [], source: { ...delegationSource(source),
          threadId: source.runtime.threadId } });
      return startupFor(task);
    }
    if (input.action !== 'delegate') throw Object.assign(Error('不支持的任务操作'), { statusCode: 400 });
    if (!room.getAgent(input.agentId) || input.agentId === source.agentId) throw Object.assign(Error('交接对象必须是群内其他员工'), { statusCode: 400 });
    const coordination = coordinationFor(source);
    if (coordination && !coordination.assignments.some(assignment => assignment.agentId === input.agentId))
      throw Object.assign(Error('该协作任务只能交给已发布的员工'), { statusCode: 403 });
    const visited = new Set();
    const ancestors = [source.id];
    while (ancestors.length) {
      const id = ancestors.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const ancestor = kernel.get(id);
      if (ancestor) ancestors.push(ancestor.parentTaskId, ancestor.resultOf);
    }
    if (visited.size >= 24) throw Object.assign(Error('交接链已达到轮次上限'), { statusCode: 409 });
    const planned = coordination?.assignments.some(assignment => assignment.agentId === input.agentId);
    const selection = await routeForTask(room.getAgent(input.agentId), input);
    const reasoningEffort = input.reasoningEffort || selection?.reasoningEffort || '';
    const delegated = await kernel.delegate(sourceId, { requestId: input.requestId, agentId: input.agentId, title: input.title, instructions: input.instructions,
      conversationId: roomId, lane: `${roomId}:${input.agentId}`, suppressContinuation: planned || input.notifySource === false,
      ...(selection ? { modelProviderId: selection.modelProviderId, model: selection.model,
        ...(selection.taskRouting ? { taskRouting: selection.taskRouting } : {}) } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      source: delegationSource(source) });
    if (coordination) await publishCoordinationIfReady(kernel.get(sourceId));
    return startupFor(delegated);
  } });
  const instructionsFor = agent => employeeTurnInstructions(agent.instructions,
    `你是${agent.name}，只以自己的身份回复。需要执行工作时优先调用 Negus 的 create_background_task，追加要求使用 followup_background_task。需要群内同事协作时调用 negus_handoffs.delegate_task，写明目标、问题和所需结果；仅在文字中 @ 同事不会创建任务。派工路由读取 runtime/model-routing.json：目标模型首选渠道不可用时，先尝试同一模型的其他渠道，再按配置顺序尝试其他模型；实际选择和回退原因以 taskRouting 记录为准。工具返回 startup.confirmed=true 才表示任务真实启动；false 时按 startup.state 和 startup.error 说明已创建未启动、启动失败或等待状态，不得提前宣称已安排。请求意见、验收或等待结果继续处理时保持 notifySource 为 true；纯告知且无需后续处理时才设为 false。结果通知不是新的委派请求，不要重复派发相同工作。简单且已授权的事项直接处理；复杂事项若仍有影响结果的需求歧义、风险或方案取舍，先向用户说明预期效果和需要决定的选项，结束本轮等待答复，再按确认结果实施；不得重复询问已有授权。现有员工：${JSON.stringify(room.snapshot().agents.map(({ id, name, responsibility }) => ({ id, name, responsibility })))}`);
  const coordinationInstructions = task => {
    const plan = task.source?.coordination;
    if (!plan || task.parentTaskId || task.resultOf
      || ['continuation', 'delegation', 'followup'].includes(task.kind)) return '';
    if (plan.reason === 'clarification') {
      return `用户要求多人协作，但当前消息没有明确实际工作内容或岗位，不能自行固定员工分工，也不能自己包办。请在群内用一条简短消息询问需要哪些具体工作、由哪些岗位负责；不要创建员工任务，不要假装已经分工。用户说明具体工作后，再按实际能力创建任务。`;
    }
    if (!plan.assignments?.length) return '';
    return `本次消息已识别为明确多人协作或跨岗位任务。你必须使用 negus_handoffs.delegate_task 逐项创建下列员工任务，不能让其他员工只停留在文字提及，也不能自己代替他们执行：${JSON.stringify(plan.assignments.map(({ agentId, agentName, focus, requestId, title, instructions }) => ({ agentId, agentName, focus, requestId, title, instructions })))}。每个 requestId 只调用一次，notifySource 使用 false，不要扩大到未列出的员工。对应员工任务全部创建后，系统会发布具体分工；你的回复不要重复整份分工清单。`;
  };
  const replyToFor = task => {
    const current = kernel.get(task.id) || task;
    const latest = current.inputs?.findLast(input => input.accepted && !input.cancelled && input.messageId
      && input.turnId === current.runtime.turnId);
    const id = latest?.messageId || current.source?.messageId;
    return id ? { id } : null;
  };
  const publishCommentary = async (task, items) => {
    if (task.background) return;
    for (const item of items || []) {
      if (item.type !== 'agentMessage' || item.phase !== 'commentary' || !item.id || !item.text?.trim()) continue;
      await room.addMessage({ type: 'agent', authorId: task.agentId, authorName: room.getAgent(task.agentId)?.name,
        agentId: task.agentId, workId: task.id, itemId: item.id, phase: 'commentary',
        text: item.text, preserveText: true, replyTo: replyToFor(task) });
    }
  };
  const runtime = createNativeTaskRuntime({ log,
    resolve: async (task, controls, { recovering }) => {
      let agent = room.getAgent(task.agentId);
      if (!agent) throw Error('执行员工已不在当前群聊');
      const taskRoute = task.modelProviderId
        ? { modelProviderId: task.modelProviderId, model: task.model,
          reasoningEffort: task.reasoningEffort || task.runtime.reasoningEffort || agent.reasoningEffort || '' }
        : task.runtime.modelProviderId
          ? { modelProviderId: task.runtime.modelProviderId, model: task.runtime.model || agent.model, reasoningEffort: task.runtime.reasoningEffort || '' }
          : null;
      if (task.conversationId === roomId && agent.threadId
        && (agent.pendingModelSettings || (taskRoute && taskRoute.modelProviderId !== agent.modelProviderId))) {
        const requested = taskRoute || agent.pendingModelSettings;
        agent = await migrateGroupAgentThread({
          agent: { ...agent, pendingModelSettings: {
            modelProviderId: requested.modelProviderId,
            model: requested.model,
            reasoningEffort: requested.reasoningEffort || agent.reasoningEffort || '',
            modelSelectionSource: 'default',
          } },
          room, modelProviders, clientFor, transferThread,
        });
        if (taskRoute && (agent.modelProviderId !== taskRoute.modelProviderId || agent.model !== taskRoute.model)) {
          throw Error(`群聊员工会话无法切换到任务渠道 ${taskRoute.modelProviderId} / ${taskRoute.model}`);
        }
      }
      if (taskRoute) agent = { ...agent, ...taskRoute };
      else if (task.conversationId !== roomId) agent = { ...agent, ...(await backgroundTaskRoute(modelProviders)) };
      if (task.background || task.reasoningEffort || task.runtime.reasoningEffort)
        agent = { ...agent, reasoningEffort: task.reasoningEffort || task.runtime.reasoningEffort || agent.reasoningEffort };
      const modelProviderId = task.runtime.modelProviderId || agent.modelProviderId || 'current';
      const client = await clientFor({ ...agent, modelProviderId });
      const independent = task.conversationId !== roomId;
      let threadId = task.runtime.threadId || task.resumeThreadId || (recovering || independent ? '' : agent.threadId);
      const taskInstructions = [task.background ? `${basePrompt}\n你是独立后台任务执行者，执行已授权工作并验证，结果返回来源员工；不得再次派工。` : instructionsFor(agent), coordinationInstructions(task), growthService?.getContext(agent.id)].filter(Boolean).join('\n');
      const options = { ...executionPolicy, developerInstructions: taskInstructions, config: task.background ? backgroundToolConfig : tools.config(task.id),
        ...(agent.model ? { model: agent.model } : {}) };
      const registerBackground = async () => {
        if (!registerSession) throw Error('后台任务登记服务未连接');
        if (!await providerForThread(threadId)) await registerSession({ threadId, source: 'codex', title: task.title, cwd: projectRoot, updatedAt: task.createdAt, archived: false, conversationKind: 'task' }, modelProviderId,
          modelProviderId !== 'current' && agent.model && !agent.model.includes('::') ? `${modelProviderId}::${agent.model}` : agent.model || '', { createdBy: 'assistant', reasoningEffort: agent.reasoningEffort || '' });
        await bindings?.bindRuntime({ conversationId: task.conversationId, agentId: agent.id, runtimeKind: 'codex', runtimeSessionId: threadId,
          conversationKind: 'task', title: task.title, targetProjectId: room.snapshot().room.projectId, executionRoot: projectRoot });
      };
      if (recovering) {
        if (threadId && independent) await registerBackground();
        return { client, threadId, onHistory: async turn => {
          await publishCommentary(task, turn.items);
          if (turn.status === 'completed') await ensureCoordinatedDelegations(task);
        } };
      }
      if (controls.signal.aborted) return { client, threadId: threadId || 'cancelled-before-start', input: [] };
      if (threadId) {
        try {
          if (independent) await registerBackground();
          if (!task.background) {
            const previous = await client.request('thread/read', { threadId, includeTurns: true });
            if (previous.thread?.status?.type === 'active' || previous.thread?.turns?.some(turn => !terminalStates.has(turn.status)))
              throw Object.assign(Error('员工会话仍有其他执行，等待核对状态'), { ambiguous: true });
            // A loaded native thread ignores resume MCP overrides. Revoke the old
            // process before installing this task's capability (FEAT-002).
            await client.request('thread/unsubscribe', { threadId });
          }
          await client.request('thread/resume', { threadId, ...options, persistExtendedHistory: true });
        }
        catch (error) { if (!/thread(?:\s+id)?\s+not\s+found/iu.test(error.message)) throw error; threadId = ''; }
      }
      if (!threadId) {
        const value = await client.request('thread/start', { ...options, cwd: employeeWorkRoots[agent.id] || projectRoot, ephemeral: false, serviceName: 'negus' });
        threadId = value.thread.id;
        await controls.checkpoint({ threadId, modelProviderId, model: agent.model, reasoningEffort: agent.reasoningEffort || '', ...(independent ? { registrationPending: true } : {}) });
        if (independent) {
          try { await registerBackground(); } catch (error) { throw Object.assign(error, { ambiguous: true }); }
          await kernel.recordInput(task.id, { requestId: 'initial', submissionId: task.id, text: task.instructions, actor: task.source.actor });
        }
        else await room.updateAgent(agent.id, {
          threadId,
          ...(taskRoute ? { modelProviderId, model: agent.model || '', reasoningEffort: agent.reasoningEffort || '', modelSelectionSource: 'default' } : {}),
        });
        await client.request('thread/name/set', { threadId, name: independent ? task.title : `${agent.name} · ${room.snapshot().room.name}` });
      }
      const snapshot = await client.request('thread/read', { threadId, includeTurns: true });
      await controls.checkpoint({ threadId, modelProviderId, model: agent.model, reasoningEffort: agent.reasoningEffort || '' });
      const turns = snapshot.thread?.turns || [];
      if (turns.some(turn => !terminalStates.has(turn.status))) throw Object.assign(Error('员工会话仍有其他执行，等待核对状态'), { ambiguous: true });
      const context = room.getAgentContext(agent.id, { assignmentId: task.source?.messageId || '' });
      const discussion = buildDiscussionPrompt({ agent, agents: room.snapshot().agents, ...context, assignment: context.assignment,
        targetProjectRoot: projectRoot, mentionHandoff: false }).split('\n').filter(line => !line.startsWith('这条消息已经点了')).join('\n');
      const prompt = task.background ? task.instructions : task.kind === 'delegation' || task.kind === 'continuation' ? `${discussion}\n\n当前交接要求：\n${task.instructions}` : discussion;
      const sources = [...context.messages, context.quotedMessage].filter(Boolean);
      const attachments = [...new Map([
        ...resolveAttachments([...new Set([...(task.attachmentIds || []), ...sources.flatMap(message => message.attachments?.map(file => file.id) || [])])]),
        ...resolveArtifacts([...new Set(sources.flatMap(message => message.artifactIds || []))]),
      ].map(file => [file.id, file])).values()];
      const input = await inputFromAttachments(prompt, attachments, attachmentContent);
      return { client, threadId, input, previousTurnIds: turns.map(turn => turn.id),
        onHistory: async turn => {
          await publishCommentary(task, turn.items);
          if (turn.status === 'completed') await ensureCoordinatedDelegations(task);
        },
        onStarted: async () => {
          if (!independent) {
            await onContextDelivered({ agentId: agent.id, threadId, messages: context.messages, quotedMessage: context.quotedMessage });
            await room.advanceAgentContext(agent.id, context.throughSequence);
          }
        },
        // Group employees are user-visible agents. Keep the same host-level
        // access on the turn as on the thread, regardless of their cwd.
        turnOptions: { cwd: projectRoot, ...turnExecutionPolicy, developerInstructions: taskInstructions, ...(task.background ? { clientUserMessageId: task.id } : {}), ...(agent.reasoningEffort ? { effort: agent.reasoningEffort } : {}) } };
    },
    onEvent: async (task, event) => {
      const { method, params } = event;
      if (task.background) return;
      if (terminalStates.has(kernel?.get(task.id)?.state)) return;
      if (method === 'turn/started') {
        room.beginAgentWork({ workId: task.id, agentId: task.agentId, agentName: room.getAgent(task.agentId)?.name, startedAt: task.createdAt });
        await room.updateAgent(task.agentId, { active: true, phase: 'working', label: '正在处理任务', detail: '' });
        broadcast({ type: 'group_agent_started', workId: task.id, agentId: task.agentId,
          agentName: room.getAgent(task.agentId)?.name || task.agentId, startedAt: task.createdAt });
      }
      if (method === 'item/completed') await publishCommentary(task, [params.item].filter(Boolean));
      if (method === 'turn/completed') {
        await publishCommentary(task, params.turn?.items);
        if (params.turn?.status === 'completed') await ensureCoordinatedDelegations(task);
      }
    },
  });
  kernel = await createTaskKernel({ stateFile: path.join(stateRoot, 'tasks.json'), runtime, log,
    broadcast: event => { broadcast(event); void projectStates(); },
    validate: input => {
      const lane = input.conversationId === roomId ? `${roomId}:${input.agentId}` : `${roomId}:${input.conversationId}:${input.agentId}`;
      if (!room.getAgent(input.agentId) || (input.conversationId !== roomId && (!input.conversationId.startsWith('handoff-') || input.source?.roomId !== roomId)) || input.lane !== lane) throw Object.assign(Error('交接员工或对话不属于当前群聊'), { statusCode: 400 });
    },
    deliver: async ({ id, task }) => {
      const agent = room.getAgent(task.agentId);
      const succeeded = task.state === 'completed' && task.result;
      const message = task.background ? null : await room.addMessage({ type: succeeded ? 'agent' : 'system',
        authorId: succeeded ? task.agentId : 'system', authorName: succeeded ? agent?.name : '系统',
        agentId: task.agentId, workId: task.id, replyTo: replyToFor(task),
        text: task.result || `${agent?.name || '员工'}${task.state === 'interrupted' ? '的任务已停止。' : '未能完成回复。'}${task.error || ''}`,
        failure: task.state === 'failed' });
      room.finishAgentWork(task.id);
      await projectStates();
      const another = kernel.list().some(candidate => candidate.id !== task.id && candidate.agentId === task.agentId && !terminalStates.has(candidate.state));
      if (!another) await room.updateAgent(task.agentId, { active: false, phase: task.state, label: task.state === 'completed' ? '已完成' : task.state === 'interrupted' ? '已停止' : '执行失败', detail: task.error || '' });
      tools.release(task.id);
      return { ...(message ? { messageId: message.id } : {}), parentTaskId: task.parentTaskId || null, published: Boolean(message) };
    },
  });
  const ensureCoordinatedDelegations = async task => {
    const plan = task.source?.coordination;
    const current = kernel.get(task.id);
    if (!plan?.assignments?.length || task.agentId !== plan.receptionId || task.parentTaskId || task.resultOf
      || ['continuation', 'delegation', 'followup'].includes(task.kind) || !current || current.cancelRequested) return [];
    const children = kernel.list().filter(candidate => candidate.parentTaskId === task.id);
    const missing = plan.assignments.filter(assignment => !children.some(candidate => candidate.agentId === assignment.agentId));
    for (const assignment of missing) {
      const selection = await routeForTask(room.getAgent(assignment.agentId), {});
      await kernel.delegate(task.id, {
        requestId: assignment.requestId, agentId: assignment.agentId, title: assignment.title,
        instructions: assignment.instructions, coordinationRole: assignment.focus,
        ...(selection ? { modelProviderId: selection.modelProviderId, model: selection.model,
          ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
          ...(selection.taskRouting ? { taskRouting: selection.taskRouting } : {}) } : {}),
        suppressContinuation: true, source: delegationSource(task),
      });
    }
    await publishCoordinationIfReady(current);
    if (missing.length) log({ event: 'coordination_delegation_fallback', taskId: task.id,
      agentIds: missing.map(assignment => assignment.agentId) });
    return missing;
  };
  await projectStates();
  const enqueueDiscussion = async ({ agentIds, sourceMessageId, requestText, attachments = [], coordination = null }) => {
    const tasks = [];
    for (const agentId of agentIds) {
      const requestKey = `message:${sourceMessageId}:${agentId}`;
      const source = { roomId, projectId: room.snapshot().room.projectId, messageId: sourceMessageId,
        ...(coordination && agentId === coordination.receptionId ? { coordination } : {}) };
      const previous = kernel.list().find(task => task.conversationId === roomId && task.agentId === agentId
        && task.inputs?.some(input => input.requestId === requestKey));
      const running = previous || kernel.list().find(task => task.conversationId === roomId && task.agentId === agentId
        && task.state === 'running' && !task.cancelRequested && task.runtime.turnId);
      if (running) {
        const prior = running.inputs?.find(input => input.requestId === requestKey);
        const client = await clientFor({ modelProviderId: running.runtime.modelProviderId, model: '' });
        let delivered = prior?.accepted;
        if (prior && !delivered) {
          const history = await client.request('thread/read', { threadId: running.runtime.threadId, includeTurns: true });
          delivered = history.thread?.turns?.some(turn => turn.items?.some(item => item.type === 'userMessage'
            && (item.clientId === requestKey || item.clientUserMessageId === requestKey)));
          if (!delivered) {
            const turn = history.thread?.turns?.find(turn => turn.id === running.runtime.turnId);
            if (!turn || !terminalStates.has(turn.status)) throw Object.assign(Error('正在核对补充消息是否送达，请稍后重试'), { statusCode: 409 });
            const routing = await routingFields(agentId);
            tasks.push(await kernel.enqueue({ requestKey, conversationId: roomId, lane: `${roomId}:${agentId}`, agentId,
              title: requestText, instructions: requestText, source,
              attachmentIds: attachments.map(file => file.id), ...routing }));
            continue;
          }
        }
        if (!delivered) {
          const files = resolveAttachments(attachments.map(file => file.id));
          if (files.length !== attachments.length) throw Object.assign(Error('补充消息附件不可用'), { statusCode: 400 });
          const input = await inputFromAttachments(requestText, files, attachmentContent);
          await kernel.recordInput(running.id, { requestId: requestKey, submissionId: requestKey, messageId: sourceMessageId, turnId: running.runtime.turnId, text: requestText });
          await client.request('turn/steer', { threadId: running.runtime.threadId, expectedTurnId: running.runtime.turnId,
            clientUserMessageId: requestKey, input });
        }
        await kernel.acceptInput(running.id, requestKey);
        tasks.push(running);
      } else {
        const routing = await routingFields(agentId);
        tasks.push(await kernel.enqueue({ requestKey,
          conversationId: roomId, lane: `${roomId}:${agentId}`, agentId, title: requestText, instructions: requestText,
          source, attachmentIds: attachments.map(file => file.id), ...routing }));
      }
    }
    return { jobId: tasks[0]?.id, taskIds: tasks.map(task => task.id), agentIds, agentNames: agentIds.map(id => room.getAgent(id)?.name), status: 'queued' };
  };
  const answerQuestionMark = async (message, members) => {
    const receptionId = receptionAgentId(members);
    if (!receptionId) {
      await room.addMessage({ type: 'system', authorId: 'system', authorName: '系统',
        workId: `status:${message.id}`, replyTo: { id: message.id },
        text: '当前群聊没有可回复的员工。请先邀请员工，或直接说明您想询问的任务。' });
      return { agentIds: [], agentNames: [], status: 'clarification' };
    }
    const agent = room.getAgent(receptionId);
    const tasks = kernel.list().sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    const active = tasks.filter(task => !terminalStates.has(task.state));
    const shown = (active.length ? active : tasks.slice(0, 1)).slice(0, 6);
    const lines = shown.map(task => `${room.getAgent(task.agentId)?.name || task.agentId}负责「${clip(task.title, 80)}」，${taskStatusLabel(task.state)}`);
    const text = active.length
      ? `当前有 ${active.length} 项任务：${lines.join('；')}。您想确认哪一项？`
      : lines.length
        ? `目前没有正在执行的任务。最近一项：${lines[0]}。您想确认哪一项？`
        : '目前没有正在执行的任务。您想确认哪一项？';
    await room.addMessage({ type: 'agent', authorId: receptionId, authorName: agent?.name || receptionId,
      agentId: receptionId, workId: `status:${message.id}`, replyTo: { id: message.id }, text });
    return { agentIds: [], agentNames: [], status: 'clarification' };
  };
  const inbox = await createMessageInbox({ stateFile: path.join(stateRoot, 'inbox.json'),
    publish: async entry => (await room.addMessageWithStatus({ ...entry.input.message, clientMessageId: entry.input.requestId })).message,
    dispatch: async (input, message, intake) => {
      const members = room.snapshot().agents;
      if (/^[\s?？]+$/u.test(String(message.text || ''))) return answerQuestionMark(message, members);
      // FEAT-002 2026-11-07: employees are optional, so a group may have nobody to wake.
      if (!members.length) return { agentIds: [], agentNames: [], status: 'listening' };
      const quoted = message.replyTo?.id
        ? room.snapshot().messages.find(candidate => candidate.id === String(message.replyTo.id))
        : null;
      const replyAgentId = quoted?.type === 'agent'
        ? String(quoted.agentId || quoted.authorId || '').trim()
        : '';
      const routing = intake.routing || await routeMessage({ text: message.text, members, explicitIds: mentionedAgentIds(message.text, members),
        requestedIds: input.agentIds, receptionId: receptionAgentId(members), allowBroadcast: false,
        replyAgentId,
        log });
      if (!intake.routing) await intake.saveRouting(routing);
      log({ event: 'message_routed', messageId: message.id, agentIds: routing.agentIds, reason: routing.reason });
      const receptionId = receptionAgentId(members);
      const planned = routing.reason === 'reception' && routing.agentIds.length === 1 && routing.agentIds[0] === receptionId
        ? planGroupCollaboration({ text: message.text, members, receptionId })
        : null;
      const coordination = planned ? {
        ...planned,
        assignments: planned.assignments.map(assignment => ({
          ...assignment,
          requestId: `coordination:${message.id}:${assignment.agentId}`,
          title: `[协作] ${assignment.focus}`,
          instructions: `${assignment.instructions}\n本次用户要求：${clip(message.text, 3000)}`,
        })),
      } : null;
      if (coordination) log({ event: coordination.assignments.length ? 'coordination_plan' : 'coordination_clarification', messageId: message.id,
        agentIds: coordination.assignments.map(assignment => assignment.agentId), reason: coordination.reason });
      return enqueueDiscussion({ agentIds: routing.agentIds, sourceMessageId: message.id,
        requestText: message.text || '请查看附件。', attachments: input.message.attachments, coordination });
    },
    onError: async (entry, error) => { log({ event: 'message_dispatch_failed', intakeId: entry.id });
      await room.addMessage({ type: 'system', authorId: 'system', authorName: '系统', workId: `intake-error:${entry.id}`, failure: true,
        replyTo: entry.message ? { id: entry.message.id } : null, text: `消息未能交给员工：${error.message}` }); },
  });
  const service = {
    receive: input => inbox.accept(`${input.message.authorId}:${input.requestId}`, input),
    tasks: () => kernel.list(), deliveries: () => kernel.deliveries(), cancelTask: kernel.cancel,
    reconcileTask: kernel.reconcile, retryDelivery: kernel.retryDelivery, enqueueDiscussion,
    onProtocolMessage: async event => {
      if (!['turn/started', 'item/started', 'item/completed', 'turn/completed'].includes(event.method)) return;
      const threadId = event.params?.threadId;
      const turnId = event.params?.turn?.id || event.params?.turnId;
      if (!threadId || !turnId) return;
      const target = kernel.list().find(task => task.background && task.kind !== 'followup' && task.runtime.threadId === threadId);
      if (!target || target.cancelRequested) return;
      let items = [...(event.params?.turn?.items || []), event.params?.item].filter(Boolean);
      if (!items.some(item => item.type === 'userMessage')) {
        const client = await clientFor({ modelProviderId: target.runtime.modelProviderId, model: '' });
        const history = await client.request('thread/read', { threadId, includeTurns: true });
        items = history.thread?.turns?.find(item => item.id === turnId)?.items || [];
      }
      const matched = (target.inputs || []).find(input => input.requestId !== 'initial' && items.some(item => item.type === 'userMessage'
        && (item.clientId === input.submissionId || item.clientUserMessageId === input.submissionId)));
      if (!matched || matched.cancelled) return;
      if (target.runtime.turnId === turnId) { await kernel.linkInput(target.id, matched.requestId, turnId); return; }
      const source = kernel.get(matched.sourceTaskId);
      if (!source || source.cancelRequested || source.agentId !== target.source.agentId) return;
      await kernel.enqueue({ kind: 'followup', requestKey: `followup:${threadId}:${turnId}`, submissionId: matched.submissionId, background: true,
        conversationId: target.conversationId, lane: target.lane, agentId: target.agentId,
        modelProviderId: target.modelProviderId, model: target.model, reasoningEffort: target.reasoningEffort,
        taskRouting: target.taskRouting, source: target.source,
        parentTaskId: source.id, replyTo: { conversationId: roomId, lane: `${roomId}:${source.agentId}`, agentId: source.agentId,
          source: source.source, resumeThreadId: source.runtime.threadId }, title: target.title, instructions: '',
        runtime: { threadId, turnId, modelProviderId: target.runtime.modelProviderId, model: target.runtime.model, reasoningEffort: target.runtime.reasoningEffort } });
    },
    hasPendingWork: () => kernel.hasPendingWork() || inbox.list().some(entry => entry.state === 'pending'),
    updateAgentSettings: async (agentId, settings) => {
      const agent = room.getAgent(agentId);
      if (!agent) throw Object.assign(Error('员工不存在'), { statusCode: 404 });
      if (agent.threadId && settings.modelProviderId !== agent.modelProviderId) throw Object.assign(Error('现有员工会话暂不支持跨供应商切换'), { statusCode: 409 });
      modelProviders?.resolveRoute(settings);
      return room.updateAgent(agentId, { ...settings, modelSelectionSource: 'explicit' });
    },
    interruptDiscussion: async () => {
      const tasks = kernel.list().filter(task => !terminalStates.has(task.state));
      let unresolved = 0;
      if (queue?.list && queue.remove) {
        for (const task of kernel.list().filter(item => item.background && item.kind !== 'followup' && item.runtime.threadId)) {
          for (const input of task.inputs || []) {
            if (input.requestId === 'initial') continue;
            const pending = queue.list(task.runtime.threadId).find(item => item.submissionId === input.submissionId);
            if (!pending) continue;
            try { if (pending.state === 'dispatching') {
              const client = await clientFor({ modelProviderId: task.runtime.modelProviderId, model: '' });
              const history = await client.request('thread/read', { threadId: task.runtime.threadId, includeTurns: true });
              const active = history.thread?.turns?.find(turn => !terminalStates.has(turn.status) && turn.items?.some(item => item.type === 'userMessage'
                && (item.clientId === input.submissionId || item.clientUserMessageId === input.submissionId)));
              if (!active?.id) { unresolved++; continue; }
              await client.request('turn/interrupt', { threadId: task.runtime.threadId, turnId: active.id });
            } else await queue.remove(task.runtime.threadId, pending.id);
            await kernel.cancelInput(task.id, input.requestId);
            } catch { unresolved++; }
          }
        }
      }
      await Promise.all(tasks.map(task => kernel.cancel(task.id, { suppressContinuation: true })));
      return { status: 'interrupting', interruptedAgentIds: tasks.map(task => task.agentId), cancelledDiscussionCount: tasks.length, unresolvedCount: unresolved };
    },
    close: async () => { clearInterval(recoveryTimer); await recovery; await inbox.close(); await kernel.close(); await projection; await tools.close(); },
  };
  let recovery = Promise.resolve();
  let scanning = false;
  const recoveryAttempts = new Map();
  const recoverFollowups = () => {
    if (scanning) return;
    scanning = true;
    recovery = (async () => {
      for (const target of kernel.list().filter(task => task.background && task.kind !== 'followup' && task.runtime.threadId && !task.cancelRequested)) {
        const unresolved = (target.inputs || []).filter(input => input.requestId !== 'initial' && input.accepted && !input.cancelled && !input.turnId
          && !queue?.list?.(target.runtime.threadId).some(item => item.submissionId === input.submissionId && item.state !== 'failed')
          && (recoveryAttempts.get(input.submissionId) || 0) < 3
          && !kernel.list().some(task => task.kind === 'followup' && task.submissionId === input.submissionId));
        if (!unresolved.length) continue;
        for (const input of unresolved) recoveryAttempts.set(input.submissionId, (recoveryAttempts.get(input.submissionId) || 0) + 1);
        try {
          const client = await clientFor({ modelProviderId: target.runtime.modelProviderId, model: '' });
          const history = await client.request('thread/read', { threadId: target.runtime.threadId, includeTurns: true });
          for (const input of unresolved) {
            const matches = (history.thread?.turns || []).filter(turn => turn.items?.some(item => item.type === 'userMessage'
              && (item.clientId === input.submissionId || item.clientUserMessageId === input.submissionId)));
            if (matches.length === 1) {
              await service.onProtocolMessage({ method: 'turn/completed', params: { threadId: target.runtime.threadId, turn: matches[0] } });
              const failed = queue?.list?.(target.runtime.threadId).find(item => item.submissionId === input.submissionId && item.state === 'failed');
              const recorded = kernel.get(target.id)?.inputs?.find(item => item.requestId === input.requestId)?.turnId
                || kernel.list().some(task => task.kind === 'followup' && task.submissionId === input.submissionId);
              if (recorded && failed && queue?.remove) await queue.remove(target.runtime.threadId, failed.id);
            }
            else if (matches.length > 1) log({ event: 'followup_reconciliation_ambiguous', taskId: target.id });
            if (matches.length !== 1 && recoveryAttempts.get(input.submissionId) >= 3)
              await room.addMessage({ type: 'system', authorId: 'system', authorName: '系统', agentId: target.agentId,
                workId: `followup-unconfirmed:${input.submissionId}`, failure: true,
                replyTo: target.source?.messageId ? { id: target.source.messageId } : null,
                text: '后台续派尚无法确认是否送达，请核对任务对话后再重试。' });
          }
        } catch {
          log({ event: 'followup_reconciliation_failed', taskId: target.id });
          for (const input of unresolved.filter(item => recoveryAttempts.get(item.submissionId) >= 3))
            await room.addMessage({ type: 'system', authorId: 'system', authorName: '系统', agentId: target.agentId,
              workId: `followup-unconfirmed:${input.submissionId}`, failure: true,
              replyTo: target.source?.messageId ? { id: target.source.messageId } : null,
              text: '后台续派状态核对失败，请核对任务对话后再重试。' });
        }
      }
    })().finally(() => { scanning = false; });
  };
  const recoveryTimer = setInterval(recoverFollowups, 15000);
  recoveryTimer.unref?.();
  recoverFollowups();
  agentTasks?.registerTaskProvider?.(roomId, service);
  return service;
}
