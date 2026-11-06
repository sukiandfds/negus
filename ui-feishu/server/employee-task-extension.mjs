import { backgroundTaskRoute, requestedBackgroundRoute } from '../../windows/server/background-tasks/model-policy.mjs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createTaskKernel, terminalStates } from '../kernel/task-kernel.mjs';
import { createNativeTaskRuntime } from '../kernel/native-task-runtime.mjs';
import { createTaskTools } from '../kernel/task-tools.mjs';
import { employeeTurnInstructions } from '../../windows/server/employee-definitions.mjs';
import { backgroundToolConfig, executionPolicy, turnExecutionPolicy } from './execution-policy.mjs';
import { createEmployeeHierarchy } from '../kernel/employee-hierarchy.mjs';
import { followupTask } from './task-followup.mjs';

// Adapts the same kernel to employee conversations and existing task conversations.
export async function extendEmployeeTasks(original, { stateRoot, registry, modelProviders, appServerClient,
  bindings, execution, queue, conversations, registerSession, providerForThread = async () => null, broadcast = () => {}, employeeHierarchy = null }) {
  let kernel;
  let closing = false;
  const taskProviders = new Map();
  const hierarchy = createEmployeeHierarchy({ employees: registry.list(), hierarchy: employeeHierarchy });
  const log = event => console.log(JSON.stringify({ scope: 'negus-tasks', channel: 'employee', at: new Date().toISOString(), ...event }));
  const clientFor = employee => modelProviders ? modelProviders.getClient(modelProviders.resolveRoute({ modelProviderId: employee.modelProviderId || 'current', model: employee.model || '' })) : appServerClient;
  const ordinaryScope = threadId => `ordinary:${threadId}`;
  const sourceActor = (providerId, model, sourceThreadId = '') => {
    const provider = modelProviders?.providers?.().find(entry => entry.id === providerId);
    const named = provider?.models?.find(entry => entry.model === model);
    return { id: sourceThreadId ? `assistant:${sourceThreadId}` : `assistant:${providerId || 'current'}:${model || 'default'}`,
      name: named?.displayName || model || 'Negus 助手' };
  };
  const handoffInstructions = '保持本员工的姓名、职位和职责，直接回答日常聊天和专业讨论，不自称“前台助手”，也不以派工为由推卸职责；尽量在30秒内回应。直接处理需求澄清、规划和结果汇总；开发、测试、验证、资料搜集、电脑操作等实操调用 negus_handoffs.create_background_task 创建独立任务对话，需要其他员工专长时可转交协作，由你负责汇总结果。派工时写清目标、输入、授权边界、验收步骤和返回格式（结论、证据路径、验证结果、失败原因）；工具确认接单后，简短告知用户并结束本轮回复，不等待、轮询或停止后台任务，主对话继续接待用户。创建失败须说明真实原因，不假称已派工。收到已有任务的结果通知时，先核对是否达到用户要求；接单或执行结束不等于工作完成。未完成则在原授权内继续处理或明确补派缺失部分，不重复派发同一任务、不只转述未完成就停下；依据返回证据核对标准，不重复执行已验证的操作；证据缺失或矛盾只补派缺项，完成后向用户简洁交付结果。';
  const backgroundInstructions = '你是独立后台任务执行者，直接执行本任务中用户已授权的工作并完成必要验证，不再创建或委派后台任务。最终回复包含实际结果、证据和未完成项，由系统送回来源助手；不要自行向来源对话发消息。';
  const instructions = (employee, background = false) => employeeTurnInstructions(employee.instructions, background
    ? backgroundInstructions
    : `${handoffInstructions}\n你只能向这些直属下属派工：${JSON.stringify(hierarchy.childrenOf(employee.id))}\n员工名单：${JSON.stringify(registry.list().map(({ id, name, responsibility }) => ({ id, name, responsibility })))}`);
  const followup = async (source, input) => {
    const target = kernel.get(input.taskId);
    const sameSource = target?.source?.threadId === source.runtime.threadId;
    if (!target || !sameSource || !target.runtime.threadId || !input.requestId || !input.instructions?.trim())
      throw Object.assign(Error('不能继续此后台任务'), { statusCode: 403 });
    return followupTask({ kernel, source, target, input, queue, execution, clientFor, providerForThread,
      actor: source.source?.actor || (source.agentId ? { id: source.agentId, name: registry.require(source.agentId).name } : null) });
  };
  const tools = await createTaskTools({ background: true, invoke: async (scope, input) => {
    const employeeScope = scope.startsWith('employee:');
    const ordinary = scope.startsWith('ordinary:');
    let source;
    if (ordinary) {
      const threadId = scope.slice('ordinary:'.length);
      const providerId = await providerForThread(threadId) || await conversations?.getVerifiedProviderForThread?.(threadId);
      if (!providerId || !conversations) throw Object.assign(Error('来源对话未登记'), { statusCode: 404 });
      const status = execution.getStatus(threadId);
      if (!status.active || !status.turnId) throw Object.assign(Error('来源对话当前没有正在处理的请求'), { statusCode: 409 });
      const info = await conversations.getSessionResumeInfo(threadId, { readOnly: true });
      const actor = sourceActor(providerId, info?.model || '', threadId);
      source = kernel.list().find(task => task.kind === 'external' && task.runtime.threadId === threadId && task.runtime.turnId === status.turnId)
        || await kernel.enqueue({ kind: 'external', requestKey: `source:${threadId}:${status.turnId}`,
          conversationId: threadId, lane: threadId, runtime: { threadId, turnId: status.turnId },
          source: { kind: 'conversation', threadId, providerId, cwd: info?.cwd || '', actor },
          title: '来源对话', instructions: '', suppressContinuation: true });
    } else if (employeeScope || scope.startsWith('conversation:')) {
      const binding = employeeScope ? null : bindings.findByRuntimeSession('codex', scope.slice('conversation:'.length));
      if (!employeeScope && binding?.conversationKind !== 'task') throw Object.assign(Error('任务对话不存在'), { statusCode: 404 });
      const employee = registry.require(employeeScope ? scope.slice('employee:'.length) : binding.agentId);
      const threadId = binding?.runtimeSessionId || employee.mainThreadId;
      const status = execution.getStatus(threadId);
      if (!status.active || !status.turnId) throw Object.assign(Error('来源对话当前没有正在处理的请求'), { statusCode: 409 });
      source = kernel.list().find(task => task.runtime.threadId === threadId && task.runtime.turnId === status.turnId)
        || await kernel.enqueue({ kind: 'external', requestKey: `source:${threadId}:${status.turnId}`,
        agentId: employee.id, conversationId: binding?.conversationId || employee.conversationId || threadId, lane: threadId,
        runtime: { threadId, turnId: status.turnId }, title: binding?.title || '员工对话', instructions: '', suppressContinuation: true });
    } else {
      source = kernel.get(scope);
      if (source && terminalStates.has(source.state)) {
        const status = execution.getStatus(source.runtime.threadId);
        if (status.active && status.turnId && status.turnId !== source.runtime.turnId) source = await kernel.enqueue({
          kind: 'external', requestKey: `source:${source.runtime.threadId}:${status.turnId}`, agentId: source.agentId,
          conversationId: source.conversationId, lane: source.runtime.threadId,
          runtime: { threadId: source.runtime.threadId, turnId: status.turnId }, title: source.title, instructions: '', suppressContinuation: true,
        });
      }
    }
    if (!source || terminalStates.has(source.state) || source.cancelRequested) throw Object.assign(Error('来源任务已经结束'), { statusCode: 409 });
    if (input.action === 'list') return { tasks: kernel.list().filter(task => task.parentTaskId === source.id || (source.source?.kind === 'conversation'
      ? task.source?.threadId === source.runtime.threadId : task.agentId === source.agentId)) };
    if (source.background) throw Object.assign(Error('后台执行者不能再次派工'), { statusCode: 409 });
    if (input.action === 'followup') {
      return followup(source, input);
    }
    const background = input.action === 'background';
    if (!background && input.action !== 'delegate') throw Object.assign(Error('不支持的任务操作'), { statusCode: 400 });
    // Resolve the actual source owner above, then enforce one downward edge in
    // the employee DAG at the handoff endpoint.
    const agentId = background ? source.agentId : input.agentId;
    if (!background) hierarchy.assertCanDelegate(source.agentId, agentId);
    if (agentId) registry.require(agentId);
    else if (source.source?.kind !== 'conversation' || !background) throw Object.assign(Error('执行员工不存在'), { statusCode: 400 });
    const selection = input.modelProviderId || input.model
      ? await requestedBackgroundRoute(modelProviders, { modelProviderId: input.modelProviderId, model: input.model }, kernel.list()) : null;
    const conversationId = `handoff-${createHash('sha256').update(`${source.id}:${input.requestId}`).digest('hex').slice(0,32)}`;
    const handoff = { requestId: input.requestId, agentId, background, title: input.title, instructions: input.instructions,
      ...(selection ? { modelProviderId: selection.modelProviderId, model: selection.model } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      conversationId, lane: conversationId, suppressContinuation: true,
      source: source.source?.kind === 'conversation' ? source.source
        : { threadId: source.runtime.threadId, agentId: source.agentId, conversationId: source.conversationId,
          actor: { id: source.agentId, name: registry.require(source.agentId).name } } };
    if (source.source?.kind === 'conversation') {
      const requestKey = `handoff:${source.runtime.threadId}:${input.requestId}`;
      return kernel.enqueue({ ...handoff, kind: 'delegation', parentTaskId: source.id, requestKey });
    }
    return kernel.delegate(source.id, handoff);
  } });
  const runtime = createNativeTaskRuntime({ log, resolve: async (task, controls, { recovering }) => {
    const agentless = task.source?.kind === 'conversation' && !task.agentId;
    let employee = agentless ? { id: '', name: task.source.actor?.name || 'Negus 助手', projectRoot: task.source.cwd || '',
      modelProviderId: task.source.providerId, model: '', reasoningEffort: '' } : registry.require(task.agentId);
    if (!['external', 'followup'].includes(task.kind)) employee = { ...employee, ...(task.modelProviderId
      ? { ...modelProviders.resolveRoute({ modelProviderId: task.modelProviderId, model: task.model }), reasoningEffort: task.reasoningEffort || '' }
      : task.runtime.modelProviderId
        ? { modelProviderId: task.runtime.modelProviderId, model: task.runtime.model || employee.model, reasoningEffort: task.runtime.reasoningEffort ?? employee.reasoningEffort }
        : await backgroundTaskRoute(modelProviders, employee)),
      ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}) };
    const observed = ['external', 'followup'].includes(task.kind);
    const related = observed && kernel?.list().find(candidate => candidate.runtime.threadId === task.runtime.threadId && candidate.runtime.modelProviderId);
    const modelProviderId = (observed && await providerForThread(task.runtime.threadId)) || task.runtime.modelProviderId || related?.runtime?.modelProviderId || employee.modelProviderId || 'current';
    const client = await clientFor({ ...employee, modelProviderId, ...(observed ? { model: '' } : {}) });
    let threadId = task.runtime.threadId;
    if (observed) {
      try {
        const response = await client.request('thread/read', { threadId, includeTurns: true });
        if (response.thread?.status?.type === 'notLoaded') throw Error('thread not loaded');
      } catch (error) {
        if (!/thread not loaded/i.test(error.message)) throw error;
        await client.request('thread/resume', { ...executionPolicy, threadId, persistExtendedHistory: true });
      }
      return { client, threadId };
    }
    if (!registerSession) throw Error('任务对话登记服务未连接');
    const register = async () => {
      if (!await providerForThread(threadId)) await registerSession({ threadId, source: 'codex', title: task.title,
        cwd: employee.projectRoot, updatedAt: task.createdAt, archived: false, conversationKind: 'task' },
      modelProviderId, modelProviderId !== 'current' && employee.model && !employee.model.includes('::')
        ? `${modelProviderId}::${employee.model}` : employee.model || '',
      { createdBy: 'assistant', reasoningEffort: employee.reasoningEffort || '' });
      if (!agentless) await bindings.bindRuntime({ conversationId: task.conversationId, agentId: employee.id, runtimeKind: 'codex', runtimeSessionId: threadId, conversationKind: 'task', title: task.title });
    };
    const taskInstructions = agentless
      ? backgroundInstructions
      : instructions(employee, task.background);
    const options = { ...executionPolicy, developerInstructions: taskInstructions, config: task.background ? backgroundToolConfig : tools.config(task.id),
      ...(employee.model ? { model: employee.model } : {}) };
    if (recovering) {
      if (threadId) { await register(); await client.request('thread/resume', { ...options, threadId, persistExtendedHistory: true }); }
      return { client, threadId };
    }
    if (controls.signal.aborted) return { client, threadId: threadId || 'cancelled-before-start', input: [] };
    if (threadId) {
      try {
        await register();
        await client.request('thread/resume', { ...options, threadId, persistExtendedHistory: true });
      } catch (error) { throw Object.assign(error, { ambiguous: true }); }
    } else {
      const started = await client.request('thread/start', { ...options, cwd: employee.projectRoot, ephemeral: false, serviceName: 'negus' });
      threadId = started.thread.id;
      await controls.checkpoint({ threadId, modelProviderId, model: employee.model, reasoningEffort: employee.reasoningEffort,
        registrationPending: true });
      try {
        await register();
        await client.request('thread/name/set', { threadId, name: task.title });
      } catch (error) { throw Object.assign(error, { ambiguous: true }); }
    }
    await kernel.recordInput(task.id, { requestId: 'initial', submissionId: task.id, text: task.instructions,
      actor: task.source?.actor || (task.source?.agentId ? { id: task.source.agentId, name: registry.require(task.source.agentId).name } : null) });
    return { client, threadId, input: [{ type: 'text', text: task.instructions, text_elements: [] }],
      turnOptions: { cwd: employee.projectRoot, ...turnExecutionPolicy, developerInstructions: taskInstructions,
        clientUserMessageId: task.id, ...(employee.reasoningEffort ? { effort: employee.reasoningEffort } : {}) } };
  } });
  const belongs = thread => kernel?.list().find(task => task.kind !== 'external' && task.runtime.threadId === thread.id);
  const publicTasks = () => kernel.list().filter(task => task.kind !== 'external').map(task => ({ ...task,
    employeeId: task.agentId || '', threadId: task.runtime.threadId || '',
    agentName: task.agentId ? registry.require(task.agentId).name
      : sourceActor(task.runtime.modelProviderId || task.modelProviderId, task.runtime.model || task.model).name }));
  const conversationTasks = () => [...publicTasks(), ...[...taskProviders.values()].flatMap(provider => provider.tasks()
    .filter(task => task.conversationId !== task.source?.roomId)
    .map(task => ({ ...task, threadId: task.runtime.threadId || '' })))];
  const sourceActorFor = (threadId, submissionId) => {
    if (!submissionId) return null;
    const tasks = [...kernel.list(), ...[...taskProviders.values()].flatMap(provider => provider.tasks())];
    for (const task of tasks) {
      if (task.runtime?.threadId !== threadId) continue;
      const actor = task.inputs?.find(input => input.submissionId === submissionId)?.actor;
      if (actor?.id && actor.name) return { authorId: actor.id, authorName: actor.name, displaySourceAgentId: actor.id };
    }
    const actor = original.actorFor?.(threadId, submissionId);
    return actor?.id && actor.name ? { authorId: actor.id, authorName: actor.name, displaySourceAgentId: actor.id } : null;
  };
  const actorRevisionFor = threadId => {
    const tasks = [...kernel.list(), ...[...taskProviders.values()].flatMap(provider => provider.tasks())];
    const inputs = tasks.filter(task => task.runtime?.threadId === threadId).flatMap(task => task.inputs || [])
      .filter(input => input.submissionId && input.actor?.id).map(input => [input.submissionId, input.actor.id, input.actor.name]);
    return inputs.length ? createHash('sha256').update(JSON.stringify(inputs.sort((a, b) => a[0].localeCompare(b[0])))).digest('hex').slice(0, 16) : '';
  };
  const decorateTaskSession = (threadId, session) => {
    if (!session) return session;
    const tasks = [...kernel.list(), ...[...taskProviders.values()].flatMap(provider => provider.tasks())];
    const inputs = new Map();
    for (const task of tasks) if (task.runtime?.threadId === threadId) {
      for (const input of task.inputs || []) if (input.submissionId && input.actor?.id) inputs.set(input.submissionId, input.actor);
    }
    const decorate = message => {
      const actor = message.role === 'user'
        ? inputs.get(message.submissionId) || original.actorFor?.(threadId, message.submissionId) : null;
      return actor ? { ...message, authorId: actor.id, authorName: actor.name, displaySourceAgentId: actor.id } : message;
    };
    return { ...session, ...(session.messages ? { messages: session.messages.map(decorate) } : {}),
      ...(session.upserts ? { upserts: session.upserts.map(decorate) } : {}) };
  };
  kernel = await createTaskKernel({ stateFile: path.join(stateRoot, 'tasks.json'), runtime, broadcast, log,
    validate: input => { if (input.source?.kind === 'conversation' && !input.agentId) {
      if (!input.source.threadId || !input.source.providerId || !input.source.actor?.id) throw Error('普通来源信息不完整');
    } else registry.require(input.agentId);
      if (input.kind === 'external' && (!input.runtime.threadId || !input.runtime.turnId)) throw Error('缺少来源执行信息'); },
    deliver: async ({ id, task, retryRequested }) => {
      if (task.kind === 'external' || (task.kind === 'followup' && !task.assistantFollowup)) return { nativeTurnId: task.runtime.turnId };
      tools.release(task.id);
      const source = task.source;
      if (!source?.threadId) throw Error('任务缺少来源对话');
      const registeredEmployee = source.kind === 'conversation' ? null : registry.require(source.agentId);
      const recordedSourceProvider = await providerForThread(source.threadId);
      const sourceEmployee = registeredEmployee
        ? { ...registeredEmployee, modelProviderId: recordedSourceProvider || registeredEmployee.modelProviderId,
          ...(recordedSourceProvider ? { model: '' } : {}) }
        : { modelProviderId: source.providerId, model: '' };
      const client = await clientFor(sourceEmployee);
      const marker = `[Negus任务结果 ${task.id}]`;
      const history = await client.request('thread/read', { threadId: source.threadId, includeTurns: true });
      const acknowledged = history.thread?.turns?.some(turn => turn.items?.some(item => item.type === 'userMessage' && JSON.stringify(item.content || []).includes(marker)));
      if (acknowledged) return { acknowledged: true, threadId: source.threadId };
      const sourceRestarted = () => {
        const status = execution.getStatus(source.threadId);
        return !kernel.get(task.parentTaskId)?.cancelRequested && !status.active && status.phase === 'interrupted' && status.interruptionReason === 'serviceRestart';
      };
      const sourceBlocked = (includeParent = true) => {
        const status = execution.getStatus(source.threadId);
        const parent = kernel.get(task.assistantFollowup?.sourceTaskId || task.parentTaskId);
        return !status.active && !sourceRestarted() && ((includeParent && (parent?.cancelRequested || ['failed', 'interrupted'].includes(parent?.state)))
          || ['failed', 'interrupted', 'systemError', 'waitingOnApproval', 'waitingOnUserInput'].includes(status.phase));
      };
      const blockedMessage = '来源对话已停止或暂停，结果尚未送达；可点击重新发送结果';
      if (!retryRequested && sourceBlocked()) throw Error(blockedMessage);
      const resultSubmissionId = `result:${id}`;
      const reportSourceTaskId = task.assistantFollowup?.sourceTaskId || task.parentTaskId;
      if (reportSourceTaskId && kernel.get(reportSourceTaskId)) await kernel.recordInput(reportSourceTaskId, { requestId: resultSubmissionId,
        submissionId: resultSubmissionId, text: marker, actor: task.agentId
          ? { id: task.agentId, name: registry.require(task.agentId).name }
          : sourceActor(task.runtime.modelProviderId || task.modelProviderId, task.runtime.model || task.model, task.runtime.threadId) });
      let receipt = await queue.enqueue({ threadId: source.threadId, submissionId: id, stableDispatchId: resultSubmissionId,
        text: `${marker}\n任务：${task.title}\n状态：${task.state}\n${task.error || task.result || (task.state === 'interrupted' ? '任务已中断，未完成。' : '未产生文字结果')}\n任务对话：/?thread=${task.runtime.threadId}${task.agentId ? `&agent=${task.agentId}` : ''}&conversation=${task.conversationId}\n这是已有任务的反馈，属于内部报告。先对照用户原始要求和验收证据核验；达到要求后简洁汇报实际结果。未达到要求或证据缺失、矛盾时，在原授权内继续处理或只补派缺项，不重复执行已验证工作，不重复创建相同任务；仅需用户决策时询问用户。` });
      if (retryRequested && receipt.state === 'failed') receipt = await queue.retry(source.threadId, receipt.id);
      if ((retryRequested && sourceBlocked(false)) || sourceRestarted()) {
        const queued = queue.list(source.threadId).find(item => item.submissionId === id);
        if (queued?.state === 'pending') receipt = await queue.sendNow(source.threadId, queued.id);
      }
      if (receipt.state === 'failed') throw Error(receipt.error || '来源对话的结果通知尚未发送');
      // Queue acceptance is not a delivery receipt. Wait until the native source history contains it.
      if (queue.list) {
        while (!closing) {
          const queued = queue.list(source.threadId).find(item => item.submissionId === id);
          if (queued?.state === 'failed') throw Error(queued.error || '结果通知发送失败');
          if (queued?.state === 'pending' && sourceBlocked(!retryRequested)) throw Error(blockedMessage);
          if (!queued) {
            const confirmed = await client.request('thread/read', { threadId: source.threadId, includeTurns: true });
            if (confirmed.thread?.turns?.some(turn => turn.items?.some(item => item.type === 'userMessage' && JSON.stringify(item.content || []).includes(marker)))) break;
            throw Error('尚未在来源对话中确认结果通知');
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (closing) throw Error('服务关闭，结果投递将在下次启动时核对');
      }
      return { queueId: receipt.id, threadId: source.threadId };
    },
  });
  // FEAT-001: completed tasks stay in the directory and need their original conversation binding too.
  for (const task of kernel.list()) {
    if (!terminalStates.has(task.state) || ['external', 'followup'].includes(task.kind) || !task.runtime.threadId || !task.conversationId || !task.agentId
      || bindings.findByRuntimeSession?.('codex', task.runtime.threadId)?.conversationId === task.conversationId) continue;
    await bindings.bindRuntime({ conversationId: task.conversationId, agentId: task.agentId, runtimeKind: 'codex', runtimeSessionId: task.runtime.threadId, conversationKind: 'task', title: task.title });
  }
  return { ...original,
    registerExistingBackground: async input => {
      const session = await conversations.registerExistingBackground(input);
      broadcast({ type: 'sessions_changed', threadId: session.threadId });
      return session;
    },
    onProtocolMessage: async event => {
      await original.onProtocolMessage?.(event);
      for (const provider of taskProviders.values()) {
        try { await provider.onProtocolMessage?.(event); }
        catch (error) { log({ event: 'task_provider_event_failed', error: error.message }); }
      }
      if (!['turn/started', 'turn/completed', 'item/started', 'item/completed'].includes(event.method)) return;
      const threadId = event.params?.threadId;
      const turnId = event.params?.turn?.id || event.params?.turnId;
      const binding = bindings.findByRuntimeSession?.('codex', threadId);
      const tracked = kernel.list();
      const known = tracked.find(task => task.runtime.threadId === threadId && task.kind !== 'external');
      if (!turnId || (binding?.conversationKind !== 'task' && !known) || (original.ownsThread(threadId) && !known)) return;
      const candidates = tracked.filter(task => task.runtime.threadId === threadId && task.kind !== 'followup');
      const directItems = [...(event.params?.turn?.items || []), event.params?.item].filter(Boolean);
      let userItems = directItems.filter(item => item.type === 'userMessage');
      if (!userItems.length && event.method === 'turn/completed') {
        const providerId = await providerForThread(threadId) || known?.runtime.modelProviderId;
        const client = await clientFor({ modelProviderId: providerId, model: '' });
        const history = await client.request('thread/read', { threadId, includeTurns: true });
        userItems = history.thread?.turns?.find(turn => turn.id === turnId)?.items?.filter(item => item.type === 'userMessage') || [];
      }
      const matched = candidates.flatMap(task => (task.inputs || []).flatMap(input => userItems.some(item =>
        item.clientId === input.submissionId || item.clientUserMessageId === input.submissionId) ? [{ task, input }] : []))[0];
      const existing = tracked.find(task => task.kind === 'followup' && task.runtime.threadId === threadId && task.runtime.turnId === turnId);
      if (existing) {
        if (matched && !existing.assistantFollowup) {
          await kernel.attributeFollowup(existing.id, matched.task.id, matched.input.submissionId, matched.input.sourceTaskId);
        }
        return;
      }
      if (tracked.some(task => task.runtime.threadId === threadId && !terminalStates.has(task.state))) return;
      if (!userItems.length && !['turn/started', 'turn/completed'].includes(event.method)) return;
      if (!known) return;
      await kernel.enqueue({ kind: 'followup', requestKey: `followup:${threadId}:${turnId}`,
        conversationId: binding?.conversationId || known.conversationId, lane: threadId, agentId: binding?.agentId || known.agentId,
        source: known.source, parentTaskId: known.parentTaskId, ...(matched ? { assistantFollowup: { parentTaskId: matched.task.id, submissionId: matched.input.submissionId, sourceTaskId: matched.input.sourceTaskId } } : {}),
        title: binding?.title || known.title || '任务对话', instructions: '', runtime: { threadId, turnId,
          modelProviderId: known.runtime.modelProviderId, model: known.runtime.model, reasoningEffort: known.runtime.reasoningEffort }, suppressContinuation: true });
    },
    leaderConfig: employeeId => tools.config(`employee:${employeeId}`),
    leaderInstructions: employeeId => `${handoffInstructions}\n你只能向这些直属下属派工：${JSON.stringify(hierarchy.childrenOf(employeeId))}\n员工名单：${JSON.stringify(registry.list().map(({ id, name, responsibility }) => ({ id, name, responsibility })))}`,
    runtimeOptions: thread => {
      if (thread.fresh) {
        const pending = ordinaryScope(`pending:${randomUUID()}`);
        return { resume: { ...executionPolicy, config: tools.config(pending) },
          bindThread: id => tools.bind(pending, ordinaryScope(id)) };
      }
      const task = belongs(thread) || [...taskProviders.values()].flatMap(provider => provider.tasks()).find(candidate => candidate.background && candidate.runtime?.threadId === thread.id);
      const binding = bindings.findByRuntimeSession?.('codex', thread.id);
      if (!task && binding?.conversationKind !== 'task') {
        const existing = original.runtimeOptions(thread);
        if (existing || original.ownsThread(thread.id) || registry.list().some(employee => employee.mainThreadId === thread.id)) return existing;
        return { resume: { ...executionPolicy, config: tools.config(ordinaryScope(thread.id)) },
          turn: { ...turnExecutionPolicy } };
      }
      if (!task && original.ownsThread(thread.id)) return original.runtimeOptions(thread);
      if (task?.source?.kind === 'conversation' && !task.agentId) return { resume: { ...executionPolicy, developerInstructions: backgroundInstructions, config: task.background ? backgroundToolConfig : tools.config(`conversation:${thread.id}`) },
        turn: { ...turnExecutionPolicy, developerInstructions: backgroundInstructions } };
      let employee = registry.require(task?.agentId || binding.agentId);
      if (task?.background) employee = { ...employee, reasoningEffort: task.reasoningEffort || task.runtime?.reasoningEffort || employee.reasoningEffort };
      return { resume: { ...executionPolicy, developerInstructions: instructions(employee, task?.background), config: task?.background ? backgroundToolConfig : tools.config(`conversation:${thread.id}`) },
        turn: { cwd: employee.projectRoot, ...turnExecutionPolicy, developerInstructions: instructions(employee, task?.background), ...(employee.reasoningEffort ? { effort: employee.reasoningEffort } : {}) } };
    },
    ownsThread: threadId => Boolean(belongs({ id: threadId })) || original.ownsThread(threadId)
      || bindings.findByRuntimeSession?.('codex', threadId)?.conversationKind === 'task',
    list: employeeId => [...original.list(employeeId), ...publicTasks().filter(task => !employeeId || task.agentId === employeeId)],
    directoryEntries: employeeId => [...original.directoryEntries(employeeId), ...conversationTasks().filter(task => (!employeeId || task.agentId === employeeId) && task.threadId && !task.archived).map(task => ({
      id: task.threadId, threadId: task.threadId, conversationId: task.conversationId, title: task.title, lastActivityAt: task.updatedAt,
      targetProjectId: task.source?.projectId || null,
      status: execution.getStatus(task.threadId).active ? execution.getStatus(task.threadId)
        : { ...execution.getStatus(task.threadId), active: !terminalStates.has(task.state), phase: task.state, label: task.state, detail: task.error || '' },
    }))],
    tasks: publicTasks, deliveries: kernel.deliveries, cancelTask: kernel.cancel, reconcileTask: kernel.reconcile, retryDelivery: kernel.retryDelivery, decorateTaskSession, sourceActorFor, actorRevisionFor,
    providerForThread: threadId => conversationTasks().find(task => task.threadId === threadId)?.runtime.modelProviderId,
    registerTaskProvider: (id, provider) => taskProviders.set(id, provider),
    hasPendingWork: () => original.hasPendingWork() || kernel.hasPendingWork(),
    close: async () => { closing = true; await kernel.close(); await tools.close(); await original.close(); },
  };
}
