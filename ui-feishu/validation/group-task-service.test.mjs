import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGroupTaskService, migrateGroupAgentThread } from '../server/group-task-service.mjs';
import { createGroupRoomStore } from '../../windows/server/group-room-store.mjs';
import { routeMessage } from '../kernel/message-routing.mjs';
import { mentionedAgentIds } from '../../windows/server/multi-agent/agent-routing.mjs';
import { createEmployeeGrowthStore } from '../../windows/server/employee-growth-store.mjs';
import { createEmployeeGrowthService } from '../../windows/server/employee-growth-service.mjs';
const until = async check => { const deadline = Date.now() + 4000; while (!check()) { if (Date.now() > deadline) assert.fail('condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

test('群聊自然语言不广播，明确点名优先', async () => {
  const members = [{ id: 'manager', name: '运营管理' }, { id: 'dev', name: '技术研发' }, { id: 'risk', name: '风控' }];
  for (const [text, expected] of [['大家好', ['manager']], ['大家看看这个需求', ['manager']], ['@技术研发 请看', ['dev']], ['@技术研发 @风控 请看', ['dev', 'risk']]]) {
    const result = await routeMessage({ text, members, explicitIds: mentionedAgentIds(text, members), receptionId: 'manager', allowBroadcast: false });
    assert.deepEqual(result.agentIds, expected);
  }
});

test('群内员工默认使用 DeepSeek，显式修改后重启仍保留', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-model-default-'));
  const stateFile = path.join(root, 'room.json');
  const defaultModelSettings = { modelProviderId: 'ccswitch_deepseek', model: 'deepseek-flash', reasoningEffort: 'high' };
  const createRoom = () => createGroupRoomStore({ stateFile, roomId: 'room', project: '测试',
    agentDefinitions: [{ id: 'manager', name: '运营管理' }], defaultModelSettings });
  let room = await createRoom();
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root,
    modelProviders: { resolveRoute: settings => settings }, appServerClient: null });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  assert.equal(room.getAgent('manager').model, 'deepseek-flash');
  assert.equal(room.getAgent('manager').modelProviderId, 'ccswitch_deepseek');
  await service.updateAgentSettings('manager', { modelProviderId: 'channel-explicit', model: 'model-explicit', reasoningEffort: 'low' });
  assert.equal(room.getAgent('manager').modelSelectionSource, 'explicit');
  await room.close();
  room = await createRoom();
  assert.equal(room.getAgent('manager').modelProviderId, 'channel-explicit');
  assert.equal(room.getAgent('manager').model, 'model-explicit');
  assert.equal(room.getAgent('manager').modelSelectionSource, 'explicit');
});

test('群员工 Provider 迁移保持 thread，失败继续旧来源且多个 agent 互不阻塞', async () => {
  const agents = new Map([
    ['a', { id: 'a', threadId: 'thread-a', modelProviderId: 'old-a', model: 'old-model-a',
      pendingModelSettings: { modelProviderId: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high', modelSelectionSource: 'default' } }],
    ['b', { id: 'b', threadId: 'thread-b', modelProviderId: 'old-b', model: 'old-model-b',
      pendingModelSettings: { modelProviderId: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high', modelSelectionSource: 'default' } }],
    ['explicit', { id: 'explicit', threadId: 'thread-explicit', modelProviderId: 'vip', model: 'chosen',
      modelSelectionSource: 'explicit', pendingModelSettings: null }],
  ]);
  const updates = [];
  const room = {
    getAgent: id => agents.get(id),
    updateAgent: async (id, patch) => { const next = { ...agents.get(id), ...patch }; agents.set(id, next); updates.push({ id, patch }); return next; },
  };
  const providers = { resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }) };
  const clientFor = async agent => ({ provider: agent.modelProviderId });
  const migrated = [];
  const migrate = (agent, fail = false) => migrateGroupAgentThread({
    agent, room, modelProviders: providers, clientFor,
    transferThread: async ({ source, target, threadId, route }) => {
      if (fail) throw Error('source unavailable');
      migrated.push({ id: agent.id, source: source.provider, target: target.provider, threadId, route });
    },
  });
  const [a, failed, explicit] = await Promise.all([
    migrate(agents.get('a')),
    migrate(agents.get('b'), true),
    migrate(agents.get('explicit')),
  ]);
  assert.equal(a.modelProviderId, 'deepseek');
  assert.equal(a.threadId, 'thread-a');
  assert.equal(failed.modelProviderId, 'old-b');
  assert.equal(failed.threadId, 'thread-b');
  assert.equal(explicit.modelProviderId, 'vip');
  assert.deepEqual(migrated, [{
    id: 'a', source: 'old-a', target: 'deepseek', threadId: 'thread-a',
    route: { modelProviderId: 'deepseek', model: 'deepseek-flash' },
  }]);
  assert.equal(updates.length, 1);
});

test('群内员工在真实下一轮先迁移后启动，同 thread 不重开', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-provider-migration-'));
  const stateFile = path.join(root, 'room.json');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(stateFile, JSON.stringify({ agents: [{
    id: 'manager', modelProviderId: 'old-provider', model: 'old-model', reasoningEffort: 'medium', threadId: 'group-thread',
  }] }));
  const defaultModelSettings = { modelProviderId: 'ccswitch_deepseek', model: 'deepseek-flash', reasoningEffort: 'high' };
  const room = await createGroupRoomStore({ stateFile, roomId: 'room', project: '测试',
    agentDefinitions: [{ id: 'manager', name: '运营管理' }], defaultModelSettings });
  const listeners = new Set();
  const turns = [];
  const calls = [];
  const client = {
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'thread/read') return { thread: { id: params.threadId, turns: [] } };
      if (method === 'thread/resume') return { thread: { id: params.threadId, turns: [] } };
      if (method === 'turn/start') {
        const turn = { id: 'turn', status: 'inProgress', items: [] };
        turns.push(params);
        queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/started', params: { threadId: params.threadId, turn } })));
        return { turn };
      }
      return {};
    },
  };
  let migrations = 0;
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root,
    modelProviders: { resolveRoute: settings => settings, getClient: async () => client }, appServerClient: client,
    transferThread: async ({ threadId, route }) => {
      migrations += 1;
      assert.equal(threadId, 'group-thread');
      assert.deepEqual(route, { modelProviderId: 'ccswitch_deepseek', model: 'deepseek-flash' });
      assert.equal(calls.some(call => call.method === 'turn/start'), false);
    } });
  t.after(async () => { await service.close(); await room.close(); });
  await service.receive({ requestId: 'migrate-next-turn', agentIds: [],
    message: { type: 'human', authorId: 'user', authorName: '用户', text: '继续处理', attachments: [] } });
  await until(() => turns.length === 1);
  assert.equal(migrations, 1);
  assert.equal(turns[0].threadId, 'group-thread');
  assert.equal(calls.find(call => call.method === 'thread/resume')?.params.model, 'deepseek-flash');
  assert.equal(room.getAgent('manager').threadId, 'group-thread');
  assert.equal(room.getAgent('manager').modelProviderId, 'ccswitch_deepseek');
  assert.equal(room.getAgent('manager').modelSelectionSource, 'default');
  assert.equal(room.getAgent('manager').pendingModelSettings, null);
  listeners.forEach(callback => callback({ method: 'turn/completed', params: {
    threadId: 'group-thread', turn: { id: 'turn', status: 'completed', items: [{ type: 'agentMessage', text: '迁移完成' }] },
  } }));
  await new Promise(resolve => setImmediate(resolve));
});

test('用户追加立即 steer 原 turn 且重试不重复派工', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-append-'));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId: 'room', project: '测试', agentDefinitions: [{ id: 'manager', name: '运营管理' }] });
  const listeners = new Set(); const calls = []; const thread = { id: 'thread', turns: [] };
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); }, request: async (method, params) => {
    calls.push(method);
    if (method === 'thread/start') return { thread };
    if (method === 'thread/read' || method === 'thread/resume') return { thread };
    if (method === 'turn/start') { const turn = { id: 'turn', status: 'inProgress', items: [] }; thread.turns.push(turn); queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/started', params: { threadId: thread.id, turn } }))); return { turn }; }
    if (method === 'turn/interrupt') { const turn = thread.turns[0]; turn.status = 'interrupted'; queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId: thread.id, turn } }))); }
    return {};
  } };
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root, appServerClient: client });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  const send = (id, text) => service.receive({ requestId: id, agentIds: [], message: { type: 'human', authorId: 'fixture', authorName: '测试', text, attachments: [] } });
  await send('first', '处理这个需求'); await until(() => service.tasks().some(task => task.state === 'running'));
  await send('second', '再补充一个条件'); await until(() => calls.includes('turn/steer'));
  await send('second', '再补充一个条件');
  assert.equal(service.tasks().length, 1);
  assert.equal(service.tasks().filter(task => task.state === 'queued').length, 0);
  assert.equal(calls.filter(method => method === 'turn/start').length, 1);
  assert.equal(calls.filter(method => method === 'turn/steer').length, 1);
  await service.interruptDiscussion();
  await until(() => !service.hasPendingWork() && service.deliveries().every(item => item.state === 'delivered'));
});

test('未送达的补充在原turn结束后重试为同线程后续任务', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-steer-finished-'));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId: 'room', project: '测试', agentDefinitions: [{ id: 'manager', name: '运营管理' }] });
  const stamp = new Date().toISOString();
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify({ version: 1, deliveries: [], tasks: [{ id: 'old', requestKey: 'old',
    conversationId: 'room', lane: 'room:manager', agentId: 'manager', state: 'completed', runtime: { threadId: 'thread', turnId: 'done' },
    source: { roomId: 'room' }, createdAt: stamp, updatedAt: stamp,
    inputs: [{ requestId: 'message:extra:manager', submissionId: 'message:extra:manager', text: '补充' }] }] }));
  const client = { subscribe: () => () => {}, request: async method => {
    if (method === 'thread/read') return { thread: { turns: [{ id: 'done', status: 'completed', items: [] }] } };
    throw Error('隔离测试不启动模型');
  } };
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root, appServerClient: client });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  await service.enqueueDiscussion({ agentIds: ['manager'], sourceMessageId: 'extra', requestText: '补充' });
  await service.enqueueDiscussion({ agentIds: ['manager'], sourceMessageId: 'extra', requestText: '补充' });
  assert.equal(service.tasks().filter(task => task.requestKey === 'message:extra:manager').length, 1);
});

test('重启时没有原生线程证据的待核对任务直接收敛且不再占用员工', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-state-'));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId: 'room', project: '验证',
    agentDefinitions: [{ id: 'manager', name: '运营管理' }] });
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify({ version: 1, deliveries: [], tasks: [{ id: 'unknown', requestKey: 'unknown', agentId: 'manager', conversationId: 'room', lane: 'room:manager', state: 'needs-reconciliation', runtime: { threadId: 'stale-thread' }, source: { roomId: 'room' }, createdAt: new Date().toISOString() }] }));
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  assert.equal(service.tasks()[0].state, 'interrupted');
  assert.equal(room.getAgent('manager').active, false);
});

test('丢失续派事件后重启从原线程历史恢复一次且不重发', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-followup-recovery-'));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId: 'room', project: '测试',
    agentDefinitions: [{ id: 'manager', name: '运营管理' }] });
  const now = new Date().toISOString();
  const source = { id: 'source', requestKey: 'source', agentId: 'manager', conversationId: 'room', lane: 'room:manager', state: 'completed', runtime: { threadId: 'source-thread' }, source: { roomId: 'room' }, createdAt: now, updatedAt: now };
  const target = { id: 'target', requestKey: 'target', agentId: 'manager', background: true, conversationId: 'handoff-test', lane: 'room:handoff-test:manager', state: 'completed', runtime: { threadId: 'background-thread', turnId: 'initial-turn' }, source: { roomId: 'room', agentId: 'manager' }, createdAt: now, updatedAt: now,
    inputs: [{ requestId: 'more', submissionId: 'submission', sourceTaskId: 'source', text: '追加', accepted: true }] };
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify({ version: 1, tasks: [source, target], deliveries: [] }));
  const listeners = new Set(); let starts = 0;
  const threads = { 'background-thread': { id: 'background-thread', turns: [{ id: 'followup-turn', status: 'completed', items: [{ type: 'userMessage', clientId: 'submission' }, { type: 'agentMessage', text: '恢复结果' }] }] }, 'source-thread': { id: 'source-thread', turns: [] } };
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); }, request: async (method, params) => {
    if (method === 'thread/read' || method === 'thread/resume') return { thread: threads[params.threadId] };
    if (method === 'turn/start') { starts++; assert.equal(params.threadId, 'source-thread'); const turn = { id: 'continuation', status: 'completed', items: [{ type: 'agentMessage', text: '已处理恢复结果' }] }; threads[params.threadId].turns.push(turn); return { turn }; }
    return {};
  } };
  let failedEntry = { id: 'failed-entry', submissionId: 'submission', state: 'failed' };
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root, appServerClient: client,
    modelProviders: { providers: () => [{ id: 'ccswitch_deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }] }],
      isProviderConfigured: async () => true, resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }), getClient: async () => client },
    registerSession: async () => {}, bindings: { bindRuntime: async () => {} },
    queue: { list: () => failedEntry ? [failedEntry] : [], remove: async () => { failedEntry = null; } } });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  await until(() => service.tasks().some(task => task.kind === 'followup' && task.state === 'completed'));
  await until(() => service.tasks().some(task => task.kind === 'continuation' && task.state === 'completed'));
  assert.equal(starts, 1);
  assert.equal(failedEntry, null, '历史确认后移除失败队列，避免重复发送');
  assert.equal(service.tasks().filter(task => task.kind === 'followup').length, 1);
  await service.onProtocolMessage({ method: 'turn/completed', params: { threadId: 'background-thread', turn: threads['background-thread'].turns[0] } });
  assert.equal(service.tasks().filter(task => task.kind === 'followup').length, 1);
});

test('held 续派不读历史，同轮 steer 只归属原 turn，无法确认停止不取消回报', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-steer-'));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId: 'room', project: '测试', agentDefinitions: [{ id: 'manager', name: '运营管理' }] });
  const now = new Date().toISOString();
  const target = { id: 'target', requestKey: 'target', agentId: 'manager', background: true, conversationId: 'handoff-test', lane: 'room:handoff-test:manager', state: 'completed', runtime: { threadId: 'background', turnId: 'initial' }, source: { roomId: 'room', agentId: 'manager' }, createdAt: now, updatedAt: now,
    inputs: [{ requestId: 'held', submissionId: 'held-id', sourceTaskId: 'source', text: '等待', accepted: true }] };
  const other = { id: 'other', requestKey: 'other', agentId: 'manager', conversationId: 'room', lane: 'room:manager', state: 'needs-reconciliation', runtime: {}, source: { roomId: 'room' }, createdAt: now, updatedAt: now };
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify({ version: 1, tasks: [target, other], deliveries: [] }));
  let reads = 0; let pending = { id: 'q', submissionId: 'held-id', held: true, state: 'pending' };
  const client = { subscribe: () => () => {}, request: async method => { if (method === 'thread/read') { reads++; return { thread: { turns: [] } }; } return {}; } };
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root, appServerClient: client,
    modelProviders: { providers: () => [{ id: 'ccswitch_deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }] }],
      isProviderConfigured: async () => true, resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }), getClient: async () => client },
    queue: { list: () => pending ? [pending] : [], remove: async () => { pending = null; } } });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(reads, 0, 'held 队列不触发历史读取');
  pending = { ...pending, held: false, state: 'dispatching' };
  assert.equal((await service.interruptDiscussion()).unresolvedCount, 1);
  assert.notEqual(service.tasks().find(task => task.id === 'target').inputs[0].cancelled, true);
  assert.equal(service.tasks().find(task => task.id === 'other').state, 'interrupted');
  pending = null;
  await service.onProtocolMessage({ method: 'item/completed', params: { threadId: 'background', turnId: 'initial', item: { type: 'userMessage', clientId: 'held-id' } } });
  assert.equal(service.tasks().find(task => task.id === 'target').inputs[0].turnId, 'initial');
  assert.equal(service.tasks().filter(task => task.kind === 'followup').length, 0);
});

test('其他群或其他员工不能续派来源员工的后台任务', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-isolation-'));
  const employees = ['manager', 'dev'].map(id => ({ id, contextRoot: root }));
  const registry = { list: () => employees, require: id => employees.find(employee => employee.id === id) };
  const growthStore = await createEmployeeGrowthStore({ stateFile: path.join(root, 'growth.json'), registry });
  const growthService = createEmployeeGrowthService({ registry, store: growthStore });
  const rule = await growthService.addRule('dev', '每次标注一手来源', 'manual');
  const listeners = new Set(); const threads = new Map(); const starts = [];
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); }, request: async (method, params) => {
    if (method === 'thread/start') { const thread = { id: `t${threads.size}`, turns: [], config: params.config }; threads.set(thread.id, thread); return { thread }; }
    const thread = threads.get(params.threadId);
    if (method === 'thread/resume') { thread.config = params.config; return { thread }; }
    if (method === 'thread/read') return { thread };
    if (method === 'turn/start') { const turn = { id: `v${starts.length}`, status: 'inProgress', items: [] }; thread.turns.push(turn); starts.push({ thread, turn, instructions: params.developerInstructions });
      queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/started', params: { threadId: thread.id, turn } }))); return { turn }; }
    if (method === 'turn/interrupt') { const turn = thread.turns.find(item => item.id === params.turnId); turn.status = 'interrupted';
      queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId: thread.id, turn } }))); }
    return {};
  } };
  const services = []; const rooms = [];
  for (const id of ['a', 'b']) {
    const room = await createGroupRoomStore({ stateFile: path.join(root, `${id}.json`), roomId: id, project: '测试',
      agentDefinitions: [{ id: 'manager', name: '运营管理' }, { id: 'dev', name: '技术研发' }] });
    rooms.push(room);
    services.push(await createGroupTaskService({ stateRoot: path.join(root, id), room, projectRoot: root, appServerClient: client, growthService,
      modelProviders: { providers: () => [{ id: 'ccswitch_deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }] }],
        isProviderConfigured: async () => true, resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }), getClient: async () => client },
      queue: { list: () => [], enqueue: async () => ({}), release: async () => ({}) }, execution: { getStatus: () => ({ active: false }) },
      registerSession: async () => {}, bindings: { bindRuntime: async () => {} } }));
  }
  t.after(async () => { await Promise.all(services.map(service => service.close())); await Promise.all(rooms.map(room => room.close())); await growthStore.close(); await fs.rm(root, { recursive: true, force: true }); });
  const send = (service, id, text) => service.receive({ requestId: id, agentIds: [], message: { type: 'human', authorId: 'fixture', authorName: '测试', text, attachments: [] } });
  const call = (index, body) => { const config = starts[index].thread.config['mcp_servers.negus_handoffs']; return fetch(config.env.NEGUS_HANDOFF_ENDPOINT,
    { method: 'POST', headers: { Authorization: `Bearer ${config.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); };
  await send(services[0], 'one', '@技术研发 工作');
  await until(() => starts.length === 1);
  const created = await call(0, { action: 'background', requestId: 'bg', title: '执行', instructions: '验证' });
  assert.equal(created.status, 200); const task = await created.json();
  await until(() => starts.length === 2);
  assert.match(starts[0].instructions, /每次标注一手来源/);
  assert.match(starts[1].instructions, /每次标注一手来源/);
  await growthService.changeRule('dev', rule.id, 'disabled');
  await send(services[1], 'two', '@技术研发 工作');
  await send(services[0], 'three', '@运营管理 工作');
  await until(() => starts.length === 4);
  assert.doesNotMatch(starts[2].instructions, /每次标注一手来源/);
  assert.match(starts[1].instructions, /每次标注一手来源/);
  for (const index of [2, 3]) {
    const response = await call(index, { action: 'followup', taskId: task.id, requestId: 'wrong', instructions: '不允许' });
    assert.equal(response.status, 403);
  }
  await Promise.all(services.map(service => service.interruptDiscussion()));
  await until(() => services.every(service => !service.hasPendingWork() && service.deliveries().every(item => item.state === 'delivered')));
});

test('运营与产品往返，研发与风控修复后复验', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-chain-'));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId: 'room', project: '测试', agentDefinitions: [
    { id: 'manager', name: '运营管理' }, { id: 'product', name: '产品分析' }, { id: 'dev', name: '技术研发' }, { id: 'risk', name: '风控' },
  ] });
  const listeners = new Set(); const threads = new Map(); const turns = [];
  const emit = (method, thread, turn) => listeners.forEach(callback => callback({ method, params: { threadId: thread.id, turn } }));
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); }, request: async (method, params) => {
    if (method === 'thread/start') { const thread = { id: `thread-${threads.size}`, turns: [], config: params.config }; threads.set(thread.id, thread); return { thread }; }
    const thread = threads.get(params.threadId);
    if (method === 'thread/resume') { thread.config = params.config; return { thread }; }
    if (method === 'thread/read') return { thread };
    if (method === 'turn/start') { const turn = { id: `turn-${turns.length}`, status: 'inProgress', items: [] }; thread.turns.push(turn); turns.push({ thread, turn, input: params.input });
      queueMicrotask(() => emit('turn/started', thread, turn)); return { turn }; }
    return {};
  } };
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root, appServerClient: client });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  const send = (id, text) => service.receive({ requestId: id, agentIds: [], message: { type: 'human', authorId: 'fixture', authorName: '测试', text, attachments: [] } });
  const handoff = async (index, agentId, requestId, instructions) => {
    const config = turns[index].thread.config['mcp_servers.negus_handoffs'];
    const response = await fetch(config.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${config.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delegate', requestId, agentId, title: instructions, instructions }) });
    assert.equal(response.status, 200);
  };
  const finish = (index, text) => { const { thread, turn } = turns[index]; turn.status = 'completed'; turn.items = [{ type: 'agentMessage', text }]; emit('turn/completed', thread, turn); };
  await send('ordinary', '分析需求'); await until(() => turns.length === 1);
  await handoff(0, 'product', 'product', '分析需求'); await until(() => turns.length === 2);
  finish(0, '请产品分析'); finish(1, '产品分析结果'); await until(() => turns.length === 3);
  assert.match(JSON.stringify(turns[2].input), /产品分析结果/); finish(2, '运营继续');
  await until(() => !service.hasPendingWork() && service.deliveries().every(item => item.state === 'delivered'));
  await send('dev', '@技术研发 修复'); await until(() => turns.length === 4);
  await handoff(3, 'risk', 'review', '检查方案'); await until(() => turns.length === 5);
  finish(3, '请风控检查'); finish(4, '发现问题'); await until(() => turns.length === 6);
  assert.match(JSON.stringify(turns[5].input), /发现问题/);
  await handoff(5, 'risk', 'recheck', '修复后复验'); await until(() => turns.length === 7);
  finish(5, '已修复并请复验'); finish(6, '复验通过'); await until(() => turns.length === 8);
  assert.match(JSON.stringify(turns[7].input), /复验通过/); finish(7, '研发完成');
  await until(() => !service.hasPendingWork() && service.deliveries().every(item => item.state === 'delivered'));
  for (const [text, agentId] of [['产品分析结果', 'product'], ['发现问题', 'risk'], ['复验通过', 'risk']])
    assert.equal(room.snapshot().messages.filter(message => message.text === text && message.agentId === agentId).length, 1);
});

test('group intake keeps sender IDs, routes ordinary messages, @ takes priority, task tool delivers back to source', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-tasks-'));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId: 'room', project: '验证', broadcast: () => {},
    agentDefinitions: [{ id: 'manager', name: '助手', responsibility: '接待' }, { id: 'b', name: '研究员', responsibility: '研究', reasoningEffort: 'high' }] });
  const listeners = new Set(); const threads = new Map(); const turns = []; let selectionCalls = 0;
  const emit = (method, threadId, turn, extra = {}) => listeners.forEach(callback => callback({ method, params: { threadId, turnId: turn.id, turn, ...extra } }));
  const complete = (threadId, turn, text) => {
    turn.items = [{ type: 'agentMessage', text }]; turn.status = 'completed';
    emit('item/completed', threadId, turn, { item: turn.items[0] }); emit('turn/completed', threadId, turn);
  };
  const client = {
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    request: async (method, params) => {
      if (method === 'thread/start') { const id = `thread-${threads.size}`; threads.set(id, { id, turns: [], config: params.config }); return { thread: { id } }; }
      const thread = threads.get(params.threadId);
      if (method === 'thread/resume') { thread.config = params.config; return { thread }; }
      if (method === 'thread/read') return { thread };
      if (method === 'turn/start') {
        const turn = { id: `turn-${turns.length}`, status: 'inProgress', items: [] }; thread.turns.push(turn); turns.push({ threadId: thread.id, turn, input: params.input, effort: params.effort });
        queueMicrotask(() => emit('turn/started', thread.id, turn));
        return { turn };
      }
      if (method === 'turn/interrupt') { const turn = thread.turns.find(item => item.id === params.turnId); turn.status = 'interrupted'; queueMicrotask(() => emit('turn/completed', thread.id, turn)); }
      return {};
    },
  };
  const registered = []; const queued = [];
  const queue = { list: threadId => queued.filter(item => item.threadId === threadId),
    enqueue: async input => { const item = { ...input, id: input.submissionId, state: 'pending' }; queued.push(item); return item; },
    release: async (threadId, id) => { const item = queued.find(entry => entry.threadId === threadId && entry.id === id); item.held = false; return item; },
    remove: async (threadId, id) => { const index = queued.findIndex(item => item.threadId === threadId && item.id === id); if (index < 0) throw Error('not found'); queued.splice(index, 1); } };
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root, appServerClient: client,
    modelProviders: { providers: () => [{ id: 'ccswitch_deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }] }],
      isProviderConfigured: async () => true, resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }), getClient: async () => client },
    queue, execution: { getStatus: () => ({ active: false }) }, registerSession: async (...args) => registered.push(args),
    bindings: { bindRuntime: async () => {} }, resolveAttachments: ids => ids.map(id => ({ id, name: 'fixture.txt', mimeType: 'text/plain', url: '/fixture', path: '/tmp/fixture.txt' })) });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  const send = (requestId, text, attachments = []) => service.receive({ requestId, agentIds: [], message: { type: 'human', authorId: 'u', authorName: '用户', text, attachments } });
  const first = await send('ordinary', '帮我研究一下');
  assert.equal(first.message.clientMessageId, 'ordinary');
  assert.equal((await send('ordinary', '帮我研究一下')).message.id, first.message.id);
  await until(() => turns.length === 1);
  assert.equal(service.tasks()[0].agentId, 'manager');
  complete(turns[0].threadId, turns[0].turn, '研究结果');
  await until(() => service.deliveries()[0]?.state === 'delivered');
  await send('mention', '@助手 请委派研究员查资料');
  await until(() => turns.length === 2);
  assert.equal(selectionCalls, 0);
  const source = service.tasks().find(task => task.source.messageId !== first.message.id);
  const config = threads.get(turns[1].threadId).config['mcp_servers.negus_handoffs'];
  const response = await fetch(config.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${config.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delegate', requestId: 'tool-1', agentId: 'b', title: '外派研究', instructions: '核查来源', notifySource: true }) });
  assert.equal(response.status, 200); const child = await response.json(); assert.equal(child.parentTaskId, source.id);
  await until(() => turns.length === 3);
  complete(turns[1].threadId, turns[1].turn, '已交给研究员');
  complete(turns[2].threadId, turns[2].turn, '来源核查完成');
  await until(() => turns.length === 4);
  assert.match(JSON.stringify(turns[3].input), /来源核查完成/);
  complete(turns[3].threadId, turns[3].turn, '根据研究结果汇总');
  await until(() => service.deliveries().length === 4 && service.deliveries().every(item => item.state === 'delivered'));
  assert.equal(room.snapshot().messages.filter(message => message.type === 'human').length, 2);
  assert.equal(room.snapshot().messages.filter(message => message.type === 'agent').length, 4);
  assert.equal(room.snapshot().messages.filter(message => message.text === '来源核查完成' && message.agentId === 'b').length, 1);
  assert.equal(room.snapshot().agents.length, 2);
  assert.equal(service.hasPendingWork(), false);

  await send('peer', '@研究员 请询问助手');
  await until(() => turns.length === 5);
  const peerConfig = threads.get(turns[4].threadId).config['mcp_servers.negus_handoffs'];
  const peerCall = async body => fetch(peerConfig.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${peerConfig.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  assert.equal((await peerCall({ action: 'delegate', requestId: 'self', agentId: 'b', title: '自派', instructions: '无效' })).status, 400);
  const peer = await peerCall({ action: 'delegate', requestId: 'peer-1', agentId: 'manager', title: '请教', instructions: '说明问题', notifySource: false });
  assert.equal(peer.status, 200);
  await until(() => turns.length === 6);
  const targetConfig = threads.get(turns[5].threadId).config['mcp_servers.negus_handoffs'];
  const cycle = await fetch(targetConfig.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${targetConfig.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delegate', requestId: 'cycle', agentId: 'b', title: '循环', instructions: '再次询问' }) });
  assert.equal(cycle.status, 200, '不同要求允许回访员工');
  complete(turns[4].threadId, turns[4].turn, '已请教');
  complete(turns[5].threadId, turns[5].turn, '请教结果');
  await until(() => turns.length === 7);
  complete(turns[6].threadId, turns[6].turn, '回访结果');
  await until(() => turns.length === 8);
  complete(turns[7].threadId, turns[7].turn, '处理回访结果');
  await until(() => !service.hasPendingWork() && service.deliveries().every(item => item.state === 'delivered'));
  assert.equal(turns.length, 8, '纯告知不唤醒来源员工');
  assert.equal(room.snapshot().messages.filter(message => message.text === '请教结果' && message.agentId === 'manager').length, 1);

  await send('background', '@研究员 请执行验证');
  await until(() => turns.length === 9);
  const originConfig = threads.get(turns[8].threadId).config['mcp_servers.negus_handoffs'];
  const call = async body => fetch(originConfig.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${originConfig.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await call({ action: 'background', requestId: 'bg-1', title: '验证', instructions: '运行检查', reasoningEffort: 'low' });
  assert.equal(result.status, 200);
  const background = await result.json();
  await until(() => turns.length === 10);
  assert.equal(registered[0][3].createdBy, 'assistant');
  assert.equal(registered[0][3].reasoningEffort, 'low');
  assert.equal(turns[8].effort, 'high');
  assert.equal(turns[9].effort, 'low');
  assert.equal(threads.get(turns[9].threadId).config['mcp_servers.negus_handoffs'].enabled, false);
  complete(turns[8].threadId, turns[8].turn, '已安排');
  complete(turns[9].threadId, turns[9].turn, '后台证据');
  await until(() => turns.length === 11);
  assert.match(JSON.stringify(turns[10].input), /后台证据/);
  assert.equal(room.snapshot().messages.some(message => message.text === '后台证据'), false);
  const continuationConfig = threads.get(turns[10].threadId).config['mcp_servers.negus_handoffs'];
  const followup = async () => fetch(continuationConfig.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${continuationConfig.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'followup', taskId: background.id, requestId: 'more', instructions: '补充验证' }) });
  assert.equal((await followup()).status, 200);
  assert.equal((await followup()).status, 200);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].actor, undefined);
  complete(turns[10].threadId, turns[10].turn, '继续验证');
  await until(() => service.tasks().find(task => task.id === background.id)?.state === 'completed');
  const followupTurn = { id: 'followup-turn', status: 'completed', items: [
    { type: 'userMessage', clientId: queued[0].submissionId }, { type: 'agentMessage', text: '补充证据' },
  ] };
  threads.get(turns[9].threadId).turns.push(followupTurn);
  await service.onProtocolMessage({ method: 'turn/completed', params: { threadId: turns[9].threadId, turn: followupTurn } });
  await service.onProtocolMessage({ method: 'turn/completed', params: { threadId: turns[9].threadId, turn: followupTurn } });
  queued.splice(0, 1);
  await until(() => turns.length === 12);
  assert.match(JSON.stringify(turns[11].input), /补充证据/);
  complete(turns[11].threadId, turns[11].turn, '复核完成');
  await until(() => !service.hasPendingWork() && service.deliveries().every(item => item.state === 'delivered'));
  assert.equal(service.tasks().filter(task => task.kind === 'followup').length, 1);
  assert.equal(room.snapshot().agents.find(agent => agent.id === 'b').active, false);
  await send('stop-followup', '@研究员 继续验证', [{ id: 'fixture-file', name: 'fixture.txt', mimeType: 'text/plain', url: '/fixture' }]);
  await until(() => turns.length === 13);
  const stopConfig = threads.get(turns[12].threadId).config['mcp_servers.negus_handoffs'];
  const stopResponse = await fetch(stopConfig.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${stopConfig.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'followup', taskId: background.id, requestId: 'stop-queued', instructions: '不再执行' }) });
  assert.equal(stopResponse.status, 200);
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].attachmentIds, ['fixture-file']);
  assert.equal(queued[0].attachments[0].path, undefined);
  await service.interruptDiscussion();
  assert.equal(queued.length, 0);
  assert.equal(service.tasks().find(task => task.id === background.id).inputs.find(item => item.requestId === 'stop-queued').cancelled, true);
  await until(() => !service.hasPendingWork() && service.deliveries().every(item => item.state === 'delivered'));
  await send('stop-running-followup', '@研究员 再次验证');
  await until(() => turns.length === 14);
  const runningConfig = threads.get(turns[13].threadId).config['mcp_servers.negus_handoffs'];
  const runningResponse = await fetch(runningConfig.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${runningConfig.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'followup', taskId: background.id, requestId: 'stop-running', instructions: '检查中' }) });
  assert.equal(runningResponse.status, 200);
  const runningTurn = { id: 'running-followup', status: 'inProgress', items: [{ type: 'userMessage', clientId: queued[0].submissionId }] };
  threads.get(turns[9].threadId).turns.push(runningTurn);
  await service.onProtocolMessage({ method: 'turn/started', params: { threadId: turns[9].threadId, turn: runningTurn } });
  await until(() => service.tasks().some(task => task.kind === 'followup' && task.runtime.turnId === runningTurn.id && task.state === 'running'));
  await service.interruptDiscussion();
  await until(() => !service.hasPendingWork() && service.deliveries().every(item => item.state === 'delivered'));
  assert.equal(service.tasks().find(task => task.runtime.turnId === runningTurn.id).state, 'interrupted');
});
