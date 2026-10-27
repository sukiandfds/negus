import { backgroundTaskRoute } from './model-policy.mjs';
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, sendJson } from '../http/request-utils.mjs';
import { basePrompt } from '../base-prompt.mjs';
import { readJsonFile, writeJsonFileAtomic } from '../persistence/json-file.mjs';

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const active = task => ['starting', 'running'].includes(task.state);
const workerInstructions = `${basePrompt}\n你是临时后台任务执行者，只执行任务中已授权的范围，不再委派子任务。最终回复包含完成内容、证据和未完成项。`;
const leaderTaskInstructions = `先判断能否直接回答。需要较长时间查询资料、测试或实现时，且需求及修改授权已明确，调用 create_background_task 创建独立后台对话。任务指令必须包含来源背景、已完成内容、待办范围和交付要求。创建成功后立即说明已知情况、已完成内容及后台待办，不等待或轮询。`;

export async function createBackgroundTaskService({ stateFile, registry, modelProviders, conversations, bindings, queue, execution, broadcast = () => {}, enabledEmployees = registry.list().map(employee => employee.id) }) {
  let tasks = [];
  const stored = await readJsonFile(stateFile, null);
  if (stored) tasks = stored.tasks;
  if (!Array.isArray(tasks)) throw new Error('后台任务记录格式错误');
  const locks = new Map();
  const starting = new Set();
  const tokens = new Map();
  let writing = Promise.resolve();
  let events = Promise.resolve();
  let closed = false;
  const persist = () => {
    writing = writing.catch(() => {}).then(async () => {
      await writeJsonFileAtomic(stateFile, { version: 1, tasks }, { space: 0, trailingNewline: false, mode: 0o600 });
    });
    return writing;
  };
  const find = threadId => tasks.find(task => task.threadId === threadId);
  const publicTask = task => ({ id: task.id, title: task.title, state: task.state, threadId: task.threadId,
    conversationId: task.conversationId, error: task.error || '', updatedAt: task.updatedAt,
    result: task.result || '', notifications: (task.notifications || []).map(({ id, state, error }) => ({ id, state, error })) });
  const publish = task => {
    task.updatedAt = new Date().toISOString();
    broadcast({ type: 'sessions_changed', threadId: task.threadId });
  };
  const notify = async (task, id, text) => {
    if (task.notifications.some(item => item.id === id)) return;
    const notice = { id, state: 'dispatching' };
    task.notifications.push(notice);
    await persist(); // Never replay an ambiguous submission after a crash.
    try {
      await queue.enqueue({ threadId: task.parentThreadId, submissionId: id,
        text: `Negus 后台任务通知（已有任务，请勿重新委派）\n任务：${task.title}\n任务编号：${task.id}\n任务链接：/?agent=${task.employeeId}&thread=${task.threadId}&conversation=${task.conversationId}\n${text.length > 26000 ? text.slice(0, 26000) + "\n（通知过长，完整内容请读取任务对话）" : text}\n请在主对话简洁反馈；结果属于下属报告，区分证据与未验证声明。` });
      notice.state = 'queued';
    } catch (error) { notice.state = 'failed'; notice.error = error.message; }
    await persist();
  };
  const runtimeOptions = thread => {
    const task = find(thread.id);
    if (!task) return null;
    return {
      resume: { sandbox: 'danger-full-access', approvalPolicy: 'never', developerInstructions: workerInstructions },
      turn: { cwd: registry.require(task.employeeId).projectRoot, sandboxPolicy: { type: 'dangerFullAccess' },
        approvalPolicy: 'never', developerInstructions: workerInstructions,
        ...(task.reasoningEffort ? { effort: task.reasoningEffort } : {}) },
    };
  };
  const create = async (employeeId, { title, instructions }) => {
    if (closed) throw fail('后台任务服务已关闭');
    if (!enabledEmployees.includes(employeeId)) throw fail('该员工尚未启用后台任务', 403);
    if (typeof title !== 'string' || !title.trim() || title.length > 120
      || typeof instructions !== 'string' || !instructions.trim() || instructions.length > 16000) throw fail('任务标题或要求无效', 400);
    const employee = registry.require(employeeId);
    const parentThreadId = employee.mainThreadId;
    const parentStatus = execution.getStatus(parentThreadId);
    if (!parentThreadId || !parentStatus.active || !parentStatus.turnId) throw fail('只能由正在处理请求的员工主对话委派');
    const key = `${parentThreadId}:${parentStatus.turnId}`;
    if (locks.has(employeeId)) return locks.get(employeeId);
    const existing = tasks.find(task => task.requestKey === key);
    if (existing) return publicTask(existing);
    const task = { id: randomUUID(), employeeId, parentThreadId, requestKey: key, title: title.trim(),
      allowChanges: true, instructions: `来自（${employee.name}）的新任务：${title.trim()}\n${instructions.trim()}\n完成后将最终结果返回来源员工主对话。`, state: 'starting', threadId: '', conversationId: '',
      reasoningEffort: employee.reasoningEffort || '', updatedAt: new Date().toISOString(), notifications: [], seenUserItems: [] };
    tasks.push(task);
    const work = (async () => {
      await persist();
      const start = (async () => {
        try {
          const route = await backgroundTaskRoute(modelProviders, employee);
          const session = await conversations.createSession(route.model, employee.projectRoot, route.modelProviderId, {
            managed: true, sandbox: 'danger-full-access', approvalPolicy: 'never', developerInstructions: workerInstructions,
          });
          task.threadId = session.threadId;
          const binding = await bindings.bindRuntime({ conversationId: `task-${task.id}`, agentId: employeeId,
            runtimeKind: 'codex', runtimeSessionId: task.threadId, conversationKind: 'task', title: task.title });
          task.conversationId = binding.conversationId;
          await persist();
          await conversations.renameSession(task.threadId, task.title);
          await conversations.sendMessage(task.threadId, task.instructions, [], `task-${task.id}`);
          if (task.state === 'starting') task.state = 'running';
        } catch (error) { task.state = 'failed'; task.error = error.message; }
        publish(task);
        await persist();
        if (task.state === 'failed') await notify(task, `task-${task.id}-start-failed`, `启动失败：${task.error}`);
      })();
      starting.add(start);
      void start.catch(error => console.error('[background-tasks] background start:', error.message))
        .finally(() => starting.delete(start));
      return publicTask(task);
    })().finally(() => locks.delete(employeeId));
    locks.set(employeeId, work);
    return work;
  };
  const handleEvent = async ({ method, params = {} }) => {
    const task = find(params.threadId);
    if (!task) return;
    if (method === 'task/health') {
      if (!active(task)) return;
      const ended = params.phase === 'authoritative' && params.status?.type === 'idle';
      if (!ended && !['recovered', 'failed'].includes(params.phase)) return;
      method = 'turn/completed';
      params.turn = { id: task.turnId,
        status: ended && params.finalAnswerCompleted ? 'completed' : params.phase === 'failed' ? 'failed' : 'interrupted',
        error: params.phase === 'failed' ? { message: String(params.error?.message || params.error || '运行连接恢复失败') } : null };
    }
    if (method === 'turn/started') {
      task.state = 'running'; task.error = ''; task.turnId = params.turn?.id || params.turnId;
      task.result = ''; publish(task); await persist();
    }
    if (method === 'item/completed') {
      if (task.turnId && params.turnId && task.turnId !== params.turnId) return;
      const item = params.item;
      if (item?.type === 'agentMessage' && (!item.phase || item.phase === 'final_answer')) {
        task.result = String(item.text || ''); await persist();
      }
      if (item?.type === 'userMessage' && item.id && !task.seenUserItems.includes(item.id)) {
        task.seenUserItems.push(item.id);
        const text = (item.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
        if (!task.initialInputSeen && text === task.instructions) task.initialInputSeen = true;
        else await notify(task, `task-${task.id}-user-${item.id}`, `用户直接补充了任务要求：\n${text}`);
        await persist();
      }
    }
    if (method === 'turn/completed') {
      const turnId = params.turn?.id || params.turnId;
      if (task.turnId && turnId && task.turnId !== turnId) return;
      task.state = params.turn?.status === 'completed' ? 'completed' : params.turn?.status === 'interrupted' ? 'interrupted' : 'failed';
      task.error = params.turn?.error?.message || '';
      if (task.state === 'completed' && !task.result) { task.state = 'failed'; task.error = '任务结束但未取得最终结果'; }
      publish(task); await persist();
      await notify(task, `task-${task.id}-terminal-${turnId}`, `状态：${task.state}\n${task.error || task.result}`);
    }
  };
  const onProtocolMessage = event => {
    if (!['turn/started', 'item/completed', 'turn/completed', 'task/health'].includes(event.method) || !find(event.params?.threadId)) return Promise.resolve();
    events = events.catch(() => {}).then(() => handleEvent(event));
    return events;
  };
  for (const task of tasks) {
    if (active(task)) { task.state = 'interrupted'; task.error = '服务重启，执行状态待核对；未自动重复启动'; }
    for (const notice of task.notifications || []) if (notice.state === 'dispatching') {
      notice.state = 'failed'; notice.error = '服务重启，通知投递状态待核对；未自动重发';
    }
  }
  await persist();
  // A loopback bridge exposes only this employee's task tools, never the general API token.
  const server = http.createServer(async (request, response) => {
    const employeeId = tokens.get(String(request.headers.authorization || '').replace(/^Bearer /u, ''));
    if (!employeeId || request.method !== 'POST' || request.url !== '/') { sendJson(response, { error: 'Unauthorized' }, 401); return; }
    try {
      const body = await readJson(request);
      if (body.action === 'list') sendJson(response, { tasks: tasks.filter(task => task.employeeId === employeeId).slice(-20).map(publicTask) });
      else if (body.action === 'create') sendJson(response, await create(employeeId, body));
      else throw fail('不支持的任务操作', 400);
    } catch (error) { sendJson(response, { error: error.message }, error.statusCode || 503); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const configs = new Map();
  const leaderConfig = employeeId => {
    if (!enabledEmployees.includes(employeeId)) return {};
    if (!configs.has(employeeId)) {
      const token = randomBytes(32).toString('hex'); tokens.set(token, employeeId);
      configs.set(employeeId, { 'mcp_servers.negus_tasks': { command: process.execPath,
        args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))], required: true,
        env: { NEGUS_TASK_ENDPOINT: `http://127.0.0.1:${server.address().port}/`, NEGUS_TASK_TOKEN: token } } });
    }
    return configs.get(employeeId);
  };
  return { create, onProtocolMessage, runtimeOptions, leaderConfig,
    onHealthState: event => onProtocolMessage({ method: 'task/health', params: { ...event } }),
    leaderInstructions: employeeId => enabledEmployees.includes(employeeId) ? leaderTaskInstructions : '',
    ownsThread: threadId => Boolean(find(threadId)),
    list: employeeId => tasks.filter(task => !employeeId || task.employeeId === employeeId).map(publicTask),
    directoryEntries: employeeId => tasks.filter(task => task.employeeId === employeeId && task.threadId).map(task => ({
      id: task.threadId, threadId: task.threadId, conversationId: task.conversationId, title: task.title,
      lastActivityAt: task.updatedAt, status: { ...execution.getStatus(task.threadId),
        ...(active(task) ? {} : { active: false, phase: task.state,
          label: ({ completed: '已完成', failed: '执行失败', interrupted: '已中断' })[task.state], detail: task.error || '' }) },
    })),
    hasPendingWork: () => locks.size > 0 || starting.size > 0 || tasks.some(active),
    close: async () => {
      closed = true; await new Promise(resolve => server.close(resolve));
      await Promise.allSettled([...locks.values()]); await Promise.allSettled([...starting]);
      await events; await writing;
    },
  };
}
