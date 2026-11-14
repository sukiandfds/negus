import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTaskKernel } from '../kernel/task-kernel.mjs';
import { routeMessage } from '../kernel/message-routing.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) assert.fail('condition did not become true'); await new Promise(r => setTimeout(r, 5)); }
}
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-kernel-'));
  const started = []; const turns = new Map(); const deliveries = [];
  const runtime = {
    execute: async (task, controls) => {
      const turn = deferred(); turns.set(task.id, { ...turn, controls }); started.push(task);
      await controls.checkpoint({ threadId: `thread-${task.lane}`, starting: true });
      await controls.started({ turnId: task.id });
      return turn.promise;
    },
    observe: async () => ({ status: 'unknown' }),
    ...options.runtime,
  };
  const args = { stateFile: path.join(root, 'tasks.json'), runtime,
    deliver: async delivery => { deliveries.push(delivery); return { messageId: delivery.id }; }, ...options, runtime };
  const kernel = await createTaskKernel(args);
  t.after(async () => { await kernel.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, kernel, started, turns, deliveries, args };
}
const input = (key, agentId = 'a', conversationId = 'room') => ({ requestKey: key, lane: `${conversationId}:${agentId}`, conversationId, agentId, title: key, instructions: key });

test('only a declared conversation source can enqueue without an employee', async t => {
  const { kernel, turns } = await setup(t);
  const ordinary = { ...input('ordinary'), agentId: undefined, source: { kind: 'conversation', threadId: 'source-thread' } };
  const accepted = await kernel.enqueue(ordinary);
  assert.equal(accepted.source.threadId, 'source-thread');
  assert.equal((await kernel.enqueue(ordinary)).id, accepted.id);
  await assert.rejects(kernel.enqueue({ ...ordinary, requestKey: 'missing', source: undefined }), /任务来源或执行员工不完整/);
  await until(() => turns.has(accepted.id));
  turns.get(accepted.id).resolve({ status: 'completed', text: 'done' });
});

test('routing honors explicit recipients, constrains model selection, and falls back without new employees', async () => {
  const options = { members: [{ id: 'a' }, { id: 'b' }], receptionId: 'a' };
  assert.deepEqual(await routeMessage({ ...options, explicitIds: ['b'], requestedIds: ['a'], select: () => { throw Error('must not call'); } }), { agentIds: ['b'], reason: 'explicit' });
  assert.deepEqual((await routeMessage({ ...options, select: async () => 'b' })).agentIds, ['b']);
  assert.equal((await routeMessage({ ...options, select: async () => 'outside' })).reason, 'reception');
  assert.equal((await routeMessage({ ...options, select: async () => { throw Error('offline'); } })).reason, 'reception');
  assert.deepEqual(await routeMessage({ ...options, text: '各位请分别评估', select: () => { throw Error('broadcast must not select'); } }), { agentIds: ['a', 'b'], reason: 'broadcast' });
  assert.deepEqual(await routeMessage({ ...options, replyAgentId: 'b', select: () => { throw Error('reply must not select'); } }), { agentIds: ['b'], reason: 'reply' });
  await assert.rejects(routeMessage({ ...options, receptionId: 'outside' }), /属于/);
  await assert.rejects(routeMessage({ members: [] }), /没有/);
});

test('acceptance is durable and fast, retries return the same task, lanes run independently', async t => {
  const { kernel, args, started, turns } = await setup(t);
  const [a, same] = await Promise.all([kernel.enqueue(input('one')), kernel.enqueue(input('one'))]);
  assert.equal(a.id, same.id);
  const disk = JSON.parse(await fs.readFile(args.stateFile, 'utf8'));
  assert.equal(disk.tasks.length, 1);
  const queued = await kernel.enqueue(input('two'));
  const b = await kernel.enqueue(input('three', 'b'));
  await until(() => started.length === 2);
  assert.deepEqual(new Set(started.map(task => task.id)), new Set([a.id, b.id]));
  turns.get(a.id).resolve({ status: 'completed', text: 'result' });
  await until(() => started.some(task => task.id === queued.id));
  turns.get(queued.id).resolve({ status: 'completed', text: 'second' });
  turns.get(b.id).resolve({ status: 'completed', text: 'third' });
  await until(() => kernel.deliveries().length === 3 && kernel.deliveries().every(item => item.state === 'delivered'));
});

test('asynchronous delegation returns before target ends, reports to source, permits another handoff round', async t => {
  const { kernel, started, turns, deliveries } = await setup(t);
  const source = await kernel.enqueue(input('parent'));
  await until(() => turns.has(source.id));
  const child = await turns.get(source.id).controls.delegate({ requestId: 'tool-1', agentId: 'b', title: '调研', instructions: '调查问题' });
  assert.equal(child.parentTaskId, source.id);
  assert.equal((await kernel.delegate(source.id, { requestId: 'tool-1', agentId: 'b', title: '调研', instructions: '调查问题' })).id, child.id);
  await until(() => turns.has(child.id));
  turns.get(child.id).resolve({ status: 'completed', text: '证据' });
  await until(() => deliveries.some(item => item.taskId === child.id));
  assert.equal(started.filter(task => task.agentId === 'a').length, 1, 'busy source is queued');
  turns.get(source.id).resolve({ status: 'completed', text: '已外派' });
  await until(() => started.some(task => task.resultOf === child.id));
  const continuation = started.find(task => task.resultOf === child.id);
  assert.equal(continuation.conversationId, 'room');
  assert.match(continuation.instructions, /证据/);
  const next = await kernel.delegate(continuation.id, { requestId: 'tool-2', agentId: 'b', title: '返工', instructions: '补充来源' });
  await until(() => turns.has(next.id));
  assert.equal(started.filter(task => task.agentId === 'b').length, 2);
  turns.get(continuation.id).resolve({ status: 'completed', text: '继续查证' });
  turns.get(next.id).resolve({ status: 'interrupted', text: '' });
  await until(() => kernel.get(next.id).state === 'interrupted');
});

test('stopping one queued or starting task preserves unrelated work and waits for actual native termination', async t => {
  const gate = deferred();
  const { kernel, turns } = await setup(t, { runtime: { execute: async (task, controls) => {
    await controls.checkpoint({ threadId: 'native' });
    await gate.promise;
    return { status: controls.signal.aborted ? 'interrupted' : 'completed', text: '' };
  } } });
  const a = await kernel.enqueue(input('a'));
  await until(() => kernel.get(a.id).runtime.threadId);
  const b = await kernel.enqueue(input('b'));
  const unrelated = await kernel.enqueue(input('c', 'b'));
  assert.equal((await kernel.cancel(b.id)).state, 'interrupted');
  assert.equal((await kernel.cancel(a.id)).state, 'stopping');
  assert.equal(kernel.get(unrelated.id).cancelRequested, false);
  gate.resolve();
  await until(() => kernel.get(a.id).state === 'interrupted' && kernel.get(unrelated.id).state === 'completed');
  assert.equal(turns.size, 0);
});

test('late completed output cannot replace a requested stop', async t => {
  const { kernel, turns } = await setup(t);
  const task = await kernel.enqueue(input('late'));
  await until(() => turns.has(task.id));
  await kernel.cancel(task.id);
  turns.get(task.id).resolve({ status: 'completed', text: 'late output' });
  await until(() => kernel.get(task.id).state === 'interrupted');
  assert.equal(kernel.get(task.id).result, '');
});

test('restart observes active native work without repeating it, and recovers pending delivery', async t => {
  const { kernel, args, turns } = await setup(t);
  const task = await kernel.enqueue(input('restart'));
  await until(() => kernel.get(task.id).runtime.turnId);
  await kernel.close();
  let executed = 0; const observed = [];
  const restored = await createTaskKernel({ ...args, runtime: {
    execute: async () => { executed++; throw Error('must not start'); },
    observe: async recovered => { observed.push(recovered); return { status: 'completed', text: 'restored' }; },
  } });
  t.after(() => restored.close());
  await until(() => restored.deliveries().some(item => item.state === 'delivered'));
  assert.equal(executed, 0);
  assert.equal(observed[0].runtime.turnId, task.id);
  assert.equal(restored.get(task.id).result, 'restored');
});

test('restart keeps only recent tasks with exact native evidence, without refreshing their activity time', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-kernel-recovery-policy-'));
  const stateFile = path.join(root, 'tasks.json');
  const current = new Date();
  const recent = new Date(current.getTime() - 1000).toISOString();
  const stale = new Date(current.getTime() - 31 * 60 * 1000).toISOString();
  const task = (id, state, runtime, updatedAt = recent) => ({ id, requestKey: id, lane: id, conversationId: id,
    agentId: 'a', title: id, instructions: id, state, runtime, createdAt: updatedAt, updatedAt });
  await fs.writeFile(stateFile, JSON.stringify({ version: 1, deliveries: [], tasks: [
    task('terminal', 'completed', { threadId: 'thread-terminal', turnId: 'turn-terminal' }, stale),
    task('stale', 'running', { threadId: 'thread-stale', turnId: 'turn-stale' }, stale),
    task('no-turn', 'running', { threadId: 'thread-no-turn' }),
    task('queued', 'queued', { threadId: 'thread-queued' }),
    task('observe', 'running', { threadId: 'thread-observe', turnId: 'turn-observe' }),
  ] }));
  let release;
  const observation = new Promise(resolve => { release = resolve; });
  const observed = [];
  const broadcasts = [];
  let executed = 0;
  const runtime = {
    execute: async () => { executed += 1; throw Error('must not execute'); },
    observe: async (item, controls) => {
      observed.push(item);
      await controls.started({ threadId: item.runtime.threadId, turnId: item.runtime.turnId });
      return observation;
    },
  };
  const kernel = await createTaskKernel({ stateFile, runtime, deliver: async () => ({}), broadcast: event => broadcasts.push(event) });
  t.after(async () => { await kernel.close(); await fs.rm(root, { recursive: true, force: true }); });
  await until(() => observed.length === 1);
  const before = kernel.list().find(item => item.id === 'observe');
  assert.equal(before.updatedAt, recent);
  assert.deepEqual(broadcasts, [], 'reattaching to existing work must not publish a new activity event');
  assert.equal(executed, 0);
  assert.equal(observed[0].runtime.turnId, 'turn-observe');
  assert.equal(kernel.get('terminal').state, 'completed');
  assert.equal(kernel.get('stale').state, 'interrupted');
  assert.equal(kernel.get('no-turn').state, 'interrupted');
  assert.equal(kernel.get('queued').state, 'interrupted');
  assert.equal(kernel.get('stale').updatedAt, stale);
  release({ status: 'completed', text: 'observed' });
  await until(() => kernel.get('observe').state === 'completed');
});

test('timed reconciliation interrupts evidence-free work without execution or timestamp refresh', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-kernel-timed-recovery-'));
  let observations = 0;
  const kernel = await createTaskKernel({
    stateFile: path.join(root, 'tasks.json'),
    runtime: {
      execute: async (task, controls) => {
        await controls.checkpoint({ threadId: 'starting-thread', starting: true, previousTurnIds: [] });
        return { status: 'unknown', error: 'start reply lost' };
      },
      observe: async () => { observations += 1; return { status: 'completed', text: 'must not run' }; },
    },
    deliver: async () => ({}),
    recoveryIntervalMs: 5,
  });
  t.after(async () => { await kernel.close(); await fs.rm(root, { recursive: true, force: true }); });
  const task = await kernel.enqueue(input('evidence-free'));
  await until(() => kernel.get(task.id).state === 'needs-reconciliation');
  const updatedAt = kernel.get(task.id).updatedAt;
  await until(() => kernel.get(task.id).state === 'interrupted');
  assert.equal(kernel.get(task.id).updatedAt, updatedAt);
  assert.equal(observations, 0);
  assert.equal(kernel.hasPendingWork(), false);
});

test('uncertain native work with exact turn evidence waits for authoritative reconciliation', async t => {
  let known = false;
  const { kernel, started } = await setup(t, { runtime: {
    execute: async (task, controls) => {
      await controls.checkpoint({ threadId: 'thread-uncertain', turnId: 'turn-uncertain' });
      throw Object.assign(Error('start reply lost'), { ambiguous: true });
    },
    observe: async () => known ? { status: 'completed', text: 'found' } : { status: 'unknown', error: 'offline' },
  } });
  const a = await kernel.enqueue(input('uncertain'));
  await until(() => kernel.get(a.id).state === 'needs-reconciliation');
  const b = await kernel.enqueue(input('waiting'));
  await kernel.reconcile(a.id);
  await until(() => kernel.get(a.id).state === 'needs-reconciliation');
  assert.equal(kernel.get(b.id).state, 'queued');
  known = true;
  await kernel.reconcile(a.id);
  await until(() => kernel.get(a.id).state === 'completed');
  assert.equal(started.length, 0);
});

test('delivery failure is visible and retry does not reexecute the task or duplicate continuation', async t => {
  const receipts = new Set(); let first = true;
  const { kernel, turns } = await setup(t, { deliver: async item => {
    receipts.add(item.id); // Simulate durable sink write, then lost acknowledgment.
    if (first) { first = false; throw Error('response lost'); }
    return { id: item.id };
  } });
  const task = await kernel.enqueue(input('delivery'));
  await until(() => turns.has(task.id));
  turns.get(task.id).resolve({ status: 'completed', text: 'done' });
  await until(() => kernel.deliveries()[0]?.state === 'failed');
  await kernel.retryDelivery(`result:${task.id}`);
  await until(() => kernel.deliveries()[0]?.state === 'delivered');
  assert.equal(receipts.size, 1);
  assert.equal(kernel.list().length, 1);
});

test('rejected persistence never exposes a phantom accepted task', async t => {
  const { kernel, args, root } = await setup(t);
  await fs.rm(args.stateFile);
  await fs.mkdir(args.stateFile);
  await assert.rejects(kernel.enqueue(input('cannot-save')));
  assert.deepEqual(kernel.list(), []);
});

test('stopping a source prevents its late child result from restarting it', async t => {
  const { kernel, turns, started } = await setup(t);
  const parent = await kernel.enqueue(input('source'));
  await until(() => turns.has(parent.id));
  const child = await kernel.delegate(parent.id, { requestId: 'delegation', agentId: 'b', title: '调研', instructions: '检查证据' });
  await until(() => turns.has(child.id));
  await kernel.cancel(parent.id);
  turns.get(parent.id).resolve({ status: 'interrupted', text: '' });
  turns.get(child.id).resolve({ status: 'completed', text: '晚到结果' });
  await until(() => kernel.deliveries().length === 2 && kernel.deliveries().every(item => item.state === 'delivered'));
  assert.equal(started.length, 2); assert.equal(kernel.list().some(task => task.kind === 'continuation'), false);
});

test('unchanged handoff feedback loop is rejected while revised work remains allowed', async t => {
  const { kernel, turns, started } = await setup(t);
  const parent = await kernel.enqueue(input('source'));
  await until(() => turns.has(parent.id));
  const child = await kernel.delegate(parent.id, { requestId: 'first', agentId: 'b', title: '调研', instructions: '检查证据' });
  await until(() => turns.has(child.id));
  turns.get(parent.id).resolve({ status: 'completed', text: '已外派' });
  turns.get(child.id).resolve({ status: 'completed', text: '证据完成' });
  await until(() => started.some(task => task.resultOf === child.id));
  const source = started.find(task => task.resultOf === child.id);
  await assert.rejects(kernel.delegate(source.id, { requestId: 'duplicate', agentId: 'b', title: '重复', instructions: '检查证据' }), /已在当前交接链/);
  const revised = await kernel.delegate(source.id, { requestId: 'revision', agentId: 'b', title: '补充', instructions: '补充公开来源' });
  assert.equal(revised.instructions, '补充公开来源');
});
