import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extendEmployeeTasks } from '../server/employee-task-extension.mjs';
import { messageFromThreadItem } from '../../windows/server/content-blocks.mjs';
import { createFollowUpQueueStore } from '../../windows/server/follow-up-queue-store.mjs';
import { createFollowUpQueueService } from '../../windows/server/follow-up-queue-service.mjs';
import { createEmployeeGrowthStore } from '../../windows/server/employee-growth-store.mjs';
import { createEmployeeGrowthService } from '../../windows/server/employee-growth-service.mjs';
const until = async check => { const end = Date.now() + 3000; while (!check()) { if (Date.now() > end) assert.fail('condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

for (const background of [false, true]) test(`employee ${background ? 'background' : 'delegation'} creates an independent conversation and receives its result`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-kernel-'));
  const employees = [{ id: 'a', name: '助手', modelProviderId: 'external', reasoningEffort: 'high', projectRoot: root, mainThreadId: 'main', conversationId: 'direct-a' }, { id: 'b', name: '研究员', modelProviderId: 'external', reasoningEffort: 'high', projectRoot: root }];
  const registry = { list: () => employees, require: id => { const employee = employees.find(item => item.id === id); if (!employee) throw Error('员工不存在'); return employee; } };
  employees.forEach(employee => { employee.contextRoot = root; });
  const growthStore = await createEmployeeGrowthStore({ stateFile: path.join(root, 'growth.json'), registry });
  const growthService = createEmployeeGrowthService({ registry, store: growthStore });
  const rule = await growthService.addRule(background ? 'a' : 'b', '每次标注一手来源', 'manual');
  const listeners = new Set(); const threads = new Map([['main', { id: 'main', turns: [{ id: 'main-turn', status: 'inProgress' }] }]]);
  const starts = []; const bindings = []; const results = []; const created = []; const registrations = [];
  let mainActive = true;
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    request: async (method, params) => {
      if (method === 'thread/start') { created.push(params); const thread = { id: `child-${threads.size}`, turns: [] }; threads.set(thread.id, thread); return { thread }; }
      if (method === 'thread/read') return { thread: threads.get(params.threadId) };
      if (method === 'turn/start') {
        const turn = { id: `child-turn-${starts.length}`, status: 'inProgress', items: [] };
        threads.get(params.threadId).turns.push(turn); starts.push({ threadId: params.threadId, turn, effort: params.effort, instructions: params.developerInstructions });
        queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/started', params: { threadId: params.threadId, turn } })));
        return { turn };
      }
      return {};
    } };
  const original = { leaderConfig: () => ({}), leaderInstructions: () => '', ownsThread: () => false, list: () => [], directoryEntries: () => [], runtimeOptions: () => null, hasPendingWork: () => false, close: async () => {} };
  const modelProviders = { providers: () => [{ id: 'vip', displayName: 'VIP', models: [{ model: 'gpt-6.1-terra' }] }],
    isProviderConfigured: async () => true, resolveRoute: route => route, getClient: async () => client };
  const extension = await extendEmployeeTasks(original, { stateRoot: root, registry, growthService, appServerClient: client, modelProviders,
    registerSession: async (...args) => registrations.push(args),
    bindings: { bindRuntime: async binding => bindings.push(binding), findByRuntimeSession: (_, id) => bindings.find(binding => binding.runtimeSessionId === id) }, execution: { getStatus: id => ({ active: id === 'main' && mainActive, turnId: 'main-turn' }) },
    queue: { list: () => [], enqueue: async value => { results.push(value);
      threads.get(value.threadId).turns[0].items = [{ type: 'userMessage', content: [{ type: 'inputText', text: value.text }] }];
      return { id: value.submissionId, state: 'pending' }; } }, broadcast: () => {} });
  t.after(async () => { await extension.close(); await growthStore.close(); await fs.rm(root, { recursive: true, force: true }); });
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
  assert.match(starts[0].instructions, /每次标注一手来源/);
  assert.match(extension.runtimeOptions({ id: starts[0].threadId }).turn.developerInstructions, /每次标注一手来源/);
  await growthService.changeRule(background ? 'a' : 'b', rule.id, 'disabled');
  assert.doesNotMatch(extension.runtimeOptions({ id: starts[0].threadId }).turn.developerInstructions, /每次标注一手来源/);
  assert.match(starts[0].instructions, /每次标注一手来源/);
  await growthService.changeRule(background ? 'a' : 'b', rule.id, 'deleted');
  assert.doesNotMatch(extension.runtimeOptions({ id: starts[0].threadId }).turn.developerInstructions, /每次标注一手来源/);
  const agentId = background ? 'a' : 'b';
  assert.equal(bindings.length, 1); assert.equal(bindings[0].conversationKind, 'task'); assert.equal(bindings[0].agentId, agentId);
  assert.notEqual(starts[0].threadId, 'main');
  await until(() => extension.tasks()[0]?.runtime.turnId === starts[0].turn.id);
  const initial = { id: 'codex:turn:first', itemId: 'first', turnId: starts[0].turn.id, turnItemIndex: 0,
    submissionId: child.id, role: 'user', text: '查证来源' };
  const appended = { ...initial, id: 'codex:turn:next', itemId: 'next', turnItemIndex: 2, submissionId: 'human-id', text: '用户追加' };
  const reply = { ...initial, id: 'codex:turn:reply', role: 'assistant' };
  const uncertain = { ...initial, id: 'jsonl:turn:first', submissionId: undefined };
  const decorated = extension.decorateTaskSession(starts[0].threadId, { messages: [initial, appended, reply, uncertain] }).messages;
  assert.equal(decorated[0].authorName, '助手');
  assert.equal(decorated[0].displaySourceAgentId, 'a');
  assert.equal(decorated[0].role, 'user');
  assert.deepEqual(decorated.slice(1), [appended, reply, uncertain]);
  assert.deepEqual(extension.decorateTaskSession('other-thread', { messages: [initial] }).messages, [initial]);
  extension.registerTaskProvider('room', { tasks: () => [
    { id: 'parent-b', agentId: 'b', runtime: {} },
    { id: 'child-b', kind: 'delegation', parentTaskId: 'parent-b', source: { roomId: 'room' },
      inputs: [{ submissionId: 'child-b', actor: { id: 'b', name: '研究员' } }], runtime: { threadId: 'group-child', turnId: 'group-turn' } },
    { id: 'child-unknown', kind: 'delegation', source: {}, runtime: { threadId: 'unknown-child', turnId: 'group-turn' } },
    { id: 'group-bg', agentId: 'b', background: true, reasoningEffort: 'low', source: { roomId: 'room' }, runtime: { threadId: 'group-background', reasoningEffort: 'low' } },
  ] });
  assert.equal(extension.runtimeOptions({ id: 'group-background' }).turn.effort, 'low');
  assert.equal(extension.runtimeOptions({ id: 'group-background' }).resume.config['mcp_servers.negus_handoffs'].enabled, false);
  const groupMessage = { ...initial, turnId: 'group-turn', submissionId: 'child-b' };
  assert.equal(extension.decorateTaskSession('group-child', { messages: [groupMessage] }).messages[0].authorName, '研究员');
  assert.deepEqual(extension.decorateTaskSession('unknown-child', { messages: [groupMessage] }).messages, [groupMessage]);
  employees.find(employee => employee.id === agentId).modelProviderId = 'current';
  assert.equal(extension.providerForThread(starts[0].threadId), 'vip', 'task keeps its own provider when the employee switches');
  if (background) {
    assert.equal(created[0].config['mcp_servers.negus_handoffs'].enabled, false);
    assert.match(created[0].developerInstructions, /直接执行本任务/);
    assert.match(extension.leaderInstructions('a'), /结束本轮回复/);
    mainActive = false;
    const parent = threads.get('main').turns[0]; parent.status = 'completed';
    listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId: 'main', turn: parent } }));
    await until(() => extension.deliveries().some(delivery => delivery.taskId === child.parentTaskId && delivery.state === 'delivered'));
    assert.equal(extension.tasks()[0].state, 'running', 'background work continues after the main reply ends');
  }
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0].threadId, starts[0].threadId);
  assert.equal(registrations[0][3].createdBy, 'assistant');
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

test('ordinary assistant creates an explicit-provider task, follows up in place, and decorates only matching native inputs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-ordinary-handoff-'));
  const listeners = new Set();
  const routes = new Map([['source-thread', 'vip']]);
  const threads = new Map([['source-thread', { id: 'source-thread', status: { type: 'active' },
    turns: [{ id: 'source-turn', status: 'inProgress', items: [] }] }]]);
  const starts = []; const created = []; const queued = []; const registrations = []; const bindings = [];
  let failNextFollowup = false;
  let extension;
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    request: async (method, params) => {
      if (method === 'thread/start') {
        created.push(params);
        const thread = { id: 'deepseek-thread', status: { type: 'idle' }, turns: [] };
        threads.set(thread.id, thread); return { thread };
      }
      if (method === 'thread/read') return { thread: threads.get(params.threadId) };
      if (method === 'turn/start') {
        const turn = { id: `worker-turn-${starts.length}`, status: 'inProgress', items: [
          { id: 'native-initial', type: 'userMessage', clientId: params.clientUserMessageId,
            content: [{ type: 'text', text: params.input[0].text }] }] };
        threads.get(params.threadId).turns.push(turn); starts.push({ ...params, turn });
        queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/started', params: { threadId: params.threadId, turn } })));
        return { turn };
      }
      return {};
    } };
  const providers = { providers: () => [{ id: 'vip', displayName: 'VIP', models: [{ model: 'gpt-6.1-terra', displayName: 'Terra' }] },
    { id: 'deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash', displayName: 'DeepSeek Flash' }] }],
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }), getClient: async () => client };
  const original = { ownsThread: () => false, list: () => [], directoryEntries: () => [], runtimeOptions: () => null,
    hasPendingWork: () => false, close: async () => {} };
  extension = await extendEmployeeTasks(original, { stateRoot: root, registry: { list: () => [{ id: 'unrelated', name: '员工' }],
    require: () => { throw Error('ordinary source is not an employee'); } },
    modelProviders: providers, bindings: { bindRuntime: async value => bindings.push(value), findByRuntimeSession: () => null },
    conversations: { getSessionResumeInfo: async () => ({ cwd: root, model: 'gpt-6.1-terra' }) },
    providerForThread: async id => routes.get(id), registerSession: async (session, providerId, model, metadata) => {
      routes.set(session.threadId, providerId); registrations.push({ session, providerId, model, metadata });
    },
    execution: { getStatus: id => ({ active: id === 'source-thread' || id === 'other-source',
      turnId: id === 'source-thread' ? 'source-turn' : id === 'other-source' ? 'other-turn' : '' }) },
    queue: { list: () => [], enqueue: async value => {
      if (failNextFollowup && value.threadId === 'deepseek-thread') {
        failNextFollowup = false; throw Error('queue disk unavailable');
      }
      queued.push(value);
      if (value.threadId === 'source-thread') threads.get('source-thread').turns[0].items.push({ type: 'userMessage',
        clientId: value.stableDispatchId, content: [{ type: 'text', text: value.text }] });
      return { id: value.submissionId, state: 'pending', held: value.held };
    }, release: async (threadId, itemId) => {
      if (threadId === 'deepseek-thread') {
        const value = queued.find(item => item.submissionId === itemId);
        const turn = { id: `followup-${queued.length}`, status: 'inProgress', items: [{ id: 'native-followup', type: 'userMessage',
          clientId: value.stableDispatchId, content: [{ type: 'text', text: value.text }] }] };
        threads.get(threadId).status = { type: 'active' };
        threads.get(threadId).turns.push(turn);
        await extension.onProtocolMessage({ method: 'turn/started', params: { threadId, turn: { ...turn, items: [] } } });
        await extension.onProtocolMessage({ method: 'item/started', params: { threadId, turnId: turn.id, item: turn.items[0] } });
      }
      return { id: itemId, state: 'pending' };
    } }, broadcast: () => {} });
  t.after(async () => { await extension.close(); await fs.rm(root, { recursive: true, force: true }); });
  const config = extension.runtimeOptions({ id: 'source-thread' }).resume.config['mcp_servers.negus_handoffs'];
  const call = async body => {
    const response = await fetch(config.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
      headers: { Authorization: `Bearer ${config.env.NEGUS_HANDOFF_TOKEN}` }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  const request = { action: 'background', requestId: 'request-1', title: '查证', instructions: '调查事实',
    modelProviderId: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high' };
  const task = await call(request);
  assert.equal((await call(request)).id, task.id);
  const conflict = await fetch(config.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${config.env.NEGUS_HANDOFF_TOKEN}` },
    body: JSON.stringify({ ...request, instructions: '不同的工作' }) });
  assert.equal(conflict.status, 409);
  await until(() => starts.length === 1);
  assert.equal(created.length, 1); assert.equal(created[0].model, 'deepseek-flash');
  assert.equal(starts[0].effort, 'high'); assert.equal(starts[0].clientUserMessageId, task.id);
  assert.equal(registrations[0].providerId, 'deepseek'); assert.equal(registrations[0].metadata.createdBy, 'assistant');
  assert.equal(bindings.length, 0); assert.equal(extension.tasks()[0].runtime.threadId, 'deepseek-thread');
  const initial = messageFromThreadItem(starts[0].turn.items[0]);
  const human = messageFromThreadItem({ id: 'human', type: 'userMessage', clientId: 'human-id', content: [{ type: 'text', text: '真人追加' }] });
  const decorated = extension.decorateTaskSession('deepseek-thread', { messages: [initial, human] }).messages;
  assert.equal(decorated[0].authorName, 'Terra'); assert.equal(decorated[0].displaySourceAgentId, 'assistant:source-thread');
  assert.equal(decorated[1].authorName, undefined);
  starts[0].turn.status = 'completed'; starts[0].turn.items.push({ type: 'agentMessage', text: '完成' });
  listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId: 'deepseek-thread', turn: starts[0].turn } }));
  await until(() => queued.some(item => item.threadId === 'source-thread'));
  assert.equal(queued.filter(item => item.threadId === 'source-thread').length, 1);
  const report = messageFromThreadItem(threads.get('source-thread').turns[0].items.at(-1));
  assert.equal(extension.decorateTaskSession('source-thread', { messages: [report] }).messages[0].authorName, 'DeepSeek Flash');
  const followup = await call({ action: 'followup', taskId: task.id, requestId: 'request-2', instructions: '补充证据' });
  assert.equal(followup.threadId, 'deepseek-thread');
  await until(() => extension.tasks().some(item => item.kind === 'followup'));
  const next = threads.get('deepseek-thread').turns.at(-1);
  const again = await call({ action: 'followup', taskId: task.id, requestId: 'request-2', instructions: '补充证据' });
  assert.equal(again.status, 'confirmed'); assert.equal(created.length, 1); assert.equal(starts.length, 1);
  threads.set('other-source', { id: 'other-source', turns: [{ id: 'other-turn', status: 'inProgress', items: [] }] });
  routes.set('other-source', 'vip');
  const other = extension.runtimeOptions({ id: 'other-source' }).resume.config['mcp_servers.negus_handoffs'];
  const denied = await fetch(other.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${other.env.NEGUS_HANDOFF_TOKEN}` },
    body: JSON.stringify({ action: 'followup', taskId: task.id, requestId: 'intruder', instructions: '覆盖' }) });
  assert.equal(denied.status, 403, 'a foreign source cannot claim this task');
  const continued = extension.decorateTaskSession('deepseek-thread', { messages: [messageFromThreadItem(next.items[0]), human] }).messages;
  assert.equal(continued[0].authorName, 'Terra'); assert.equal(continued[1].authorName, undefined);
  next.status = 'completed'; listeners.forEach(callback => callback({ method: 'turn/completed', params: { threadId: 'deepseek-thread', turn: next } }));
  await until(() => extension.tasks().find(item => item.kind === 'followup')?.state === 'completed');
  assert.equal(queued.filter(item => item.threadId === 'deepseek-thread').length, 1);
  await until(() => queued.filter(item => item.threadId === 'source-thread').length === 2);
  const followupReport = messageFromThreadItem(threads.get('source-thread').turns[0].items.at(-1));
  const followupAuthor = extension.decorateTaskSession('source-thread', { messages: [followupReport] }).messages[0];
  assert.equal(followupAuthor.authorName, 'DeepSeek Flash');
  assert.equal(followupAuthor.displaySourceAgentId, 'assistant:deepseek-thread');
  failNextFollowup = true;
  const retryInput = { action: 'followup', taskId: task.id, requestId: 'request-after-failure', instructions: '再次补充' };
  const failed = await fetch(config.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${config.env.NEGUS_HANDOFF_TOKEN}` }, body: JSON.stringify(retryInput) });
  assert.equal(failed.status, 500);
  assert.equal((await call(retryInput)).threadId, 'deepseek-thread');
  assert.equal(created.length, 1);
});

test('task followup queue keeps its native submission ID across retries', () => {
  const store = createFollowUpQueueStore();
  const queued = store.enqueue({ threadId: 'task-thread', text: '补充', submissionId: 'request-1', stableDispatchId: 'handoff:stable' });
  assert.equal(store.claim('task-thread', queued.id).dispatchSubmissionId, 'handoff:stable');
  store.markFailed('task-thread', queued.id, 'network');
  store.markPending('task-thread', queued.id);
  assert.equal(store.claim('task-thread', queued.id).dispatchSubmissionId, 'handoff:stable');
});

test('active task followup uses the existing turn with its stable native ID', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-active-task-'));
  const calls = [];
  const queue = createFollowUpQueueService({ stateFile: path.join(root, 'queue.json'),
    execution: { getStatus: () => ({ active: true, turnId: 'running-turn' }) },
    conversations: { steerMessage: async (...args) => calls.push(args), sendMessage: () => { throw Error('must not start another turn'); } },
    media: { resolveMany: () => [] }, publishThreadEvent: () => {} });
  t.after(async () => { await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const item = await queue.enqueue({ threadId: 'task-thread', text: '补充证据', submissionId: 'followup-request', stableDispatchId: 'handoff:stable' });
  await queue.sendNow('task-thread', item.id);
  assert.deepEqual(calls, [['task-thread', 'running-turn', '补充证据', [], 'handoff:stable']]);
});

test('held followup survives queue persistence failure and retries without an early send', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-held-followup-'));
  const blocked = path.join(root, 'blocked');
  await fs.writeFile(blocked, 'not a directory');
  const sent = [];
  const queue = createFollowUpQueueService({ stateFile: path.join(blocked, 'queue.json'),
    execution: { getStatus: () => ({ active: false, phase: 'idle' }) },
    conversations: { sendMessage: async (...args) => sent.push(args) },
    media: { resolveMany: () => [] }, publishThreadEvent: () => {} });
  t.after(async () => { await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const input = { threadId: 'worker', text: '追加', submissionId: 'stable', stableDispatchId: 'handoff:stable', held: true };
  await assert.rejects(queue.enqueue(input), /EEXIST|ENOTDIR/);
  assert.equal(sent.length, 0);
  await fs.rm(blocked); await fs.mkdir(blocked);
  const retried = await queue.enqueue(input);
  assert.equal(retried.held, true);
  assert.equal(sent.length, 0);
  await queue.release('worker', retried.id);
  await until(() => sent.length === 1);
  assert.equal(sent[0][3], 'handoff:stable');
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
    providerForThread: async () => 'actual-provider', bindings: { bindRuntime: async () => {} }, execution: { getStatus: () => ({ active: false }) }, queue: {} });
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

for (const state of ['recovering', 'completed']) test(`${state} employee task repairs missing registration without creating another thread`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-task-registration-'));
  const task = { id: 'repair', kind: 'delegation', agentId: 'a', conversationId: 'task-repair', lane: 'repair',
    title: '恢复任务', instructions: '', state, createdAt: '2026-10-01T00:00:00Z',
    runtime: { threadId: 'existing', turnId: 'turn', modelProviderId: 'saved-provider', model: 'saved-model' } };
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify({version:1,tasks:[task],deliveries:[]}));
  const calls = [], registrations = [], bindings = [];
  const client = { subscribe: () => () => {}, request: async (method, params) => {
    calls.push(method);
    if (method === 'thread/resume') return {};
    if (method === 'thread/read') return {thread:{id:'existing',status:{type:'idle'},turns:[{id:'turn',status:'completed',items:[]}]}};
    throw Error(`unexpected ${method}`);
  } };
  const employee = {id:'a',name:'员工',projectRoot:root,model:'changed-model'};
  const extension = await extendEmployeeTasks({directoryEntries:()=>[],close:async()=>{}}, {
    stateRoot:root,registry:{list:()=>[employee],require:()=>employee}, appServerClient:client,
    registerSession:async(...args)=>registrations.push(args),
    bindings:{bindRuntime:async value=>bindings.push(value)}, execution:{getStatus:()=>({active:false})},queue:{} });
  t.after(async()=>{await extension.close();await fs.rm(root,{recursive:true,force:true});});
  await until(()=>extension.tasks()[0].state==='completed');
  assert.equal(bindings[0].conversationId,'task-repair');
  assert.equal(bindings[0].runtimeSessionId,'existing');
  if (state === 'completed') {
    assert.equal(registrations.length, 0);
    assert.deepEqual(calls, [], 'repairing a completed task must not resume or send messages');
    return;
  }
  assert.equal(registrations.length,1);
  assert.equal(registrations[0][0].threadId,'existing');
  assert.equal(registrations[0][1],'saved-provider');
  assert.equal(registrations[0][2],'saved-provider::saved-model');
  assert.equal(bindings[0].conversationId,'task-repair');
  assert.equal(bindings[0].runtimeSessionId,'existing');
  assert.equal(calls.includes('thread/start'),false);
  assert.equal(calls.includes('turn/start'),false);
});

test('registration-pending task starts its first turn on the checkpointed thread', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-registration-pending-'));
  const task = { id: 'pending-task', kind: 'delegation', agentId: 'a', conversationId: 'pending-conversation', lane: 'pending',
    title: '继续原任务', instructions: '原始要求', state: 'recovering', createdAt: '2026-11-02T00:00:00Z',
    runtime: { threadId: 'checkpointed-thread', modelProviderId: 'current', registrationPending: true } };
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify({ version: 1, tasks: [task], deliveries: [] }));
  const methods = [];
  const client = { subscribe: () => () => {}, request: async (method, params) => {
    methods.push(method);
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: 'first-turn', status: 'completed', items: [] } };
    if (method === 'thread/read') return { thread: { id: 'checkpointed-thread', status: { type: 'idle' }, turns: [] } };
    throw Error(`unexpected ${method}`);
  } };
  const employee = { id: 'a', name: '员工', projectRoot: root };
  const extension = await extendEmployeeTasks({ directoryEntries: () => [], close: async () => {} }, {
    stateRoot: root, registry: { list: () => [employee], require: () => employee }, appServerClient: client,
    registerSession: async () => {}, bindings: { bindRuntime: async () => {} },
    execution: { getStatus: () => ({ active: false }) }, queue: {} });
  t.after(async () => { await extension.close(); await fs.rm(root, { recursive: true, force: true }); });
  await until(() => extension.tasks()[0].state === 'completed');
  assert.equal(methods.filter(method => method === 'thread/start').length, 0);
  assert.equal(methods.filter(method => method === 'turn/start').length, 1);
});
