import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTaskRuntime } from '../kernel/native-task-runtime.mjs';
const turnEvent = (method, id = 'turn', extra = {}) => ({ method, params: { threadId: 'thread', turnId: id, ...extra } });
function fixture(request, previousTurnIds = []) {
  const listeners = new Set(); const calls = []; const checkpoints = [];
  const client = { request: async (method, params) => { calls.push({ method, params }); return request(method, params); },
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); } };
  const runtime = createNativeTaskRuntime({ resolve: async () => ({ client, threadId: 'thread', previousTurnIds, input: [] }) });
  const controller = new AbortController();
  const controls = { signal: controller.signal, checkpoint: async patch => checkpoints.push(patch), started: async patch => checkpoints.push(patch) };
  return { runtime, controls, controller, calls, checkpoints, listeners, emit: event => listeners.forEach(callback => callback(event)) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('native adapter ignores previous turn events and publishes only the current final result', async () => {
  const f = fixture(async () => ({ turn: { id: 'turn', status: 'inProgress' } }), ['old']);
  const pending = f.runtime.execute({ id: 'task', runtime: {} }, f.controls);
  await tick();
  f.emit(turnEvent('turn/completed', 'old', { turn: { id: 'old', status: 'failed' } }));
  f.emit(turnEvent('item/completed', 'turn', { item: { type: 'agentMessage', text: '正确结果' } }));
  f.emit(turnEvent('turn/completed', 'turn', { turn: { id: 'turn', status: 'completed' } }));
  assert.deepEqual(await pending, { status: 'completed', text: '正确结果', error: '' });
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.calls.map(call => call.method), ['turn/start']);
});

test('stop during native start is sent when its turn ID arrives; acknowledgment alone is not completion', async () => {
  let release;
  const start = new Promise(resolve => { release = resolve; });
  const f = fixture(async method => method === 'turn/start' ? start : {});
  let done = false;
  const pending = f.runtime.execute({ id: 'task', runtime: {} }, f.controls).then(value => { done = true; return value; });
  await tick(); f.controller.abort(); release({ turn: { id: 'turn' } }); await tick();
  assert.equal(done, false);
  assert.equal(f.calls.filter(call => call.method === 'turn/interrupt').length, 1);
  f.emit(turnEvent('turn/completed', 'turn', { turn: { id: 'turn', status: 'interrupted' } }));
  assert.equal((await pending).status, 'interrupted');
});

test('restart recovers the exact persisted turn without starting another', async () => {
  const f = fixture(async method => {
    assert.equal(method, 'thread/read');
    return { thread: { turns: [{ id: 'old', status: 'completed', items: [] }, { id: 'turn', status: 'completed', items: [{ type: 'agentMessage', text: '恢复结果' }] }] } };
  });
  const result = await f.runtime.observe({ id: 'task', runtime: { turnId: 'turn' } }, f.controls);
  assert.equal(result.text, '恢复结果');
  assert.equal(f.listeners.size, 0);
});

test('lost start response reconciles the new turn, never replays turn/start', async () => {
  const f = fixture(async method => {
    if (method === 'turn/start') throw Error('response lost');
    return { thread: { turns: [{ id: 'old', status: 'completed' }, { id: 'turn', status: 'completed', items: [{ type: 'agentMessage', text: '只执行一次' }] }] } };
  }, ['old']);
  const result = await f.runtime.execute({ id: 'task', runtime: {} }, f.controls);
  assert.equal(result.text, '只执行一次');
  assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('recovery without turn ID excludes history that predates this task', async () => {
  const f = fixture(async () => ({ thread: { turns: [{ id: 'old', status: 'completed' }] } }));
  assert.equal((await f.runtime.observe({ id: 'task', runtime: { starting: true, previousTurnIds: ['old'] } }, f.controls)).status, 'unknown');
});

test('restart confirms idle native thread as interrupted instead of waiting on stale in-progress history', async () => {
  const f = fixture(async () => ({ thread: { status: { type: 'idle' }, turns: [{ id: 'turn', status: 'inProgress' }] } }));
  const result = await f.runtime.observe({ id: 'task', runtime: { turnId: 'turn' } }, f.controls);
  assert.equal(result.status, 'interrupted');
  assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 0);
});

test('periodic native check recovers a lost completion event', async () => {
  const listeners = new Set();
  const client = { subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    request: async method => method === 'turn/start' ? { turn: { id: 'turn', status: 'inProgress' } }
      : { thread: { status: { type: 'idle' }, turns: [{ id: 'turn', status: 'completed', items: [{ type: 'agentMessage', text: '已完成但事件丢失' }] }] } } };
  const runtime = createNativeTaskRuntime({ resolve: async () => ({ client, threadId: 'thread', input: [] }), healthIntervalMs: 5 });
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    const result = await runtime.execute({ id: 'task', runtime: {} }, { signal: new AbortController().signal, checkpoint: async () => {}, started: async () => {} });
    assert.equal(result.text, '已完成但事件丢失'); assert.equal(listeners.size, 0);
  } finally { clearTimeout(keepAlive); runtime.detach(); }
});

test('crash after thread checkpoint but before start intent cannot return historical answers', async () => {
  const f = fixture(async () => ({ thread: { status: 'idle', turns: [{ id: 'old', status: 'completed', items: [{ type: 'agentMessage', text: '旧答案' }] }] } }));
  const result = await f.runtime.observe({ id: 'new-task', runtime: { threadId: 'thread' } }, f.controls);
  assert.equal(result.status, 'interrupted');
  assert.equal(result.text, '');
  assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 0);
});

test('legacy uncertain start without a persisted history boundary stays unconfirmed', async () => {
  const f = fixture(async () => ({ thread: { turns: [{ id: 'old', status: 'completed', items: [{ type: 'agentMessage', text: '旧答案' }] }] } }));
  const result = await f.runtime.observe({ id: 'task', runtime: { threadId: 'thread', starting: true } }, f.controls);
  assert.equal(result.status, 'unknown');
  assert.ok(!result.text);
});

test('recovery only adopts a unique turn after the durable start boundary', async () => {
  const history = [{ id: 'old', status: 'completed' }, { id: 'new', status: 'completed', items: [{ type: 'agentMessage', text: '本次结果' }] }];
  const f = fixture(async () => ({ thread: { status: 'idle', turns: history } }));
  const task = { id: 'task', runtime: { threadId: 'thread', starting: true, previousTurnIds: ['old'] } };
  assert.equal((await f.runtime.observe(task, f.controls)).text, '本次结果');
  history.push({ id: 'other', status: 'completed', items: [{ type: 'agentMessage', text: '他人结果' }] });
  assert.equal((await f.runtime.observe(task, f.controls)).status, 'unknown');
});
