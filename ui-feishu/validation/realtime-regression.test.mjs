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

async function employeeAdapterFixture(t, {
  gateStart = false,
  gateSteer = false,
  startResult = () => ({ turn: { id: 'current-turn', status: 'inProgress' } }),
  steerResult = params => ({ turn: { id: params.expectedTurnId, status: 'inProgress' } }),
  steerFailure = '',
  authoritativeAfterSteerFailure = 'same',
} = {}) {
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
  let releaseSteer = () => {};
  let reachedSteer = () => {};
  const steerReached = gateSteer ? new Promise(resolve => { reachedSteer = resolve; }) : Promise.resolve();
  const steerGate = gateSteer ? new Promise(resolve => { releaseSteer = resolve; }) : Promise.resolve();
  let nativeStarts = 0;
  let steerAttempts = 0;
  const client = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async request(method, params) {
      if (method === 'thread/read') {
        if (gateSteer && nativeStarts > 0 && steerAttempts > 0) {
          if (authoritativeAfterSteerFailure === 'unknown') throw Error('authoritative state unavailable');
          if (authoritativeAfterSteerFailure === 'inactive') {
            return { thread: { id: params.threadId, status: { type: 'idle' }, turns: [] } };
          }
          const turnId = authoritativeAfterSteerFailure === 'other' ? 'other-turn' : 'current-turn';
          return { thread: { id: params.threadId, status: { type: 'inProgress' }, turns: [
            { id: turnId, status: 'inProgress', items: [] },
          ] } };
        }
        return gateSteer && nativeStarts > 0
          ? { thread: { id: params.threadId, status: { type: 'inProgress' }, turns: [
            { id: 'current-turn', status: 'inProgress', items: [] },
          ] } }
          : { thread: { id: params.threadId, status: { type: 'idle' }, turns: [] } };
      }
      if (method === 'thread/resume') return { thread: { id: params.threadId } };
      if (method === 'turn/start') {
        nativeStarts += 1;
        reachedStart();
        await startGate;
        return await startResult();
      }
      if (method === 'turn/steer') {
        steerAttempts += 1;
        reachedSteer();
        await steerGate;
        if (steerFailure === 'network') throw new TypeError('fetch failed');
        if (steerFailure === 'ordinary') throw Error('steer request failed');
        return steerResult(params);
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
    steerReached,
    releaseSteer,
    emitOn(threadId, method, params) {
      const message = { method, params: { threadId, ...params } };
      for (const listener of listeners) listener(message);
      return message;
    },
    emit(method, params) {
      return this.emitOn('employee-thread', method, params);
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

test('an approval arriving before turn/start returns keeps the final answer on the current turn', async t => {
  const f = await employeeAdapterFixture(t, { gateStart: true });
  const sending = f.runtime.sendMessage({ employeeId: 'developer', text: 'approval first', requestId: 'approval-first' });
  await f.startReached;
  f.emit('item/commandExecution/requestApproval', {
    turnId: 'current-turn', itemId: 'approval-before-response', requestId: 'approval-before-response',
  });
  f.emit('item/completed', {
    turnId: 'current-turn',
    item: { id: 'approval-answer', type: 'agentMessage', phase: 'final_answer', text: 'approval answer' },
  });
  f.emit('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'submitted');
  assert.equal(f.events.filter(event => event.type === 'employee_message_completed').length, 0);
  assert.equal(f.execution.getStatus('employee-thread').phase, 'submitted');

  f.releaseStart();
  await sending;
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'idle');
  assert.equal(status.active, false);
  assert.equal(f.events.filter(event => event.type === 'employee_message_completed').length, 1);
  assert.equal(f.events.filter(event => event.type === 'assistant_message_completed').length, 1);
  const execution = f.execution.getStatus('employee-thread');
  assert.equal(execution.phase, 'completed');
  assert.equal(execution.active, false);
  assert.equal(execution.turnId, 'current-turn');
});

test('a user-input request arriving before turn/start returns keeps the final answer on the current turn', async t => {
  const f = await employeeAdapterFixture(t, { gateStart: true });
  const sending = f.runtime.sendMessage({ employeeId: 'developer', text: 'input first', requestId: 'input-first' });
  await f.startReached;
  f.emit('item/tool/requestUserInput', {
    turnId: 'current-turn', itemId: 'input-before-response', requestId: 'input-before-response',
  });
  f.emit('item/completed', {
    turnId: 'current-turn',
    item: { id: 'input-answer', type: 'agentMessage', phase: 'final_answer', text: 'input answer' },
  });
  f.emit('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'submitted');
  assert.equal(f.events.filter(event => event.type === 'employee_message_completed').length, 0);

  f.releaseStart();
  await sending;
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'idle');
  assert.equal(status.active, false);
  assert.equal(f.events.filter(event => event.type === 'employee_message_completed').length, 1);
  assert.equal(f.execution.getStatus('employee-thread').phase, 'completed');
});

test('an old-turn approval arriving before turn/start returns is not replayed', async t => {
  const f = await employeeAdapterFixture(t, { gateStart: true });
  const sending = f.runtime.sendMessage({ employeeId: 'developer', text: 'old approval', requestId: 'old-approval' });
  await f.startReached;
  f.emit('item/commandExecution/requestApproval', {
    turnId: 'old-turn', itemId: 'old-approval', requestId: 'old-approval',
  });
  f.emitOn('replacement-thread', 'item/commandExecution/requestApproval', {
    turnId: 'current-turn', itemId: 'old-thread-approval', requestId: 'old-thread-approval',
  });
  f.releaseStart();
  await sending;
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'working');
  assert.equal(status.turnId, 'current-turn');
  assert.equal(f.events.some(event => event.type === 'employee_status' && event.status.phase === 'waitingOnApproval'), false);
});

test('old or untagged waiting events cannot change an active current turn', async t => {
  const f = await employeeAdapterFixture(t);
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'active current', requestId: 'active-current' });
  const before = (await f.runtime.getStatus('developer')).status;
  const executionBefore = f.execution.getStatus('employee-thread');
  for (const method of ['item/commandExecution/requestApproval', 'mcpServer/elicitation/request']) {
    f.emit(method, { turnId: 'old-turn', itemId: 'old-wait', requestId: 'old-wait' });
    f.emit(method, { itemId: 'untagged-wait', requestId: 'untagged-wait' });
  }
  assert.deepEqual((await f.runtime.getStatus('developer')).status, before);
  assert.deepEqual(f.execution.getStatus('employee-thread'), executionBefore);
  f.emit('item/tool/requestUserInput', {
    turnId: 'current-turn', itemId: 'current-input', requestId: 'current-input',
  });
  const waiting = (await f.runtime.getStatus('developer')).status;
  const waitingExecution = f.execution.getStatus('employee-thread');
  assert.equal(waiting.phase, 'waitingOnUserInput');
  f.emit('item/commandExecution/requestApproval', {
    turnId: 'current-turn', itemId: 'late-current-approval', requestId: 'late-current-approval',
  });
  assert.deepEqual((await f.runtime.getStatus('developer')).status, waiting);
  assert.deepEqual(f.execution.getStatus('employee-thread'), waitingExecution);
});

test('an old approval cannot relight an idle-completed employee or execution', async t => {
  const f = await employeeAdapterFixture(t);
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'finish current', requestId: 'finish-current' });
  f.emit('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  const idle = (await f.runtime.getStatus('developer')).status;
  const completed = f.execution.getStatus('employee-thread');
  assert.equal(idle.phase, 'idle');
  assert.equal(idle.active, false);
  assert.equal(completed.phase, 'completed');
  f.emit('item/commandExecution/requestApproval', {
    turnId: 'old-turn', itemId: 'late-approval', requestId: 'late-approval',
  });
  assert.deepEqual((await f.runtime.getStatus('developer')).status, idle);
  assert.deepEqual(f.execution.getStatus('employee-thread'), completed);
});

test('an untagged approval buffered before turn/start replays once with the confirmed turn ID', async t => {
  const f = await employeeAdapterFixture(t, { gateStart: true });
  const sending = f.runtime.sendMessage({ employeeId: 'developer', text: 'untagged approval', requestId: 'untagged-approval' });
  await f.startReached;
  f.emit('item/commandExecution/requestApproval', {
    itemId: 'untagged-approval', requestId: 'untagged-approval',
  });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'submitted');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'submitted');
  f.releaseStart();
  await sending;
  const waiting = (await f.runtime.getStatus('developer')).status;
  assert.equal(waiting.phase, 'waitingOnApproval');
  assert.equal(waiting.label, '等待原生审批');
  assert.equal(waiting.turnId, 'current-turn');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'waitingOnApproval');
  f.emit('item/completed', {
    turnId: 'current-turn',
    item: { id: 'untagged-approval-answer', type: 'agentMessage', phase: 'final_answer', text: 'approval complete' },
  });
  f.emit('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'idle');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'completed');
});

test('a steer response preserves user-input waiting and later completes the current turn', async t => {
  const f = await employeeAdapterFixture(t, { gateSteer: true });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'steer input', requestId: 'steer-input' });
  await f.steerReached;
  f.emit('item/tool/requestUserInput', {
    turnId: 'current-turn', itemId: 'steer-user-input', requestId: 'steer-user-input',
  });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'waitingOnUserInput');
  f.releaseSteer();
  await steering;
  const waiting = (await f.runtime.getStatus('developer')).status;
  assert.equal(waiting.phase, 'waitingOnUserInput');
  assert.equal(waiting.label, '等待补充信息');
  assert.equal(waiting.active, true);
  assert.equal(waiting.turnId, 'current-turn');
  f.emit('item/completed', {
    turnId: 'current-turn',
    item: { id: 'steer-input-answer', type: 'agentMessage', phase: 'final_answer', text: 'steer input answer' },
  });
  f.emit('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'idle');
  assert.equal(f.events.filter(event => event.type === 'employee_message_completed').length, 1);
  assert.equal(f.execution.getStatus('employee-thread').phase, 'completed');
});

test('a steer response preserves approval waiting and later completes the current turn', async t => {
  const f = await employeeAdapterFixture(t, { gateSteer: true });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'steer approval', requestId: 'steer-approval' });
  await f.steerReached;
  f.emit('item/commandExecution/requestApproval', {
    turnId: 'current-turn', itemId: 'steer-approval', requestId: 'steer-approval',
  });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'waitingOnApproval');
  f.releaseSteer();
  await steering;
  const waiting = (await f.runtime.getStatus('developer')).status;
  assert.equal(waiting.phase, 'waitingOnApproval');
  assert.equal(waiting.label, '等待原生审批');
  assert.equal(waiting.active, true);
  assert.equal(waiting.turnId, 'current-turn');
  f.emit('item/completed', {
    turnId: 'current-turn',
    item: { id: 'steer-approval-answer', type: 'agentMessage', phase: 'final_answer', text: 'steer approval answer' },
  });
  f.emit('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'idle');
  assert.equal(f.events.filter(event => event.type === 'employee_message_completed').length, 1);
  assert.equal(f.execution.getStatus('employee-thread').phase, 'completed');
});

for (const waiting of [
  { method: 'item/tool/requestUserInput', phase: 'waitingOnUserInput', label: '等待补充信息' },
  { method: 'item/commandExecution/requestApproval', phase: 'waitingOnApproval', label: '等待原生审批' },
]) {
  test(`a different steer response preserves ${waiting.phase} and clears continuation`, async t => {
    const f = await employeeAdapterFixture(t, {
      gateSteer: true,
      steerResult: () => ({ turn: { id: 'other-turn', status: 'inProgress' } }),
    });
    await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
    f.emit(waiting.method, { turnId: 'current-turn', itemId: 'before-steer', requestId: 'before-steer' });
    const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'stale steer', requestId: 'stale-steer' });
    await f.steerReached;
    f.releaseSteer();
    await assert.rejects(steering, /响应属于其他任务/);
    const status = (await f.runtime.getStatus('developer')).status;
    assert.equal(status.phase, waiting.phase);
    assert.equal(status.label, waiting.label);
    assert.equal(status.active, true);
    assert.equal(status.turnId, 'current-turn');
    const execution = f.execution.getStatus('employee-thread');
    assert.equal(execution.phase, waiting.phase);
    assert.equal(execution.active, true);
    assert.equal(execution.turnId, 'current-turn');
    assert.equal(f.events.filter(event => event.type === 'employee_message_completed').length, 0);
  });
}

test('an ordinary steer failure keeps user-input waiting when the same turn is authoritative', async t => {
  const f = await employeeAdapterFixture(t, { gateSteer: true, steerFailure: 'ordinary' });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  f.emit('item/tool/requestUserInput', {
    turnId: 'current-turn', itemId: 'waiting-before-ordinary', requestId: 'waiting-before-ordinary',
  });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'ordinary failure', requestId: 'ordinary-failure' });
  await f.steerReached;
  f.releaseSteer();
  await assert.rejects(steering, /steer request failed/);
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'waitingOnUserInput');
  assert.equal(status.label, '等待补充信息');
  assert.equal(status.active, true);
  assert.equal(status.turnId, 'current-turn');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'waitingOnUserInput');
});

test('a network steer failure keeps approval waiting when the same turn is authoritative', async t => {
  const f = await employeeAdapterFixture(t, { gateSteer: true, steerFailure: 'network' });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  f.emit('item/commandExecution/requestApproval', {
    turnId: 'current-turn', itemId: 'waiting-before-network', requestId: 'waiting-before-network',
  });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'network failure', requestId: 'network-failure' });
  await f.steerReached;
  f.releaseSteer();
  await assert.rejects(steering, /fetch failed/);
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'waitingOnApproval');
  assert.equal(status.label, '等待原生审批');
  assert.equal(status.active, true);
  assert.equal(status.turnId, 'current-turn');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'waitingOnApproval');
});

test('a waiting event received after steer starts survives an ordinary failure and completes', async t => {
  const f = await employeeAdapterFixture(t, { gateSteer: true, steerFailure: 'ordinary' });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'late waiting', requestId: 'late-waiting' });
  await f.steerReached;
  f.emit('item/tool/requestUserInput', {
    turnId: 'current-turn', itemId: 'waiting-after-steer', requestId: 'waiting-after-steer',
  });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'waitingOnUserInput');
  f.releaseSteer();
  await assert.rejects(steering, /steer request failed/);
  const waiting = (await f.runtime.getStatus('developer')).status;
  assert.equal(waiting.phase, 'waitingOnUserInput');
  assert.equal(waiting.label, '等待补充信息');
  assert.equal(waiting.active, true);
  assert.equal(waiting.turnId, 'current-turn');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'waitingOnUserInput');
  f.emit('item/completed', {
    turnId: 'current-turn',
    item: { id: 'late-waiting-answer', type: 'agentMessage', phase: 'final_answer', text: 'late waiting answer' },
  });
  f.emit('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  assert.equal((await f.runtime.getStatus('developer')).status.phase, 'idle');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'completed');
  assert.equal(f.events.filter(event => event.type === 'employee_message_completed').length, 1);
});

test('a waiting event received after steer starts survives a network failure', async t => {
  const f = await employeeAdapterFixture(t, { gateSteer: true, steerFailure: 'network' });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'network waiting', requestId: 'network-waiting' });
  await f.steerReached;
  f.emit('item/commandExecution/requestApproval', {
    turnId: 'current-turn', itemId: 'approval-after-steer', requestId: 'approval-after-steer',
  });
  f.releaseSteer();
  await assert.rejects(steering, /fetch failed/);
  const waiting = (await f.runtime.getStatus('developer')).status;
  assert.equal(waiting.phase, 'waitingOnApproval');
  assert.equal(waiting.label, '等待原生审批');
  assert.equal(waiting.active, true);
  assert.equal(waiting.turnId, 'current-turn');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'waitingOnApproval');
});

test('a waiting event received after steer starts survives unknown authoritative state', async t => {
  const f = await employeeAdapterFixture(t, {
    gateSteer: true,
    steerFailure: 'network',
    authoritativeAfterSteerFailure: 'unknown',
  });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'unknown waiting', requestId: 'unknown-waiting' });
  await f.steerReached;
  f.emit('item/tool/requestUserInput', {
    turnId: 'current-turn', itemId: 'unknown-waiting', requestId: 'unknown-waiting',
  });
  f.releaseSteer();
  await assert.rejects(steering, /fetch failed/);
  const waiting = (await f.runtime.getStatus('developer')).status;
  assert.equal(waiting.phase, 'waitingOnUserInput');
  assert.equal(waiting.label, '等待补充信息');
  assert.equal(waiting.active, true);
  assert.equal(waiting.turnId, 'current-turn');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'waitingOnUserInput');
});

test('a steer failure without late waiting restores the original working snapshot', async t => {
  const f = await employeeAdapterFixture(t, { gateSteer: true, steerFailure: 'ordinary' });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'working failure', requestId: 'working-failure' });
  await f.steerReached;
  f.releaseSteer();
  await assert.rejects(steering, /steer request failed/);
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'working');
  assert.equal(status.label, '正在处理');
  assert.equal(status.active, true);
  assert.equal(status.turnId, 'current-turn');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'working');
});

test('a steer failure reports authoritative different-turn occupancy', async t => {
  const f = await employeeAdapterFixture(t, {
    gateSteer: true,
    steerFailure: 'network',
    authoritativeAfterSteerFailure: 'other',
  });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  f.emit('item/tool/requestUserInput', {
    turnId: 'current-turn', itemId: 'waiting-before-other', requestId: 'waiting-before-other',
  });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'other turn', requestId: 'other-turn' });
  await f.steerReached;
  f.releaseSteer();
  await assert.rejects(steering, /fetch failed/);
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'occupied');
  assert.equal(status.active, true);
  assert.equal(status.turnId, 'other-turn');
  const execution = f.execution.getStatus('employee-thread');
  assert.equal(execution.phase, 'occupied');
  assert.equal(execution.active, true);
  assert.equal(execution.turnId, 'other-turn');
});

test('a steer failure becomes idle when authoritative state is inactive', async t => {
  const f = await employeeAdapterFixture(t, {
    gateSteer: true,
    steerFailure: 'ordinary',
    authoritativeAfterSteerFailure: 'inactive',
  });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  f.emit('item/commandExecution/requestApproval', {
    turnId: 'current-turn', itemId: 'waiting-before-inactive', requestId: 'waiting-before-inactive',
  });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'inactive after failure', requestId: 'inactive-failure' });
  await f.steerReached;
  f.releaseSteer();
  await assert.rejects(steering, /steer request failed/);
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'idle');
  assert.equal(status.active, false);
  assert.equal(status.turnId, '');
  const execution = f.execution.getStatus('employee-thread');
  assert.equal(execution.phase, 'idle');
  assert.equal(execution.active, false);
  assert.equal(execution.turnId, '');
});

test('a steer failure restores waiting when authoritative state is unknown', async t => {
  const f = await employeeAdapterFixture(t, {
    gateSteer: true,
    steerFailure: 'network',
    authoritativeAfterSteerFailure: 'unknown',
  });
  await f.runtime.sendMessage({ employeeId: 'developer', text: 'first turn', requestId: 'first-turn' });
  f.emit('item/tool/requestUserInput', {
    turnId: 'current-turn', itemId: 'waiting-before-unknown', requestId: 'waiting-before-unknown',
  });
  const steering = f.runtime.sendMessage({ employeeId: 'developer', text: 'unknown authority', requestId: 'unknown-authority' });
  await f.steerReached;
  f.releaseSteer();
  await assert.rejects(steering, /fetch failed/);
  const status = (await f.runtime.getStatus('developer')).status;
  assert.equal(status.phase, 'waitingOnUserInput');
  assert.equal(status.label, '等待补充信息');
  assert.equal(status.active, true);
  assert.equal(status.turnId, 'current-turn');
  assert.equal(f.execution.getStatus('employee-thread').phase, 'waitingOnUserInput');
});

test('closing while a start response is pending suppresses status and buffered output', async t => {
  const f = await employeeAdapterFixture(t, { gateStart: true });
  const sending = f.runtime.sendMessage({ employeeId: 'developer', text: 'close while pending', requestId: 'close-pending' });
  await f.startReached;
  f.emit('item/completed', {
    turnId: 'current-turn',
    item: { id: 'close-buffered-answer', type: 'agentMessage', phase: 'final_answer', text: 'must not replay' },
  });
  f.emit('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
  f.runtime.close();
  const closedStatus = (await f.runtime.getStatus('developer')).status;
  const closedExecution = f.execution.getStatus('employee-thread');
  f.releaseStart();
  await assert.rejects(sending, /关闭/);
  assert.deepEqual((await f.runtime.getStatus('developer')).status, closedStatus);
  assert.deepEqual(f.execution.getStatus('employee-thread'), closedExecution);
  assert.equal(f.events.some(event => event.type === 'employee_message_completed'), false);
  assert.equal(f.events.some(event => event.type === 'assistant_message_completed'), false);
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
