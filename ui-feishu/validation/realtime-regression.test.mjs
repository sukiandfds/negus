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

async function employeeAdapterFixture(t, { gateStart = false, startResult = () => ({ turn: { id: 'current-turn', status: 'inProgress' } }) } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-adapter-'));
  const registry = await createEmployeeProjectRegistry({ stateFile: path.join(root, 'employees.json'), workspaceRoot: root });
  await registry.bindMainThread('developer', 'employee-thread');
  const events = [];
  const execution = createExecutionTracker({ broadcast: event => events.push(event) });
  const listeners = new Set();
  let releaseStart = () => {};
  let reachedStart = () => {};
  const startReached = gateStart ? new Promise(resolve => { reachedStart = resolve; }) : Promise.resolve();
  const startGate = gateStart ? new Promise(resolve => { releaseStart = resolve; }) : Promise.resolve();
  const client = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async request(method, params) {
      if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: 'idle' }, turns: [] } };
      if (method === 'thread/resume') return { thread: { id: params.threadId } };
      if (method === 'turn/start') {
        reachedStart();
        await startGate;
        return await startResult();
      }
      return {};
    },
    close() {},
  };
  let runtime;
  client.subscribe(message => {
    if (!runtime?.ownsThread(message.params?.threadId)) execution.handleProtocolMessage(message);
  });
  runtime = createEmployeeRuntimeService({
    registry,
    execution,
    client,
    projectRoot: root,
    conversationStore: {
      async bindRuntime(value) { return { ...value, conversationId: 'employee-conversation' }; },
      async readMessages() { return []; },
      async recordRuntimeEvent() {},
    },
    broadcast: event => events.push(event),
  });
  t.after(async () => {
    runtime.close();
    await registry.close();
    await execution.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    registry,
    runtime,
    execution,
    events,
    startReached,
    releaseStart,
    emit(method, params) {
      const message = { method, params: { threadId: 'employee-thread', ...params } };
      for (const listener of listeners) listener(message);
      return message;
    },
  };
}

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
      if (method === 'turn/start') return { turn: { id: 'turn-1', status: 'inProgress' } };
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
  await runtime.sendMessage({ employeeId: 'developer', text: 'current turn' });
  const emit = (method, params) => { for (const listener of listeners) listener({ method, params: { threadId: 'employee-thread', ...params } }); };
  emit('turn/started', { turn: { id: 'turn-1' } });
  emit('item/started', { turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', phase: 'final_answer' } });
  emit('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'answer-1', delta: '哈' });
  emit('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'answer-1', delta: '哈' });
  assert.equal(events.filter(event => event.type === 'assistant_delta').length, 0);
  assert.equal(execution.getStatus('employee-thread').streamingText, '');
  assert.equal(events.filter(event => event.type === 'employee_assistant_delta').length, 2);
  emit('item/completed', { turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '哈哈' } });
  emit('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
  const state = execution.getStatus('employee-thread');
  assert.equal(state.phase, 'completed'); assert.equal(state.turnId, 'turn-1'); assert.equal(state.active, false);
});

test('stale employee final answers never reach the shared tracker or employee thread', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-stale-employee-final-'));
  const registry = await createEmployeeProjectRegistry({ stateFile: path.join(root, 'employees.json'), workspaceRoot: root });
  const events = [];
  const execution = createExecutionTracker({ broadcast: event => events.push(event) });
  const listeners = new Set();
  const client = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async request(method, params) {
      if (method === 'thread/start') return { thread: { id: 'employee-thread' } };
      if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: 'idle' }, turns: [] } };
      if (method === 'thread/resume') return { thread: { id: params.threadId } };
      if (method === 'turn/start') return { turn: { id: 'current-turn', status: 'inProgress' } };
      return {};
    }, close() {},
  };
  let runtime;
  client.subscribe(message => { if (!runtime?.ownsThread(message.params?.threadId)) execution.handleProtocolMessage(message); });
  runtime = createEmployeeRuntimeService({ registry, execution, client, projectRoot: root,
    conversationStore: { async bindRuntime(value) { return { ...value, conversationId: 'employee-conversation' }; }, async readMessages() { return []; }, async recordRuntimeEvent() {} },
    broadcast: event => events.push(event),
  });
  t.after(async () => { runtime.close(); await registry.close(); await execution.close(); await fs.rm(root, { recursive: true, force: true }); });
  await runtime.open('developer');
  await runtime.sendMessage({ employeeId: 'developer', text: 'current turn' });
  const emitOn = (threadId, method, params) => {
    for (const listener of listeners) listener({ method, params: { threadId, ...params } });
  };
  const finalItem = text => ({ id: `answer-${text}`, type: 'agentMessage', phase: 'final_answer', text });

  emitOn('employee-thread', 'turn/started', { turn: { id: 'current-turn' } });
  emitOn('employee-thread', 'item/agentMessage/delta', { itemId: 'untagged-delta', delta: 'UNTAGGED DELTA' });
  emitOn('employee-thread', 'item/completed', { item: finalItem('UNTAGGED ANSWER') });
  assert.equal(events.some(event => event.type === 'employee_assistant_delta' && event.delta === 'UNTAGGED DELTA'), false);
  assert.equal(events.some(event => event.type === 'assistant_message_completed' && event.message.text === 'UNTAGGED ANSWER'), false);
  emitOn('employee-thread', 'item/agentMessage/delta', { turnId: 'old-turn', itemId: 'old-delta', delta: 'OLD DELTA' });
  emitOn('employee-thread', 'item/completed', { turnId: 'old-turn', item: finalItem('OLD ANSWER') });
  emitOn('employee-thread', 'turn/completed', { turn: { id: 'old-turn', status: 'completed' } });
  assert.equal(events.some(event => event.type === 'employee_assistant_delta' && event.delta === 'OLD DELTA'), false);
  assert.equal(events.some(event => event.type === 'assistant_message_completed' && event.message.text === 'OLD ANSWER'), false);
  assert.equal(events.some(event => event.type === 'employee_message_completed' && event.message.text === 'OLD ANSWER'), false);

  emitOn('employee-thread', 'item/completed', { turnId: 'current-turn', item: finalItem('CURRENT ANSWER') });
  assert.equal(events.some(event => event.type === 'assistant_message_completed' && event.message.text === 'CURRENT ANSWER'), true);
  assert.equal(events.some(event => event.type === 'employee_message_completed' && event.message.text === 'CURRENT ANSWER'), true);
  emitOn('employee-thread', 'turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  assert.equal(execution.getStatus('employee-thread').phase, 'completed');

  emitOn('ordinary-thread', 'item/completed', { turnId: 'ordinary-turn', item: finalItem('ORDINARY ANSWER') });
  assert.equal(events.some(event => event.type === 'assistant_message_completed' && event.message.text === 'ORDINARY ANSWER'), true);

  await registry.bindMainThread('developer', 'replacement-thread');
  emitOn('employee-thread', 'item/agentMessage/delta', { turnId: 'current-turn', itemId: 'old-thread-delta', delta: 'OLD THREAD DELTA' });
  emitOn('employee-thread', 'item/completed', { turnId: 'current-turn', item: finalItem('OLD THREAD ANSWER') });
  emitOn('employee-thread', 'turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  assert.equal(events.some(event => event.type === 'employee_assistant_delta' && event.delta === 'OLD THREAD DELTA'), false);
  assert.equal(events.some(event => event.type === 'assistant_message_completed' && event.message.text === 'OLD THREAD ANSWER'), false);
  assert.equal(events.filter(event => event.type === 'employee_turn_completed').length, 1);
});

test('current employee events arriving before turn/start response replay once in order', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-early-events-'));
  const { createEmployeeProjectDirectory } = await import('../../windows/server/employee-project-directory.mjs');
  const { createEmployeeProjectDirectoryRoutes } = await import('../../windows/server/routes/employee-project-directory-routes.mjs');
  const registry = await createEmployeeProjectRegistry({ stateFile: path.join(root, 'employees.json'), workspaceRoot: root });
  await registry.bindMainThread('developer', 'employee-thread');
  const events = [];
  const execution = createExecutionTracker({ broadcast: event => events.push(event) });
  const listeners = new Set();
  let releaseStart;
  let reachedStart;
  const startReached = new Promise(resolve => { reachedStart = resolve; });
  const startGate = new Promise(resolve => { releaseStart = resolve; });
  const client = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async request(method, params) {
      if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: 'idle' }, turns: [] } };
      if (method === 'thread/resume') return { thread: { id: params.threadId } };
      if (method === 'turn/start') {
        reachedStart();
        await startGate;
        return { turn: { id: 'future-turn', status: 'inProgress' } };
      }
      return {};
    },
    close() {},
  };
  let runtime;
  client.subscribe(message => {
    if (!runtime?.ownsThread(message.params?.threadId)) execution.handleProtocolMessage(message);
  });
  const conversationStore = {
    async bindRuntime(value) { return { ...value, conversationId: 'employee-conversation' }; },
    async readMessages() { return []; },
    async recordRuntimeEvent() {},
  };
  runtime = createEmployeeRuntimeService({
    registry,
    execution,
    client,
    projectRoot: root,
    conversationStore,
    broadcast: event => events.push(event),
  });
  t.after(async () => {
    runtime.close();
    await registry.close();
    await execution.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const directory = createEmployeeProjectDirectory({
    project: 'negus',
    projectRoot: root,
    registry,
    employeeRuntime: runtime,
    employeeConversations: conversationStore,
    conversations: {
      findSession: async () => ({ threadId: 'employee-thread', messages: [], updatedAt: null }),
      listSessions: async () => [],
    },
  });
  const route = createEmployeeProjectDirectoryRoutes({ directory });
  const readDirectory = async () => {
    let body = '';
    await route({ method: 'GET' }, { writeHead() {}, end(value) { body = value; } }, new URL('http://localhost/api/project-directory'));
    return JSON.parse(body).projects.find(project => project.employeeId === 'developer');
  };

  const emit = (method, params) => {
    const message = { method, params: { threadId: 'employee-thread', ...params } };
    for (const listener of listeners) listener(message);
    return message;
  };
  const sending = runtime.sendMessage({ employeeId: 'developer', text: 'fast answer', requestId: 'fast-answer' });
  await startReached;
  emit('turn/started', { turn: { id: 'future-turn' } });
  const firstDelta = emit('item/agentMessage/delta', { turnId: 'future-turn', itemId: 'answer-1', delta: 'fast ' });
  emit('item/agentMessage/delta', { turnId: 'future-turn', itemId: 'answer-1', delta: 'answer' });
  emit('item/completed', {
    turnId: 'future-turn',
    item: { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: 'fast answer' },
  });
  emit('item/completed', {
    turnId: 'old-turn',
    item: { id: 'old-answer', type: 'agentMessage', phase: 'final_answer', text: 'old answer' },
  });
  emit('turn/completed', { turn: { id: 'old-turn', status: 'completed' } });
  emit('turn/completed', { turn: { status: 'completed' } });
  emit('turn/completed', { turn: { id: 'future-turn', status: 'completed' } });
  firstDelta.params.delta = 'mutated';

  let status = (await runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'submitted');
  assert.equal(events.some(event => event.type === 'employee_assistant_delta'), false);
  assert.equal(events.some(event => event.type === 'employee_message_completed'), false);
  assert.equal(events.some(event => event.type === 'assistant_message_completed'), false);
  assert.equal(events.some(event => event.type === 'employee_turn_completed'), false);
  assert.equal(execution.getStatus('employee-thread').phase, 'submitted');

  releaseStart();
  await sending;
  status = (await runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'idle');
  assert.equal(status.active, false);
  assert.equal(status.turnId, '');
  assert.deepEqual(
    events.filter(event => event.type === 'employee_assistant_delta').map(event => event.delta),
    ['fast ', 'answer'],
  );
  const employeeMessages = events.filter(event => event.type === 'employee_message_completed');
  assert.equal(employeeMessages.length, 1);
  assert.equal(employeeMessages[0].message.text, 'fast answer');
  const sharedMessages = events.filter(event => event.type === 'assistant_message_completed');
  assert.equal(sharedMessages.length, 1);
  assert.equal(sharedMessages[0].message.text, 'fast answer');
  assert.equal(events.some(event => event.type === 'assistant_message_completed' && event.message.text === 'old answer'), false);
  assert.equal(events.filter(event => event.type === 'employee_turn_completed').length, 1);
  const executionStatus = execution.getStatus('employee-thread');
  assert.equal(executionStatus.phase, 'completed');
  assert.equal(executionStatus.turnId, 'future-turn');
  assert.equal((await readDirectory()).status.active, false);
});

test('a compatible untagged completion synchronizes employee and execution to idle', async t => {
  const f = await employeeAdapterFixture(t);
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'normal completion', requestId: 'normal-completion' });
  const message = f.emit('turn/completed', { turn: { status: 'completed' } });
  assert.equal(Object.hasOwn(message.params, 'turnId'), false);
  assert.equal(message.params.turn.id, undefined);
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'idle');
  const executionStatus = f.execution.getStatus('employee-thread');
  assert.equal(executionStatus.phase, 'completed');
  assert.equal(executionStatus.active, false);
  assert.equal(f.events.filter(event => event.type === 'employee_turn_completed').length, 1);
});

test('an early untagged completion synchronizes both statuses after turn confirmation', async t => {
  const f = await employeeAdapterFixture(t, { gateStart: true });
  const sending = f.runtime.sendMessage({ employeeId: 'developer', text: 'early untagged completion', requestId: 'early-untagged' });
  await f.startReached;
  f.emit('turn/completed', { turn: { status: 'completed' } });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'submitted');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'submitted');
  f.releaseStart();
  await sending;
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'idle');
  const executionStatus = f.execution.getStatus('employee-thread');
  assert.equal(executionStatus.phase, 'completed');
  assert.equal(executionStatus.active, false);
  assert.equal(f.events.filter(event => event.type === 'employee_turn_completed').length, 1);
});

test('an unconfirmed start cannot silently complete execution from an untagged completion', async t => {
  const f = await employeeAdapterFixture(t, { gateStart: true, startResult: () => ({}) });
  const sending = f.runtime.sendMessage({ employeeId: 'developer', text: 'missing turn id', requestId: 'missing-turn-id' });
  await f.startReached;
  f.emit('turn/completed', { turn: { status: 'completed' } });
  f.releaseStart();
  await assert.rejects(sending, /未返回当前任务编号/);
  const employee = (await f.runtime.getStatus('developer')).status;
  const executionStatus = f.execution.getStatus('employee-thread');
  assert.equal(employee.phase, 'failed');
  assert.equal(employee.active, false);
  assert.equal(executionStatus.phase, 'failed');
  assert.equal(executionStatus.active, false);
  assert.equal(f.events.some(event => event.type === 'employee_turn_completed'), false);
});
