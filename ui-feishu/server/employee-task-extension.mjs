import { backgroundTaskRoute } from '../../windows/server/background-tasks/model-policy.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTaskKernel, terminalStates } from '../kernel/task-kernel.mjs';
import { createNativeTaskRuntime } from '../kernel/native-task-runtime.mjs';
import { createTaskTools } from '../kernel/task-tools.mjs';
import { employeeTurnInstructions } from '../../windows/server/employee-definitions.mjs';
import { executionPolicy, turnExecutionPolicy } from './execution-policy.mjs';
import { createEmployeeHierarchy } from '../kernel/employee-hierarchy.mjs';

// Adapts the same kernel to employee conversations and existing task conversations.
export async function extendEmployeeTasks(original, { stateRoot, registry, modelProviders, appServerClient,
  bindings, execution, queue, broadcast = () => {}, employeeHierarchy = null }) {
  let kernel;
  let closing = false;
  const taskProviders = new Map();
  const hierarchy = createEmployeeHierarchy({ employees: registry.list(), hierarchy: employeeHierarchy });
  const log = event => console.log(JSON.stringify({ scope: 'negus-tasks', channel: 'employee', at: new Date().toISOString(), ...event }));
  const clientFor = employee => modelProviders ? modelProviders.getClient(modelProviders.resolveRoute({ modelProviderId: employee.modelProviderId || 'current', model: employee.model || '' })) : appServerClient;
  const handoffInstructions = '保持本员工的姓名、职位和职责，直接回答日常聊天和专业讨论，不自称“前台助手”，也不以派工为由推卸职责；尽量在30秒内回应。直接处理需求澄清、规划和结果汇总；开发、测试、验证、资料搜集、电脑操作等实操调用 negus_handoffs.create_background_task 创建独立任务对话，需要其他员工专长时可转交协作，由你负责汇总结果。派工时写清目标、输入、授权边界、验收步骤和返回格式（结论、证据路径、验证结果、失败原因）；工具确认接单后，简短告知用户并结束本轮回复，不等待、轮询或停止后台任务，主对话继续接待用户。创建失败须说明真实原因，不假称已派工。收到已有任务的结果通知时，先核对是否达到用户要求；接单或执行结束不等于工作完成。未完成则在原授权内继续处理或明确补派缺失部分，不重复派发同一任务、不只转述未完成就停下；依据返回证据核对标准，不重复执行已验证的操作；证据缺失或矛盾只补派缺项，完成后向用户简洁交付结果。';
  const instructions = (employee, background = false) => employeeTurnInstructions(employee.instructions, background
    ? '你是独立后台任务执行者，直接执行本任务中用户已授权的工作并完成必要验证，不再创建或委派后台任务。最终回复包含实际结果、证据和未完成项，由系统送回来源助手；不要自行向来源对话发消息。'
    : `${handoffInstructions}\n你只能向这些直属下属派工：${JSON.stringify(hierarchy.childrenOf(employee.id))}\n员工名单：${JSON.stringify(registry.list().map(({ id, name, responsibility }) => ({ id, name, responsibility })))}`);
  const tools = await createTaskTools({ background: true, invoke: async (scope, input) => {
    const employeeScope = scope.startsWith('employee:');
    let source;
    if (employeeScope || scope.startsWith('conversation:')) {
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
    if (input.action === 'list') return { tasks: kernel.list().filter(task => task.parentTaskId === source.id || task.agentId === source.agentId) };
    if (source.background) throw Object.assign(Error('后台执行者不能再次派工'), { statusCode: 409 });
    const background = input.action === 'background';
    if (!background && input.action !== 'delegate') throw Object.assign(Error('不支持的任务操作'), { statusCode: 400 });
    // Resolve the actual source owner above, then enforce one downward edge in
    // the employee DAG at the handoff endpoint.
    const agentId = background ? source.agentId : input.agentId;
    if (!background) hierarchy.assertCanDelegate(source.agentId, agentId);
    registry.require(agentId);
    const conversationId = `handoff-${createHash('sha256').update(`${source.id}:${input.requestId}`).digest('hex').slice(0,32)}`;
    return kernel.delegate(source.id, { requestId: input.requestId, agentId, background, title: input.title, instructions: input.instructions,
      conversationId, lane: conversationId, suppressContinuation: true,
      source: { threadId: source.runtime.threadId, agentId: source.agentId, conversationId: source.conversationId } });
  } });
  const runtime = createNativeTaskRuntime({ log, resolve: async (task, controls, { recovering }) => {
    let employee = registry.require(task.agentId);
    if (!['external', 'followup'].includes(task.kind)) employee = { ...employee, ...(task.runtime.modelProviderId
      ? { modelProviderId: task.runtime.modelProviderId, model: task.runtime.model || employee.model }
      : await backgroundTaskRoute(modelProviders, employee)) };
    const modelProviderId = task.runtime.modelProviderId || employee.modelProviderId || 'current';
    const client = await clientFor({ ...employee, modelProviderId });
    let threadId = task.runtime.threadId;
    if (['external', 'followup'].includes(task.kind)) return { client, threadId };
    const options = { ...executionPolicy, developerInstructions: instructions(employee, task.background), config: task.background ? {} : tools.config(task.id),
      ...(employee.model ? { model: employee.model } : {}) };
    if (recovering) {
      if (threadId) await client.request('thread/resume', { ...options, threadId, persistExtendedHistory: true });
      return { client, threadId };
    }
    if (controls.signal.aborted) return { client, threadId: threadId || 'cancelled-before-start', input: [] };
    const started = await client.request('thread/start', { ...options, cwd: employee.projectRoot, ephemeral: false, serviceName: 'negus' });
    threadId = started.thread.id;
    await controls.checkpoint({ threadId, modelProviderId, model: employee.model });
    await bindings.bindRuntime({ conversationId: task.conversationId, agentId: employee.id, runtimeKind: 'codex', runtimeSessionId: threadId, conversationKind: 'task', title: task.title });
    await client.request('thread/name/set', { threadId, name: task.title });
    return { client, threadId, input: [{ type: 'text', text: task.instructions, text_elements: [] }],
      turnOptions: { cwd: employee.projectRoot, ...turnExecutionPolicy, developerInstructions: instructions(employee, task.background), ...(employee.reasoningEffort ? { effort: employee.reasoningEffort } : {}) } };
  } });
  const belongs = thread => kernel?.list().find(task => task.kind !== 'external' && task.runtime.threadId === thread.id);
  const publicTasks = () => kernel.list().filter(task => task.kind !== 'external').map(task => ({ ...task,
    employeeId: task.agentId, threadId: task.runtime.threadId || '', agentName: registry.require(task.agentId).name }));
  const conversationTasks = () => [...publicTasks(), ...[...taskProviders.values()].flatMap(provider => provider.tasks()
    .filter(task => task.conversationId !== task.source?.roomId)
    .map(task => ({ ...task, threadId: task.runtime.threadId || '' })))];
  kernel = await createTaskKernel({ stateFile: path.join(stateRoot, 'tasks.json'), runtime, broadcast, log,
    validate: input => { registry.require(input.agentId); if (input.kind === 'external' && (!input.runtime.threadId || !input.runtime.turnId)) throw Error('缺少来源执行信息'); },
    deliver: async ({ id, task, retryRequested }) => {
      if (['external', 'followup'].includes(task.kind)) return { nativeTurnId: task.runtime.turnId };
      tools.release(task.id);
      const source = task.source;
      if (!source?.threadId) throw Error('任务缺少来源对话');
      const sourceEmployee = registry.require(source.agentId);
      const client = await clientFor(sourceEmployee);
      const marker = `[Negus任务结果 ${task.id}]`;
      const history = await client.request('thread/read', { threadId: source.threadId, includeTurns: true });
      const acknowledged = history.thread?.turns?.some(turn => turn.items?.some(item => item.type === 'userMessage' && JSON.stringify(item.content || []).includes(marker)));
      if (acknowledged) return { acknowledged: true, threadId: source.threadId };
      const sourceBlocked = (includeParent = true) => {
        const status = execution.getStatus(source.threadId);
        const parent = kernel.get(task.parentTaskId);
        return !status.active && ((includeParent && (parent?.cancelRequested || ['failed', 'interrupted'].includes(parent?.state)))
          || ['failed', 'interrupted', 'systemError', 'waitingOnApproval', 'waitingOnUserInput'].includes(status.phase));
      };
      const blockedMessage = '来源对话已停止或暂停，结果尚未送达；可点击重新发送结果';
      if (!retryRequested && sourceBlocked()) throw Error(blockedMessage);
      let receipt = await queue.enqueue({ threadId: source.threadId, submissionId: id,
        text: `${marker}\n任务：${task.title}\n状态：${task.state}\n${task.error || task.result || '未产生文字结果'}\n任务对话：/?agent=${task.agentId}&thread=${task.runtime.threadId}&conversation=${task.conversationId}\n这是已有任务的反馈，请据此回复；不要再次创建相同任务。` });
      if (retryRequested && receipt.state === 'failed') receipt = await queue.retry(source.threadId, receipt.id);
      if (retryRequested && sourceBlocked(false)) {
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
  return { ...original,
    onProtocolMessage: async event => {
      await original.onProtocolMessage?.(event);
      if (event.method !== 'turn/started') return;
      const threadId = event.params?.threadId;
      const turnId = event.params?.turn?.id || event.params?.turnId;
      const binding = bindings.findByRuntimeSession?.('codex', threadId);
      if (!turnId || binding?.conversationKind !== 'task' || original.ownsThread(threadId)) return;
      const tracked = [...kernel.list(), ...[...taskProviders.values()].flatMap(provider => provider.tasks())];
      if (tracked.some(task => task.runtime.threadId === threadId && (!terminalStates.has(task.state) || task.runtime.turnId === turnId))) return;
      await kernel.enqueue({ kind: 'followup', requestKey: `followup:${threadId}:${turnId}`,
        conversationId: binding.conversationId, lane: threadId, agentId: binding.agentId,
        title: binding.title || '任务对话', instructions: '', runtime: { threadId, turnId }, suppressContinuation: true });
    },
    leaderConfig: employeeId => tools.config(`employee:${employeeId}`),
    leaderInstructions: employeeId => `${handoffInstructions}\n你只能向这些直属下属派工：${JSON.stringify(hierarchy.childrenOf(employeeId))}\n员工名单：${JSON.stringify(registry.list().map(({ id, name, responsibility }) => ({ id, name, responsibility })))}`,
    runtimeOptions: thread => {
      const task = belongs(thread);
      const binding = bindings.findByRuntimeSession?.('codex', thread.id);
      if (!task && binding?.conversationKind !== 'task') return original.runtimeOptions(thread);
      if (!task && original.ownsThread(thread.id)) return original.runtimeOptions(thread);
      const employee = registry.require(task?.agentId || binding.agentId);
      return { resume: { ...executionPolicy, developerInstructions: instructions(employee, task?.background), config: task?.background ? {} : tools.config(`conversation:${thread.id}`) },
        turn: { cwd: employee.projectRoot, ...turnExecutionPolicy, developerInstructions: instructions(employee, task?.background), ...(employee.reasoningEffort ? { effort: employee.reasoningEffort } : {}) } };
    },
    ownsThread: threadId => Boolean(belongs({ id: threadId })) || original.ownsThread(threadId)
      || bindings.findByRuntimeSession?.('codex', threadId)?.conversationKind === 'task',
    list: employeeId => [...original.list(employeeId), ...publicTasks().filter(task => !employeeId || task.agentId === employeeId)],
    directoryEntries: employeeId => [...original.directoryEntries(employeeId), ...conversationTasks().filter(task => task.agentId === employeeId && task.threadId).map(task => ({
      id: task.threadId, threadId: task.threadId, conversationId: task.conversationId, title: task.title, lastActivityAt: task.updatedAt,
      targetProjectId: task.source?.projectId || null,
      status: execution.getStatus(task.threadId).active ? execution.getStatus(task.threadId)
        : { ...execution.getStatus(task.threadId), active: !terminalStates.has(task.state), phase: task.state, label: task.state, detail: task.error || '' },
    }))],
    tasks: publicTasks, deliveries: kernel.deliveries, cancelTask: kernel.cancel, reconcileTask: kernel.reconcile, retryDelivery: kernel.retryDelivery,
    providerForThread: threadId => conversationTasks().find(task => task.threadId === threadId)?.runtime.modelProviderId,
    registerTaskProvider: (id, provider) => taskProviders.set(id, provider),
    hasPendingWork: () => original.hasPendingWork() || kernel.hasPendingWork(),
    close: async () => { closing = true; await kernel.close(); await tools.close(); await original.close(); },
  };
}
