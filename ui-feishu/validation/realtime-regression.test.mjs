import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import '../server/register.mjs';
import { publishProjectStream, observeProjectStream } from '../src/projectEvents.ts';
const { createEmployeeRuntimeService } = await import('../../windows/server/employee-runtime-service.mjs');
const { createEmployeeProjectRegistry } = await import('../../windows/server/employee-project-registry.mjs');
const { createExecutionTracker } = await import('../../windows/server/execution-tracker.mjs');

test('secondary views share delivery, reconnect, and independent unsubscribe', async () => {
  const a = observeProjectStream(), b = observeProjectStream();
  const eventsA = [], eventsB = [];
  a.onmessage = event => eventsA.push(event.data);
  b.onmessage = event => eventsB.push(event.data);
  let opens = 0, errors = 0;
  b.onopen = () => opens++;
  b.onerror = () => errors++;
  publishProjectStream('open', new Event('open'));
  publishProjectStream('message', new MessageEvent('message', { data: 'one' }));
  a.close();
  publishProjectStream('error', new Event('error'));
  publishProjectStream('open', new Event('open'));
  publishProjectStream('message', new MessageEvent('message', { data: 'two' }));
  assert.deepEqual(eventsA, ['one']);
  assert.deepEqual(eventsB, ['one', 'two']);
  assert.equal(opens, 2); assert.equal(errors, 1);
  const late = observeProjectStream(); let lateOpened = false;
  late.onopen = () => { lateOpened = true; };
  await Promise.resolve(); assert.equal(lateOpened, true);
  b.close(); late.close(); publishProjectStream('error', new Event('error'));
});

test('employee protocol has one generic stream and preserves completed turn identity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-event-regression-'));
  const registry = await createEmployeeProjectRegistry({ stateFile: path.join(root, 'employees.json'), workspaceRoot: root });
  const events = [];
  const execution = createExecutionTracker({ broadcast: event => events.push(event) });
  const listeners = new Set();
  const client = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async request(method, params) {
      if (method === 'thread/start') return { thread: { id: 'employee-thread' } };
      if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: 'idle' }, turns: [] } };
      if (method === 'thread/resume') return { thread: { id: params.threadId } };
      return {};
    }, close() {},
  };
  let runtime;
  // Same dispatch rule as the preview host; ordinary conversations still use the tracker.
  client.subscribe(message => { if (!runtime?.ownsThread(message.params?.threadId)) execution.handleProtocolMessage(message); });
  runtime = createEmployeeRuntimeService({ registry, execution, client, projectRoot: root,
    conversationStore: { async bindRuntime(value) { return { ...value, conversationId: 'employee-conversation' }; }, async readMessages() { return []; }, async recordRuntimeEvent() {} },
    broadcast: event => events.push(event),
  });
  t.after(async () => { runtime.close(); await registry.close(); await execution.close(); await fs.rm(root, { recursive: true, force: true }); });
  await runtime.open('developer');
  const emit = (method, params) => { for (const listener of listeners) listener({ method, params: { threadId: 'employee-thread', ...params } }); };
  emit('turn/started', { turn: { id: 'turn-1' } });
  emit('item/started', { turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', phase: 'final_answer' } });
  emit('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'answer-1', delta: '哈' });
  emit('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'answer-1', delta: '哈' });
  assert.equal(events.filter(event => event.type === 'assistant_delta').length, 2);
  assert.equal(execution.getStatus('employee-thread').streamingText, '哈哈');
  assert.equal(events.filter(event => event.type === 'employee_assistant_delta').length, 2);
  emit('item/completed', { turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '哈哈' } });
  emit('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
  const state = execution.getStatus('employee-thread');
  assert.equal(state.phase, 'completed'); assert.equal(state.turnId, 'turn-1'); assert.equal(state.active, false);
});
