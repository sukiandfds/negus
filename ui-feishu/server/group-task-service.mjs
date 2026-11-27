import { registerTaskThread, taskThreadOptions } from "../kernel/task-thread.mjs";
import { containsSubmittedInput } from "../../windows/server/message-identity.mjs";
import { startConversationThread, resumeConversationThread, waitingPhaseFor, steerTurn, interruptTurn } from "../../windows/server/execution/protocol.mjs";
import { taskStartupReceipt } from "../kernel/task-startup.mjs";
import { backgroundTaskRoute, routeForTask } from '../../windows/server/background-tasks/model-policy.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTaskKernel, terminalStates } from '../kernel/task-kernel.mjs';
import { createNativeTaskRuntime } from '../kernel/native-task-runtime.mjs';
import { createTaskTools } from '../kernel/task-tools.mjs';
import { createMessageInbox } from '../kernel/message-inbox.mjs';
import { routeMessage } from '../kernel/message-routing.mjs';
import { mentionedAgentIds } from '../../windows/server/multi-agent/agent-routing.mjs';
import { inputFromAttachments } from '../../windows/server/app-server-conversation-store.mjs';
import { conversationPrompt, employeeContext, workerInstructions } from '../../windows/server/conversation-prompt.mjs';
import { buildDiscussionPrompt } from '../../windows/server/multi-agent/discussion-prompt.mjs';
import { backgroundToolConfig, executionPolicy, turnExecutionPolicy } from './execution-policy.mjs';
import { buildGroupSelectionContext, createGroupMessageSelector } from './group-message-selector.mjs';
import { followupTask } from './task-followup.mjs';
import { transferConversationThread } from '../../windows/server/conversation-provider-handoff.mjs';

const clip = (value, length) => String(value || '').trim().slice(0, length);
const taskStatusLabel = state => ({
  queued: '排队中', starting: '启动中', running: '执行中', stopping: '正在停止',
  recovering: '正在恢复', 'needs-reconciliation': '等待核对', completed: '已完成',
  failed: '执行失败', interrupted: '已停止',
}[state] || state || '状态待确认');

export async function migrateGroupAgentThread({
  agent, room, modelProviders, clientFor, transferThread = transferConversationThread,
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
      instructions: conversationPrompt(agent.instructions),
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
  appServerClient, broadcast = () => {}, attachmentContent, resolveAttachments = () => [], resolveArtifacts = () => [], onContextDelivered = async () => {}, bindings, agentTasks, queue, execution, registerSession, providerForThread = async () => null, transferThread = transferConversationThread, selectGroupAgent = null }) {
  const roomId = room.snapshot().room.id;
  const log = event => console.log(JSON.stringify({ scope: 'negus-tasks', roomId, at: new Date().toISOString(), ...event }));
  let kernel;
  let projection = Promise.resolve();
  let closing = false;
  const finalizingOwners = new Set();
  let scheduleOwnerFinalization = async () => {};
  const groupMessageSelector = createGroupMessageSelector({
    modelProviders, tasks: () => kernel?.list() || [],
  });
  const coordinationFor = source => {
    if (!source || source.parentTaskId || source.resultOf
      || ['continuation', 'delegation', 'followup'].includes(source.kind)) return null;
    return source.source?.coordination || null;
  };
  const rootTaskOf = task => {
    if (!task) return null;
    const tasks = kernel?.list() || [];
    const seen = new Set();
    let current = task;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const parentId = current.parentTaskId || current.resultOf;
      const parent = parentId ? tasks.find(candidate => candidate.id === parentId) : null;
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const descendantsOf = (taskId, tasks = kernel?.list() || []) => {
    const descendants = [];
    const seen = new Set([taskId]);
    const pending = [taskId];
    while (pending.length) {
      const parentId = pending.shift();
      for (const task of tasks) {
        if (seen.has(task.id)) continue;
        if (task.parentTaskId !== parentId && task.resultOf !== parentId) continue;
        seen.add(task.id);
        descendants.push(task);
        pending.push(task.id);
      }
    }
    return descendants;
  };
  const isDelegatedOwner = task => Boolean(task && !task.parentTaskId && !task.resultOf
    && task.publication?.role !== 'owner-final'
    && (task.source?.coordination?.assignments?.length || descendantsOf(task.id).length));
  const statusTextFor = (task, text) => String(text || `${room.getAgent(task.agentId)?.name || task.agentId}正在执行任务。`).trim();
  const writeOwnerStatus = async (task, text, { failure = false, important = false } = {}) => {
    const root = rootTaskOf(task);
    if (!root) return null;
    const owner = kernel.get(root.id) || root;
    const notice = owner.progress?.findLast(item => item.phase === 'group-notice');
    const status = statusTextFor(owner, text);
    // Keep the notice visible while routine task events arrive.
    let publicText = status;
    if (notice && !(failure || important)) publicText = notice.text;
    else if (notice && !status.includes(notice.text)) publicText = `${notice.text}\n\n${status}`;
    const sourceMessage = owner.source?.messageId ? room.getMessage(owner.source.messageId) : null;
    return (await room.addMessageWithStatus({
      type: 'agent', authorId: owner.agentId, authorName: room.getAgent(owner.agentId)?.name,
      agentId: owner.agentId, workId: owner.id, itemId: 'public-status', phase: 'commentary',
      replyTo: sourceMessage ? { id: sourceMessage.id } : null, preserveText: true,
      text: publicText, failure, replaceExisting: true,
    })).message;
  };
  const delegationSource = source => {
    const value = { ...source.source, roomId, agentId: source.agentId,
      actor: { id: source.agentId, name: room.getAgent(source.agentId)?.name || source.agentId } };
    delete value.coordination;
    return value;
  };
  const publishCoordinationPlan = async (plan, message) => {
    if (!plan?.assignments?.length || !message) return null;
    const owner = kernel.list().find(task => task.source?.messageId === message.id
      && task.agentId === plan.receptionId && !task.parentTaskId && !task.resultOf);
    return owner ? writeOwnerStatus(owner,
      `正在执行：${plan.assignments.map(item => item.agentName).join('、')}。完成后由${plan.receptionName}统一交付。`) : null;
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
 const routingFields = async agentId => {
    const selection = await routeForTask(modelProviders, room.getAgent(agentId), {}, kernel.list());
    if (!selection) return {};
    const reasoningEffort = selection.reasoningEffort || '';
    return {
      modelProviderId: selection.modelProviderId,
      model: selection.model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(selection.taskRouting ? { taskRouting: selection.taskRouting } : {}),
    };
  };
  const tools = await createTaskTools({ background: true, groupNotices: true, invoke: async (sourceId, input) => {
    const source = kernel.get(sourceId);
    if (!source || terminalStates.has(source.state) || source.cancelRequested) throw Object.assign(Error('来源任务已经结束'), { statusCode: 409 });
    if (source.background) throw Object.assign(Error('后台执行者不能再次派工'), { statusCode: 403 });
    if (input.action === 'list') return { tasks: kernel.list() };
    if (input.action === 'groupNotice') {
      const owner = rootTaskOf(source);
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
      if (!owner || !isDelegatedOwner(owner)) throw Object.assign(Error('此工具用于群内协作任务'), { statusCode: 409 });
      if (!requestId || requestId.length > 80 || !text || text.length > 240 || !['risk', 'decision', 'blocker'].includes(input.kind)) {
        throw Object.assign(Error('请提交有效的风险、待决策问题或阻塞说明'), { statusCode: 400 });
      }
      const notice = await kernel.recordProgress(owner.id, {
        id: `group-notice:${source.id}:${input.kind}:${requestId}`, text, phase: 'group-notice',
      });
      const message = await writeOwnerStatus(owner, notice.text);
      return { messageId: message?.id, published: Boolean(message) };
    }
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
      const selection = await routeForTask(modelProviders, room.getAgent(source.agentId), input, kernel.list());
      const reasoningEffort = input.reasoningEffort || selection?.reasoningEffort || '';
      const conversationId = `handoff-${createHash('sha256').update(`${sourceId}:${input.requestId}`).digest('hex').slice(0, 32)}`;
      const task = await kernel.delegate(sourceId, { requestId: input.requestId, agentId: source.agentId, background: true,
        title: input.title, instructions: input.instructions, conversationId, lane: `${roomId}:${conversationId}:${source.agentId}`,
        publication: { role: 'internal' }, suppressContinuation: true,
        ...(selection ? { modelProviderId: selection.modelProviderId, model: selection.model,
          ...(selection.taskRouting ? { taskRouting: selection.taskRouting } : {}) } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        attachmentIds: source.attachmentIds || [], source: { ...delegationSource(source),
          threadId: source.runtime.threadId } });
      await writeOwnerStatus(source, `正在执行：${input.title}。`);
      return taskStartupReceipt(kernel, task);
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
    const selection = await routeForTask(modelProviders, room.getAgent(input.agentId), input, kernel.list());
    const reasoningEffort = input.reasoningEffort || selection?.reasoningEffort || '';
    const delegated = await kernel.delegate(sourceId, { requestId: input.requestId, agentId: input.agentId, title: input.title, instructions: input.instructions,
      conversationId: roomId, lane: `${roomId}:${input.agentId}`, suppressContinuation: true,
      publication: { role: 'internal' },
      ...(selection ? { modelProviderId: selection.modelProviderId, model: selection.model,
        ...(selection.taskRouting ? { taskRouting: selection.taskRouting } : {}) } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      source: delegationSource(source) });
    await writeOwnerStatus(source, `正在执行：${room.getAgent(input.agentId)?.name || input.agentId}负责「${clip(input.title, 80)}」。`);
    if (coordination) await publishCoordinationIfReady(kernel.get(sourceId));
    return taskStartupReceipt(kernel, delegated);
  } });
  const groupGuidance = agent =>
    `你是${agent.name}，只以自己的身份回复。普通讨论和明确点名由你本人直接回答。以用户原话为准，先回答用户实际问的每一项。只保留支撑回答的必要事实，以及会影响用户判断、决定或下一步行动的重要信息。其余背景、排查步骤和技术细节留在任务记录，用户追问时再补。能自行查证的先在后台查证，再给结论和必要依据。中间回复仅在有关键进展、独立且有用的意见、重要风险或需要用户决定时发，每次限一两句。不要预报检查步骤、直播排查、复述前文或堆技术细节。证据不足时说清缺哪项事实、怎样取得，避免用“不能确定”代替结论。需要执行工作时优先调用 Negus 的 create_background_task，追加要求使用 followup_background_task。需要群内同事协作时调用 negus_handoffs.delegate_task，写明目标、问题和所需结果；仅在文字中 @ 同事不会创建任务。委派执行时不要在群内连续汇报过程，也不要让子任务各自向群聊报完成；任务详情保留完整进度和子任务结果，群聊由系统原位更新一条负责人状态，子任务与复验全部结束后由负责人只交付一次。协作中发现重要风险、需要用户决策或不可恢复阻塞时，立即调用 negus_handoffs.publish_group_notice，用一两句写清影响和需要用户决定的问题。涉及待确认的操作，等用户答复后再继续。派工路由读取 runtime/model-routing.json：目标模型首选渠道不可用时，先尝试同一模型的其他渠道，再按配置顺序尝试其他模型；实际选择和回退原因以 taskRouting 记录为准。工具返回 startup.confirmed=true 才表示任务真实启动；false 时按 startup.state 和 startup.error 说明已创建未启动、启动失败或等待状态，不得提前宣称已安排。结果通知不是新的委派请求，不要重复派发相同工作。简单且已授权的事项直接处理；复杂事项若仍有影响结果的需求歧义、风险或方案取舍，先向用户说明预期效果和需要决定的选项，结束本轮等待答复，再按确认结果实施；不得重复询问已有授权。现有员工：${JSON.stringify(room.snapshot().agents.map(({ id, name, responsibility }) => ({ id, name, responsibility })))}`;
  const coordinationInstructions = task => {
    const plan = task.source?.coordination;
    if (!plan || task.parentTaskId || task.resultOf
      || ['continuation', 'delegation', 'followup'].includes(task.kind)) return '';
    if (plan.reason === 'clarification') {
      return `用户要求多人协作，但当前消息没有明确实际工作内容或岗位，不能自行固定员工分工，也不能自己包办。请在群内用一条简短消息询问需要哪些具体工作、由哪些岗位负责；不要创建员工任务，不要假装已经分工。用户说明具体工作后，再按实际能力创建任务。`;
    }
    if (!plan.assignments?.length) return '';
    return `本次消息已识别为明确多人协作或跨岗位任务。你必须使用 negus_handoffs.delegate_task 逐项创建下列员工任务，不能让其他员工只停留在文字提及，也不能自己代替他们执行：${JSON.stringify(plan.assignments.map(({ agentId, agentName, focus, requestId, title, instructions }) => ({ agentId, agentName, focus, requestId, title, instructions })))}。每个 requestId 只调用一次，notifySource 使用 false，不要扩大到未列出的员工。群聊过程、子任务结果和最终交付由系统按任务来源统一处理；你的回复不要向群聊重复分工、过程或提前宣称完成。`;
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
      await kernel.recordProgress(task.id, { id: item.id, text: item.text, phase: 'commentary', createdAt: new Date().toISOString() });
      const root = rootTaskOf(task);
      if (isDelegatedOwner(root) || task.publication?.role === 'owner-final') continue;
      await room.addMessage({ type: 'agent', authorId: task.agentId, authorName: room.getAgent(task.agentId)?.name,
        agentId: task.agentId, workId: task.id, itemId: item.id, phase: 'commentary',
        text: item.text, preserveText: true, replyTo: replyToFor(task) });
    }
  };
  const runtime = createNativeTaskRuntime({ log, modelProviders,
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
        if (!recovering) modelProviders?.assertChannelAvailable?.(requested.modelProviderId);
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
      if (!recovering) modelProviders?.assertChannelAvailable?.(modelProviderId);
      const modelExecution = { modelProviderId, model: agent.model, ...modelProviders?.channelAvailability?.(modelProviderId) };
      const client = await clientFor({ ...agent, modelProviderId });
      const independent = task.conversationId !== roomId;
      let threadId = task.runtime.threadId || task.resumeThreadId || (recovering || independent ? '' : agent.threadId);
      const taskInstructions = conversationPrompt(task.background ? workerInstructions : agent.instructions, task.background ? '' : groupGuidance(agent));
      const options = taskThreadOptions(executionPolicy, taskInstructions, task.background ? backgroundToolConfig : tools.config(task.id), agent.model);
      const registerBackground = () => registerTaskThread({ task, threadId, actor: agent, modelProviderId, cwd: projectRoot,
        providerForThread, registerSession, bindings, bindingScope: { targetProjectId: room.snapshot().room.projectId, executionRoot: projectRoot } });
      if (recovering) {
        if (threadId && independent) await registerBackground();
        return { client, threadId, modelExecution, onHistory: async turn => {
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
          await resumeConversationThread(client, { threadId, ...options });
        }
        catch (error) { if (!/thread(?:\s+id)?\s+not\s+found/iu.test(error.message)) throw error; threadId = ''; }
      }
      if (!threadId) {
        const value = await startConversationThread(client, { ...options, cwd: employeeWorkRoots[agent.id] || projectRoot, ephemeral: false, serviceName: 'negus' });
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
      return { client, threadId, input, modelExecution, previousTurnIds: turns.map(turn => turn.id),
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
        turnOptions: { cwd: projectRoot, ...turnExecutionPolicy, developerInstructions: taskInstructions, additionalContext: employeeContext(coordinationInstructions(task)), ...(task.background ? { clientUserMessageId: task.id } : {}), ...(agent.reasoningEffort ? { effort: agent.reasoningEffort } : {}) } };
    },
    onEvent: async (task, event) => {
      const { method, params } = event;
      if (task.background) return;
      if (terminalStates.has(kernel?.get(task.id)?.state)) return;
      if (waitingPhaseFor(method) === 'waitingOnUserInput') {
        const root = rootTaskOf(task);
        if (isDelegatedOwner(root) || task.publication?.role === 'owner-final')
          await writeOwnerStatus(root || task, `${room.getAgent(task.agentId)?.name || task.agentId}需要您补充信息后才能继续。`, { important: true });
        return;
      }
      if (waitingPhaseFor(method) === 'waitingOnApproval') {
        const root = rootTaskOf(task);
        if (isDelegatedOwner(root) || task.publication?.role === 'owner-final')
          await writeOwnerStatus(root || task, `${room.getAgent(task.agentId)?.name || task.agentId}正在等待您确认风险操作。`, { important: true });
        return;
      }
      if (method === 'turn/started') {
        room.beginAgentWork({ workId: task.id, agentId: task.agentId, agentName: room.getAgent(task.agentId)?.name, startedAt: task.createdAt });
        await room.updateAgent(task.agentId, { active: true, phase: 'working', label: '正在处理任务', detail: '' });
        const root = rootTaskOf(task);
        if (isDelegatedOwner(root) || task.publication?.role === 'owner-final')
          await writeOwnerStatus(root || task, `${room.getAgent(task.agentId)?.name || task.agentId}已开始执行${task.publication?.role === 'owner-final' ? '最终核对' : `「${clip(task.title, 80)}」`}。`);
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
    broadcast: event => {
      broadcast(event);
      void projectStates();
      if (event.event === 'task_result_delivered') void scheduleOwnerFinalization(event.taskId)
        .catch(error => log({ event: 'owner_finalization_failed', taskId: event.taskId, error: error.message }));
    },
    validate: input => {
      const lane = input.conversationId === roomId ? `${roomId}:${input.agentId}` : `${roomId}:${input.conversationId}:${input.agentId}`;
      if (!room.getAgent(input.agentId) || (input.conversationId !== roomId && (!input.conversationId.startsWith('handoff-') || input.source?.roomId !== roomId)) || input.lane !== lane) throw Object.assign(Error('交接员工或对话不属于当前群聊'), { statusCode: 400 });
    },
    deliver: async ({ id, task }) => {
      const agent = room.getAgent(task.agentId);
      const succeeded = task.state === 'completed' && task.result;
      const failureText = `${agent?.name || '员工'}${task.state === 'interrupted' ? '的任务已停止。' : '未能完成回复。'}${task.error || ''}`;
      const root = rootTaskOf(task);
      const finalDelivery = task.publication?.role === 'owner-final';
      const delegatedOwner = isDelegatedOwner(task);
      const internal = task.background || task.parentTaskId || task.resultOf
        || task.publication?.role === 'internal';
      let message = null;
      if (finalDelivery && descendantsOf(task.id).length) {
        await writeOwnerStatus(root, '负责人发现仍需继续核验，正在完成后续检查。');
      } else if (finalDelivery) {
        message = await writeOwnerStatus(root, succeeded ? task.result : failureText,
          { failure: task.state !== 'completed', important: true });
      } else if (internal) {
        if (task.state !== 'completed' && root) {
          await writeOwnerStatus(root, `${agent?.name || task.agentId}${task.state === 'interrupted' ? '已停止' : '执行失败'}：${task.error || '没有返回可用结果'}`, { failure: true });
        }
      } else if (delegatedOwner) {
        await writeOwnerStatus(task, succeeded
          ? '主流程已结束，正在核对子任务和复验结果。'
          : failureText, { failure: task.state !== 'completed' });
      } else if (!task.background) {
        message = await room.addMessage({ type: succeeded ? 'agent' : 'system',
          authorId: succeeded ? task.agentId : 'system', authorName: succeeded ? agent?.name : '系统',
          agentId: task.agentId, workId: task.id, replyTo: replyToFor(task),
          text: task.result || failureText, failure: task.state === 'failed' });
      }
      room.finishAgentWork(task.id);
      await projectStates();
      const another = kernel.list().some(candidate => candidate.id !== task.id && candidate.agentId === task.agentId && !terminalStates.has(candidate.state));
      if (!another) await room.updateAgent(task.agentId, { active: false, phase: task.state, label: task.state === 'completed' ? '已完成' : task.state === 'interrupted' ? '已停止' : '执行失败', detail: task.error || '' });
      tools.release(task.id);
      return { ...(message ? { messageId: message.id } : {}), parentTaskId: task.parentTaskId || null, published: Boolean(message) };
    },
  });
  scheduleOwnerFinalization = async taskId => {
    if (closing) return;
    const changed = kernel.get(taskId);
    const root = rootTaskOf(changed);
    if (!root || !isDelegatedOwner(root) || finalizingOwners.has(root.id)) return;
    finalizingOwners.add(root.id);
    try {
      const tasks = kernel.list();
      const currentRoot = tasks.find(task => task.id === root.id);
      const descendants = descendantsOf(root.id, tasks);
      const pending = descendants.filter(task => !terminalStates.has(task.state));
      if (pending.length) {
        await writeOwnerStatus(currentRoot, `正在执行 ${descendants.length - pending.length}/${descendants.length} 项，等待其余任务结束。`);
        return;
      }
      const blocked = descendants.find(task => ['failed', 'interrupted'].includes(task.state));
      if (blocked) {
        await writeOwnerStatus(currentRoot,
          `${room.getAgent(blocked.agentId)?.name || blocked.agentId}${blocked.state === 'interrupted' ? '已停止' : '执行失败'}：${blocked.error || '没有返回可用结果'}`,
          { failure: true });
        return;
      }
      if (!currentRoot || !terminalStates.has(currentRoot.state) || currentRoot.state !== 'completed') return;
      const descendantIds = new Set(descendants.map(task => task.id));
      if (kernel.deliveries().some(delivery => descendantIds.has(delivery.taskId) && delivery.state !== 'delivered')) return;
      const finalizers = descendants.filter(task => task.publication?.role === 'owner-final');
      const latestFinal = finalizers.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
      if (latestFinal && descendantsOf(latestFinal.id, tasks).length === 0) return;
      const results = descendants.filter(task => task.state === 'completed').map(task => ({
        agent: room.getAgent(task.agentId)?.name || task.agentId,
        title: task.title,
        result: clip(task.result, 6000),
      }));
      await kernel.enqueue({
        kind: 'continuation', requestKey: `group-final:${root.id}:${finalizers.length + 1}`, conversationId: roomId,
        lane: `${roomId}:${root.agentId}`, agentId: root.agentId, parentTaskId: root.id,
        title: `${root.title} · 最终交付`, instructions:
          `子任务和复验均已结束。请按用户原始要求核对下列结果，由你作为本次工作负责人向群聊交付一次最终结果。不要再委派相同工作，不要向群聊汇报过程、分项流水账或复述员工原文；先用短句给出已核实的结果和对用户的影响，只附必要依据、重要风险和待决策事项。\n用户原始要求：${clip(root.source?.messageId ? room.getMessage(root.source.messageId)?.text : root.instructions, 3000)}\n此前公开的风险或待决策事项：${JSON.stringify((currentRoot.progress || []).filter(item => item.phase === 'group-notice').map(item => item.text))}\n子任务结果：${JSON.stringify(results)}`,
        source: root.source, publication: { role: 'owner-final', ownerTaskId: root.id },
        suppressContinuation: true, ...(root.modelProviderId ? { modelProviderId: root.modelProviderId } : {}),
        ...(root.model ? { model: root.model } : {}), ...(root.reasoningEffort ? { reasoningEffort: root.reasoningEffort } : {}),
        ...(root.taskRouting ? { taskRouting: root.taskRouting } : {}),
      });
      await writeOwnerStatus(currentRoot, '子任务和复验已结束，负责人正在整理最终交付。');
    } finally {
      finalizingOwners.delete(root.id);
    }
  };
  const ensureCoordinatedDelegations = async task => {
    const plan = task.source?.coordination;
    const current = kernel.get(task.id);
    if (!plan?.assignments?.length || task.agentId !== plan.receptionId || task.parentTaskId || task.resultOf
      || ['continuation', 'delegation', 'followup'].includes(task.kind) || !current || current.cancelRequested) return [];
    const children = kernel.list().filter(candidate => candidate.parentTaskId === task.id);
    const missing = plan.assignments.filter(assignment => !children.some(candidate => candidate.agentId === assignment.agentId));
    for (const assignment of missing) {
      const selection = await routeForTask(modelProviders, room.getAgent(assignment.agentId), {}, kernel.list());
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
  const enqueueDiscussion = async ({ agentIds, sourceMessageId, requestText, attachments = [], coordination = null, routing = null }) => {
    const tasks = [];
    for (const agentId of agentIds) {
      const requestKey = `message:${sourceMessageId}:${agentId}`;
      const source = { roomId, projectId: room.snapshot().room.projectId, messageId: sourceMessageId,
        routing: routing ? { reason: routing.reason, explicit: routing.reason === 'explicit',
          ...(routing.selection ? { selection: routing.selection } : {}) } : null,
        ...(coordination && agentId === coordination.receptionId ? { coordination } : {}) };
      const previous = kernel.list().find(task => task.conversationId === roomId && task.agentId === agentId
        && task.inputs?.some(input => input.requestId === requestKey));
      const running = previous || kernel.list().find(task => task.conversationId === roomId && task.agentId === agentId
        && task.state === 'running' && !task.cancelRequested && task.runtime.turnId
        && !task.parentTaskId && !task.resultOf && task.publication?.role !== 'owner-final');
      if (running) {
        const prior = running.inputs?.find(input => input.requestId === requestKey);
        log({ event: 'group_message_steered', messageId: sourceMessageId, taskId: running.id,
          agentId, role: running.publication?.role || 'reply' });
        const modelProviderId = running.runtime.modelProviderId || running.modelProviderId || 'current';
        const client = await clientFor({ modelProviderId, model: '' });
        let delivered = prior?.accepted;
        if (prior && !delivered) {
          const history = await client.request('thread/read', { threadId: running.runtime.threadId, includeTurns: true });
          delivered = history.thread?.turns?.some(turn => containsSubmittedInput(turn.items, requestKey));
          if (!delivered) {
            const turn = history.thread?.turns?.find(turn => turn.id === running.runtime.turnId);
            if (!turn || !terminalStates.has(turn.status)) throw Object.assign(Error('正在核对补充消息是否送达，请稍后重试'), { statusCode: 409 });
            const routing = await routingFields(agentId);
            tasks.push(await kernel.enqueue({ requestKey, conversationId: roomId, lane: `${roomId}:${agentId}`, agentId,
              title: requestText, instructions: requestText, source, publication: { role: 'reply' },
              attachmentIds: attachments.map(file => file.id), ...routing }));
            continue;
          }
        }
        if (!delivered) {
          const files = resolveAttachments(attachments.map(file => file.id));
          if (files.length !== attachments.length) throw Object.assign(Error('补充消息附件不可用'), { statusCode: 400 });
          const input = await inputFromAttachments(requestText, files, attachmentContent);
          modelProviders?.assertChannelAvailable?.(modelProviderId);
          await kernel.recordInput(running.id, { requestId: requestKey, submissionId: requestKey, messageId: sourceMessageId, turnId: running.runtime.turnId, text: requestText });
          let channel;
          try {
            channel = modelProviders?.assertChannelAvailable?.(modelProviderId);
            await steerTurn(client, { threadId: running.runtime.threadId, clientUserMessageId: requestKey, input }, running.runtime.turnId);
          } catch (error) {
            const failed = modelProviders?.executionRecords?.fail({ ...channel, modelProviderId, taskId: running.id,
              submissionId: sourceMessageId, threadId: running.runtime.threadId, turnId: running.runtime.turnId,
              model: running.runtime.model || running.model }, error);
            if (failed && error.code !== 'MODEL_CHANNEL_BALANCE') error.message = failed.reason;
            throw error;
          }
        }
        await kernel.acceptInput(running.id, requestKey);
        tasks.push(running);
      } else {
        const routing = await routingFields(agentId);
        tasks.push(await kernel.enqueue({ requestKey,
          conversationId: roomId, lane: `${roomId}:${agentId}`, agentId, title: requestText, instructions: requestText,
          source, publication: { role: 'reply' }, attachmentIds: attachments.map(file => file.id), ...routing }));
      }
    }
    if (coordination?.assignments?.length && tasks[0]) {
      await writeOwnerStatus(tasks[0],
        `已接手，正在安排：${coordination.assignments.map(item => item.agentName).join('、')}。`);
    }
    return { jobId: tasks[0]?.id, taskIds: tasks.map(task => task.id), agentIds, agentNames: agentIds.map(id => room.getAgent(id)?.name), status: 'queued' };
  };
  const inbox = await createMessageInbox({ stateFile: path.join(stateRoot, 'inbox.json'),
    publish: async entry => (await room.addMessageWithStatus({ ...entry.input.message, clientMessageId: entry.input.requestId })).message,
    dispatch: async (input, message, intake) => {
      const members = room.snapshot().agents;
      // FEAT-002 2026-11-07: employees are optional, so a group may have nobody to wake.
      if (!members.length) return { agentIds: [], agentNames: [], status: 'listening' };
      const quoted = message.replyTo?.id
        ? room.snapshot().messages.find(candidate => candidate.id === String(message.replyTo.id))
        : null;
      const replyAgentId = quoted?.type === 'agent'
        ? String(quoted.agentId || quoted.authorId || '').trim()
        : '';
      const selectionContext = buildGroupSelectionContext({
        messages: room.snapshot().messages.filter(candidate => candidate.id !== message.id),
        quoted,
      });
      const selector = selectGroupAgent === false ? null : selectGroupAgent ? { select: selectGroupAgent }
        : modelProviders ? groupMessageSelector : null;
      const routing = intake.routing || await routeMessage({ text: message.text, members, explicitIds: mentionedAgentIds(message.text, members),
        requestedIds: input.agentIds, replyAgentId, select: selector && (args => selector.select({
          ...args, origin: { threadId: roomId, submissionId: message.id },
        })), context: selectionContext,
        log });
      if (!intake.routing) await intake.saveRouting(routing);
      log({ event: 'message_routed', messageId: message.id, agentIds: routing.agentIds, reason: routing.reason });
      if (routing.reason === 'selector-failed' || routing.reason === 'selector-unavailable') {
        await room.addMessage({ type: 'system', authorId: 'system', authorName: '系统',
          workId: `route-error:${message.id}`, replyTo: { id: message.id },
          text: routing.reason === 'selector-unavailable'
            ? '群聊选人服务未连接，本条消息没有交给员工。请配置选人模型，或直接 @具体员工。'
            : '群聊选人模型没有返回有效员工，本条消息没有交给员工。请重新发送，或直接 @具体员工。' });
        return { agentIds: [], agentNames: [], status: 'clarification' };
      }
      return enqueueDiscussion({ agentIds: routing.agentIds, sourceMessageId: message.id,
        requestText: message.text || '请查看附件。', attachments: input.message.attachments, routing });
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
      const matched = (target.inputs || []).find(input => input.requestId !== 'initial' && containsSubmittedInput(items, input.submissionId));
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
              const active = history.thread?.turns?.find(turn => !terminalStates.has(turn.status) && containsSubmittedInput(turn.items, input.submissionId));
              if (!active?.id) { unresolved++; continue; }
              await interruptTurn(client, task.runtime.threadId, active.id);
            } else await queue.remove(task.runtime.threadId, pending.id);
            await kernel.cancelInput(task.id, input.requestId);
            } catch { unresolved++; }
          }
        }
      }
      await Promise.all(tasks.map(task => kernel.cancel(task.id, { suppressContinuation: true })));
      return { status: 'interrupting', interruptedAgentIds: tasks.map(task => task.agentId), cancelledDiscussionCount: tasks.length, unresolvedCount: unresolved };
    },
    close: async () => { closing = true; clearInterval(recoveryTimer); await recovery; await inbox.close(); await kernel.close(); await projection; await tools.close(); },
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
            const matches = (history.thread?.turns || []).filter(turn => containsSubmittedInput(turn.items, input.submissionId));
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
