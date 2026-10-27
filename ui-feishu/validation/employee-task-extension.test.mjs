import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extendEmployeeTasks } from '../server/employee-task-extension.mjs';
const until = async check => { const end = Date.now() + 3000; while (!check()) { if (Date.now() > end) assert.fail('condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

for (const background of [false, true]) test(`employee ${background ? 'background' : 'delegation'} creates an independent conversation and receives its result`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-kernel-'));
  const employees = [{ id: 'a', name: '助手', modelProviderId: 'external', projectRoot: root, mainThreadId: 'main', conversationId: 'direct-a' }, { id: 'b', name: '研究员', modelProviderId: 'external', projectRoot: root }];
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
        threads.get(params.threadId).turns.push(turn); starts.push({ threadId: params.threadId, turn });
        queueMicrotask(() => listeners.forEach(callback => callback({ method: 'turn/started', params: { threadId: params.threadId, turn } })));
        return { turn };
      }
      return {};
    } };
  const original = { leaderConfig: () => ({}), leaderInstructions: () => '', ownsThread: () => false, list: () => [], directoryEntries: () => [], runtimeOptions: () => null, hasPendingWork: () => false, close: async () => {} };
  const extension = await extendEmployeeTasks(original, { stateRoot: root, registry, appServerClient: client,
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
  const agentId = background ? 'a' : 'b';
  assert.equal(bindings.length, 1); assert.equal(bindings[0].conversationKind, 'task'); assert.equal(bindings[0].agentId, agentId);
  assert.notEqual(starts[0].threadId, 'main');
  employees.find(employee => employee.id === agentId).modelProviderId = 'current';
  assert.equal(extension.providerForThread(starts[0].threadId), 'external', 'task keeps its own provider when the employee switches');
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
