import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentTaskService } from '../server/agent-tasks/service.mjs';
import { createFollowUpQueueService } from '../server/follow-up-queue-service.mjs';
import { createEmployeeProjectDirectory } from '../server/employee-project-directory.mjs';

async function setup(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-agent-tasks-'));
  const stateFile = path.join(root, 'tasks.json');
  const employee = { id: 'researcher', name: '产品分析', projectRoot: root, projectKey: 'employee-researcher',
    mainThreadId: 'leader', conversationId: 'leader-chat', model: 'chosen-model', modelProviderId: 'chosen-provider', reasoningEffort: 'high' };
  const statuses = new Map([['leader', { active: true, phase: 'working', turnId: 'leader-turn' }]]);
  const execution = { getStatus: id => statuses.get(id) || { active: false, phase: 'idle' } };
  const sent = [], calls = [], bound = [];
  const queue = createFollowUpQueueService({ stateFile: path.join(root, 'queue.json'), execution,
    media: { resolveMany: () => [] }, publishThreadEvent() {},
    conversations: { sendMessage: async (...args) => { sent.push(args); statuses.set(args[0], { active: true, phase: 'working' }); } },
  });
  const registry = { require: id => { assert.equal(id, 'researcher'); return employee; }, list: () => [employee] };
  const conversations = { createSession: async (...args) => { calls.push(args); return { threadId: `worker-${calls.length}` }; },
    renameSession: async () => {}, sendMessage: async () => ({}), ...overrides };
  const options = { stateFile, registry, conversations, queue, execution,
    bindings: { bindRuntime: async binding => { bound.push(binding); return binding; } } };
  const service = await createAgentTaskService(options);
  t.after(async () => { await service.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const create = async (...args) => {
    const accepted = await service.create(...args);
    for (let i = 0; i < 100; i++) {
      const task = service.list().find(task => task.id === accepted.id);
      if (task.state !== 'starting' && (task.state !== 'failed' || task.notifications.some(n => n.state === 'queued' || n.state === 'failed'))) break;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    return service.list().find(task => task.id === accepted.id);
  };
  return { create, service, options, queue, statuses, sent, calls, bound, registry, execution, stateFile };
}
const request = { title: '竞品调研', instructions: '比较公开功能，给出来源与限制' };
const event = (method, threadId, extra) => ({ method, params: { threadId, ...extra } });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('delegation is independent, one active task, retries reuse the same task and selected provider', async t => {
  const f = await setup(t);
  const [a, b] = await Promise.all([f.create('researcher', request), f.create('researcher', request)]);
  assert.equal(a.id, b.id); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'chosen-model'); assert.equal(f.calls[0][2], 'chosen-provider');
  assert.equal(f.calls[0][3].sandbox, 'read-only');
  assert.equal(f.bound[0].conversationKind, 'task'); assert.equal(f.bound[0].agentId, 'researcher');
  assert.equal(f.statuses.get('leader').turnId, 'leader-turn');
  f.statuses.set('leader', { active: true, turnId: 'another-turn' });
  await assert.rejects(f.create('researcher', request), /已有后台/);
  const runtime = f.service.runtimeOptions({ id: a.threadId });
  assert.equal(runtime.turn.effort, 'high'); assert.equal(runtime.turn.sandboxPolicy.type, 'readOnly');
});

test('user amendments and completion queue behind ongoing main chat, duplicates do not re-notify', async t => {
  const f = await setup(t); const task = await f.create('researcher', request);
  await f.service.onProtocolMessage(event('turn/started', task.threadId, { turn: { id: 'run' } }));
  const user = (id, text) => event('item/completed', task.threadId, { item: { id, type: 'userMessage', content: [{ type: 'text', text }] } });
  await f.service.onProtocolMessage(user('initial', request.instructions));
  assert.equal(f.queue.list('leader').length, 0);
  await f.service.onProtocolMessage(user('amend', '只比较官方来源'));
  await f.service.onProtocolMessage(user('amend', '只比较官方来源'));
  await f.service.onProtocolMessage(event('item/completed', task.threadId, { item: { type: 'agentMessage', phase: 'final_answer', text: '研究结论及来源 https://example.com' } }));
  const done = event('turn/completed', task.threadId, { turn: { id: 'run', status: 'completed' } });
  await f.service.onProtocolMessage(done); await f.service.onProtocolMessage(done);
  assert.equal(f.queue.list('leader').length, 2); assert.equal(f.sent.length, 0);
  assert.match(f.queue.list('leader')[0].text, /只比较官方来源/);
  assert.match(f.queue.list('leader')[1].text, /https:\/\/example.com/);
  f.statuses.set('leader', { active: false, phase: 'idle' });
  f.queue.handleTurnTerminal({ threadId: 'leader', status: 'completed' });
  for (let i=0; i<30 && !f.sent.length; i++) await new Promise(r=>setTimeout(r,5));
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0][0], 'leader');
  assert.equal(f.service.list('researcher')[0].state, 'completed');
});

test('failed and interrupted work is reported honestly and does not change main execution', async t => {
  const f = await setup(t); const task = await f.create('researcher', request);
  await f.service.onProtocolMessage(event('turn/started', task.threadId, { turn: { id: 'run' } }));
  await f.service.onProtocolMessage(event('turn/completed', task.threadId, { turn: { id: 'run', status: 'interrupted' } }));
  assert.equal(f.service.list('researcher')[0].state, 'interrupted');
  assert.equal(f.statuses.get('leader').active, true);
  assert.match(f.queue.list('leader')[0].text, /interrupted/);
});

test('restart retains task conversations and never restarts an uncertain execution', async t => {
  const f = await setup(t); const task = await f.create('researcher', request);
  await f.service.close();
  const restored = await createAgentTaskService(f.options); t.after(()=>restored.close());
  assert.equal(restored.list('researcher')[0].threadId, task.threadId);
  assert.equal(restored.list('researcher')[0].state, 'interrupted'); assert.equal(f.calls.length, 1);
  const directory = createEmployeeProjectDirectory({ project: 'test', projectRoot: '/test', registry: f.registry,
    execution: f.execution, agentTasks: restored });
  const listing = await directory.list();
  const employee = listing.projects.find(p => p.employeeId === 'researcher');
  assert.deepEqual(employee.conversations.map(c=>c.title), ['主对话', '竞品调研']);
  assert.equal(employee.conversations[1].conversationId, task.conversationId);
});

test('loopback tools require scoped capability and reject unsupported employees', async t => {
  const f = await setup(t);
  const cfg = f.service.leaderConfig('researcher')['mcp_servers.negus_tasks'];
  assert.deepEqual(f.service.leaderConfig('developer'), {});
  let response = await fetch(cfg.env.NEGUS_TASK_ENDPOINT, { method: 'POST', body: JSON.stringify({ action: 'list' }) });
  assert.equal(response.status, 401);
  response = await fetch(cfg.env.NEGUS_TASK_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${cfg.env.NEGUS_TASK_TOKEN}` }, body: JSON.stringify({ action: 'list' }) });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { tasks: [] });
  await assert.rejects(f.service.create('developer', request), /尚未启用/);
});

test('start failure is persisted and reportable; no fake successful task', async t => {
  const f = await setup(t, { sendMessage: async () => { throw new Error('provider unavailable'); } });
  const task = await f.create('researcher', request);
  assert.equal(task.state, 'failed'); assert.match(task.error, /provider unavailable/);
  assert.match(f.queue.list('leader')[0].text, /启动失败/);
});

test('late events from an older turn cannot overwrite the latest task result', async t => {
  const f = await setup(t); const task = await f.create('researcher', request);
  await f.service.onProtocolMessage(event('turn/started', task.threadId, { turn: { id: 'latest' } }));
  await f.service.onProtocolMessage(event('item/completed', task.threadId, { turnId: 'latest', item: { type: 'agentMessage', text: '最新结果' } }));
  await f.service.onProtocolMessage(event('item/completed', task.threadId, { turnId: 'old', item: { type: 'agentMessage', text: '旧结果' } }));
  await f.service.onProtocolMessage(event('turn/completed', task.threadId, { turn: { id: 'old', status: 'completed' } }));
  assert.equal(f.service.list()[0].state, 'running');
  await f.service.onProtocolMessage(event('turn/completed', task.threadId, { turn: { id: 'latest', status: 'completed' } }));
  assert.equal(f.service.list()[0].result, '最新结果');
  assert.equal(f.queue.list('leader').length, 1);
});

test('native connection recovery ends an orphaned task once and releases the next delegation', async t => {
  const f = await setup(t); const task = await f.create('researcher', request);
  await f.service.onHealthState({ threadId: task.threadId, phase: 'recovering' });
  assert.equal(f.service.list()[0].state, 'running');
  await f.service.onHealthState({ threadId: task.threadId, phase: 'recovered' });
  await f.service.onHealthState({ threadId: task.threadId, phase: 'recovered' });
  assert.equal(f.service.list()[0].state, 'interrupted');
  assert.equal(f.queue.list('leader').length, 1);
  f.statuses.set('leader', { active: true, turnId: 'next-request' });
  assert.notEqual((await f.create('researcher', request)).id, task.id);
});

test('accepts durably before a slow worker initializes, so main chat can continue', async t => {
  let release;
  const initializing = new Promise(resolve => { release = resolve; });
  t.after(() => release({ threadId: 'slow-worker' }));
  const f = await setup(t, { createSession: () => initializing });
  const receipt = await f.service.create('researcher', request);
  assert.equal(receipt.state, 'starting');
  assert.equal(receipt.threadId, '');
  const saved = JSON.parse(await fs.readFile(f.stateFile, 'utf8'));
  assert.equal(saved.tasks[0].id, receipt.id);
  f.statuses.set('leader', { active: false, phase: 'idle' });
  assert.equal(f.service.hasPendingWork(), true);
  release({ threadId: 'slow-worker' });
  for (let i = 0; i < 100 && f.service.list()[0].state === 'starting'; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.service.list()[0].threadId, 'slow-worker');
  assert.equal(f.service.list()[0].state, 'running');
});
