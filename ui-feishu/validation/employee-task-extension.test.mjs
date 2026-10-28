import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extendEmployeeTasks } from '../server/employee-task-extension.mjs';
const until = async check => { const end = Date.now() + 3000; while (!check()) { if (Date.now() > end) assert.fail('condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

for (const background of [false, true]) test(`employee ${background ? 'background' : 'delegation'} creates an independent conversation and receives its result`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-kernel-'));
  const employees = [{ id: 'a', name: '助手', modelProviderId: 'external', reasoningEffort: 'high', projectRoot: root, mainThreadId: 'main', conversationId: 'direct-a' }, { id: 'b', name: '研究员', modelProviderId: 'external', reasoningEffort: 'high', projectRoot: root }];
  const registry = { list: () => employees, require: id => { const employee = employees.find(item => item.id === id); if (!employee) throw Error('员工不存在'); return employee; } };
  const listeners = new Set(); const threads = new Map([['main', { id: 'main', turns: [{ id: 'main-turn', status: 'inProgress' }] }]]);
  const starts = []; const bindings = []; const results = []; const created = [];
  let mainActive = true;
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    request: async (method, params) => {
      if (method === 'thread/start') { created.push(params); const thread = { id: `child-${threads.size}`, turns: [] }; threads.set(thread.id, thread); return { thread }; }
      if (method === 'thread/read') return { thread: threads.get(params.threadId) };
      if (method === 'turn/start') {
        const turn = { id: `child-turn-${starts.length}`, status: 'inProgress', items: [] };
        threads.get(params.threadId).turns.push(turn); starts.push({ threadId: params.threadId, turn, effort: params.effort });
        queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/started', params: { threadId: params.threadId, turn } })));
        return { turn };
      }
      return {};
    } };
  const original = { leaderConfig: () => ({}), leaderInstructions: () => '', ownsThread: () => false, list: () => [], directoryEntries: () => [], runtimeOptions: () => null, hasPendingWork: () => false, close: async () => {} };
  const modelProviders = { providers: () => [{ id: 'vip', displayName: 'VIP', models: [{ model: 'gpt-6.1-terra' }] }],
    isProviderConfigured: async () => true, resolveRoute: route => route, getClient: async () => client };
  const extension = await extendEmployeeTasks(original, { stateRoot: root, registry, appServerClient: client, modelProviders,
    bindings: { bindRuntime: async binding => bindings.push(binding), findByRuntimeSession: (_, id) => bindings.find(binding => binding.runtimeSessionId === id) }, execution: { getStatus: id => ({ active: id === 'main' && mainActive, turnId: 'main-turn' }) },
    queue: { list: () => [], enqueue: async value => { results.push(value);
      threads.get(value.threadId).turns[0].items = [{ type: 'userMessage', content: [{ type: 'inputText', text: value.text }] }];
      return { id: value.submissionId, state: 'pending' }; } }, broadcast: () => {} });
  t.after(async () => { await extension.close(); await fs.rm(root, { recursive: true, force: true }); });
  const config = extension.leaderConfig('a')['mcp_servers.negus_handoffs'];
  const delegate = async requestId => {
    const response = await fetch(config.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${config.env.NEGUS_HANDOFF_TOKEN}` },
      body: JSON.stringify({ action: background ? 'background' : 'delegate', requestId, agentId: 'b', title: '调研', instructions: '查证来源' }) });
    assert.equal(response.status, 200); return response.json();
  };
  const child = await delegate('tool-1');
  assert.equal((await delegate('tool-1')).id, child.id);
  await until(() => starts.length === 1);
  assert.equal(created[0].model, 'gpt-6.1-terra');
  assert.equal(starts[0].effort, 'xhigh');
  const agentId = background ? 'a' : 'b';
  assert.equal(bindings.length, 1); assert.equal(bindings[0].conversationKind, 'task'); assert.equal(bindings[0].agentId, agentId);
  assert.notEqual(starts[0].threadId, 'main');
  await until(() => extension.tasks()[0]?.runtime.turnId === starts[0].turn.id);
  const initial = { id: 'codex:turn:first', itemId: 'first', turnId: starts[0].turn.id, turnItemIndex: 0, role: 'user', text: '查证来源' };
  const appended = { ...initial, id: 'codex:turn:next', itemId: 'next', turnItemIndex: 2, text: '用户追加' };
  const reply = { ...initial, id: 'codex:turn:reply', role: 'assistant' };
  const uncertain = { ...initial, id: 'jsonl:turn:first' };
  const decorated = extension.decorateTaskSession(starts[0].threadId, { messages: [initial, appended, reply, uncertain] }).messages;
  assert.equal(decorated[0].authorName, '助手');
  assert.equal(decorated[0].displaySourceAgentId, 'a');
  assert.equal(decorated[0].role, 'user');
  assert.deepEqual(decorated.slice(1), [appended, reply, uncertain]);
  assert.deepEqual(extension.decorateTaskSession('other-thread', { messages: [initial] }).messages, [initial]);
  extension.registerTaskProvider('room', { tasks: () => [
    { id: 'parent-b', agentId: 'b', runtime: {} },
    { id: 'child-b', kind: 'delegation', parentTaskId: 'parent-b', source: { roomId: 'room' }, runtime: { threadId: 'group-child', turnId: 'group-turn' } },
    { id: 'child-unknown', kind: 'delegation', source: {}, runtime: { threadId: 'unknown-child', turnId: 'group-turn' } },
  ] });
  const groupMessage = { ...initial, turnId: 'group-turn' };
  assert.equal(extension.decorateTaskSession('group-child', { messages: [groupMessage] }).messages[0].authorName, '研究员');
  assert.deepEqual(extension.decorateTaskSession('unknown-child', { messages: [groupMessage] }).messages, [groupMessage]);
  employees.find(employee => employee.id === agentId).modelProviderId = 'current';
  assert.equal(extension.providerForThread(starts[0].threadId), 'vip', 'task keeps its own provider when the employee switches');
  if (background) {
    assert.deepEqual(created[0].config, {});
    assert.match(created[0].developerInstructions, /直接执行本任务/);
    assert.match(extension.leaderInstructions('a'), /结束本轮回复/);
    mainActive = false;
    const parent = threads.get('main').turns[0]; parent.status = 'completed';
    listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId: 'main', turn: parent } }));
    await until(() => extension.deliveries().some(delivery => delivery.taskId === child.parentTaskId && delivery.state === 'delivered'));
    assert.equal(extension.tasks()[0].state, 'running', 'background work continues after the main reply ends');
  }
  const { threadId, turn } = starts[0]; turn.status = 'completed'; turn.items = [{ type: 'agentMessage', text: '核查完成' }];
  listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId, turn } }));
  await until(() => results.length === 1);
  assert.equal(results[0].threadId, 'main'); assert.match(results[0].text, /核查完成/);
  assert.equal(extension.tasks()[0].state, 'completed');
  assert.equal(extension.directoryEntries(agentId)[0].conversationId, child.conversationId);
  const followup = { id: 'user-followup', status: 'inProgress', items: [] };
  threads.get(threadId).turns.push(followup);
  await extension.onProtocolMessage({ method: 'turn/started', params: { threadId, turn: followup } });
  await until(() => extension.tasks().some(task => task.kind === 'followup' && task.state === 'running'));
  followup.status = 'completed'; followup.items = [{ type: 'agentMessage', text: '私聊的新回复' }];
  listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId, turn: followup } }));
  await until(() => extension.tasks().find(task => task.kind === 'followup')?.state === 'completed');
  await until(() => extension.deliveries().every(delivery => delivery.state === 'delivered'));
  assert.equal(results.length, 1, 'user continuation is private and does not notify the original source again');
});

for (const scenario of ['completed', 'running', 'cancel', 'missing']) test(`unloaded followup recovery: ${scenario}`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-followup-recovery-'));
  const threadId = 'original-thread';
  const task = { id: 'followup', kind: 'followup', requestKey: 'followup:original-thread:target', agentId: 'a',
    conversationId: 'conversation', lane: threadId, title: '任务', instructions: '', runtime: { threadId, turnId: 'target' },
    suppressContinuation: true, state: 'recovering', cancelRequested: scenario === 'cancel', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const parent = { ...task, id: 'parent', kind: 'delegation', state: 'completed', runtime: { threadId, turnId: 'other', modelProviderId: 'old-provider' } };
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify({ version: 1, tasks: [parent, task], deliveries: [] }));
  const listeners = new Set(); const calls = []; let loaded = false;
  const turns = [{ id: 'other', status: 'completed', items: [{ type: 'agentMessage', text: '别的回合' }] }];
  if (scenario !== 'missing') turns.push({ id: 'target', status: scenario === 'completed' ? 'completed' : 'inProgress', items: [{ type: 'agentMessage', text: '本回合' }] });
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); }, request: async (method, params) => {
    calls.push({ method, ...params });
    if (method === 'thread/resume') { loaded = true; return {}; }
    if (method === 'thread/read') { if (!loaded) throw Error('thread not loaded: original-thread'); return { thread: { status: { type: scenario === 'missing' ? 'idle' : 'active' }, turns } }; }
    if (method === 'turn/interrupt') return {};
    throw Error(`unexpected ${method}`);
  } };
  const employee = { id: 'a', name: '助手', modelProviderId: 'employee-provider', projectRoot: root };
  const routes = [];
  const original = { ownsThread: () => false, list: () => [], directoryEntries: () => [], hasPendingWork: () => false, close: async () => {} };
  const extension = await extendEmployeeTasks(original, { stateRoot: root, registry: { list: () => [employee], require: () => employee },
    modelProviders: { resolveRoute: route => { routes.push(route); return route; }, getClient: async () => client },
    providerForThread: async () => 'actual-provider', bindings: {}, execution: { getStatus: () => ({ active: false }) }, queue: {} });
  t.after(async () => { await extension.close(); await fs.rm(root, { recursive: true, force: true }); });
  await until(() => scenario === 'completed' ? extension.tasks().find(item => item.id === 'followup').state === 'completed'
    : scenario === 'missing' ? extension.tasks().find(item => item.id === 'followup').state === 'needs-reconciliation'
      : calls.some(call => call.method === (scenario === 'cancel' ? 'turn/interrupt' : 'thread/read') && loaded));
  assert.equal(routes[0].modelProviderId, 'actual-provider');
  assert.equal(calls.filter(call => call.method === 'thread/resume').length, 1);
  assert.equal(calls.filter(call => call.method === 'turn/start').length, 0);
  assert.equal(extension.tasks().find(item => item.id === 'parent').state, 'completed');
  if (scenario === 'completed') {
    assert.equal(extension.tasks().find(item => item.id === 'followup').result, '本回合');
    await extension.reconcileTask('followup');
    assert.equal(calls.filter(call => call.method === 'thread/resume').length, 1);
  } else if (scenario === 'missing') {
    assert.equal(extension.tasks().find(item => item.id === 'followup').state, 'needs-reconciliation');
  } else {
    assert.notEqual(extension.tasks().find(item => item.id === 'followup').state, 'completed');
    if (scenario === 'cancel') assert.deepEqual(calls.filter(call => call.method === 'turn/interrupt').map(call => call.turnId), ['target']);
    listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId, turn: { id: 'other', status: 'completed' } } }));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.notEqual(extension.tasks().find(item => item.id === 'followup').state, 'completed');
    listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId, turn: { id: 'target', status: scenario === 'cancel' ? 'interrupted' : 'completed', items: [] } } }));
    await until(() => extension.tasks().find(item => item.id === 'followup').state === (scenario === 'cancel' ? 'interrupted' : 'completed'));
    await until(() => extension.deliveries().some(delivery => delivery.taskId === 'followup' && delivery.state === 'delivered'));
  }
});
