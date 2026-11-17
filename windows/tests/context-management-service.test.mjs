import { readFile } from 'node:fs/promises';
import { createExecutionTracker } from '../server/execution-tracker.mjs';
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createContextManagementService } from "../server/context-management-service.mjs";

const createService = async ({ active = false } = {}) => {
  const events = [];
  const compacted = [];
  let executionActive = active;
  const service = await createContextManagementService({
    stateFile: path.join(os.tmpdir(), `missing-context-settings-${process.pid}-${Date.now()}.json`),
    broadcast: (event) => events.push(event),
    getExecutionStatus: () => ({ active: executionActive }),
    getRuntimeContext: async () => ({ model: "gpt-5.6-sol", reasoningEffort: "medium" }),
    compactContext: async (threadId) => { compacted.push(threadId); },
  });
  return { service, events, compacted, setExecutionActive: (value) => { executionActive = value; } };
};

test("accepted compaction reports asynchronous quota failure without treating retry as completion", async () => {
  const { service, events } = await createService();
  await service.requestCompaction("thread-1");
  const error = { message: "unexpected status 403 Forbidden: 预扣费额度失败，用户剩余额度不足" };
  service.handleProtocolMessage({ method: "error", params: { threadId: "thread-1", error, willRetry: true } });
  assert.equal(service.getStatus("thread-1").phase, "compacting");
  service.handleProtocolMessage({ method: "error", params: { threadId: "thread-1", error, willRetry: false } });
  assert.equal(service.getStatus("thread-1").phase, "failed");
  assert.equal(events.at(-1).message, error.message);
  await service.requestCompaction("thread-1");
  service.handleProtocolMessage({ method: "turn/completed", params: { threadId: "thread-1", turn: { status: "failed", error } } });
  assert.equal(service.getStatus("thread-1").message, error.message);
  await service.close();
});

test("compaction settles on native turn completion or interruption without a compaction item", async () => {
  const { service } = await createService();
  for (const status of ["completed", "interrupted"]) {
    await service.requestCompaction("thread-1");
    service.handleProtocolMessage({ method: "turn/completed", params: { threadId: "thread-1", turn: { status } } });
    assert.equal(service.getStatus("thread-1").phase, status === "completed" ? "completed" : "failed");
  }
  await service.close();
});

test("reports the real model and current context percentage", async () => {
  const { service } = await createService();
  await service.load("thread-1");
  service.handleProtocolMessage({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      tokenUsage: { last: { totalTokens: 120000 }, modelContextWindow: 240000 },
    },
  });

  const status = service.getStatus("thread-1");
  assert.equal(status.model, "gpt-5.6-sol");
  assert.equal(status.reasoningEffort, "medium");
  assert.equal(status.usedTokens, 120000);
  assert.equal(status.contextWindow, 240000);
  assert.equal(status.percentage, 50);
});

test("tracks the protocol effort field after thread settings change", async () => {
  const { service } = await createService();
  await service.load("thread-1");
  service.handleProtocolMessage({
    method: "thread/settings/updated",
    params: { threadId: "thread-1", threadSettings: { model: "gpt-5.6-sol", effort: "high" } },
  });

  assert.equal(service.getStatus("thread-1").reasoningEffort, "high");
});

test("clears stale usage when the runtime model changes", async () => {
  const { service } = await createService();
  await service.load("thread-1");
  service.handleProtocolMessage({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      tokenUsage: { last: { totalTokens: 120000 }, modelContextWindow: 240000 },
    },
  });
  service.handleProtocolMessage({
    method: "thread/settings/updated",
    params: { threadId: "thread-1", threadSettings: { model: "gpt-6-astra", effort: "high" } },
  });

  const status = service.getStatus("thread-1");
  assert.equal(status.model, "gpt-6-astra");
  assert.equal(status.usedTokens, null);
  assert.equal(status.contextWindow, null);
  assert.equal(status.percentage, null);
});

test("does not auto compact from a rounded-up display percentage", async () => {
  const { service, compacted } = await createService();
  await service.load("thread-1");
  service.handleProtocolMessage({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      tokenUsage: { last: { totalTokens: 190800 }, modelContextWindow: 240000 },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(service.getStatus("thread-1").percentage, 80);
  assert.deepEqual(compacted, []);
});

test("queues auto compaction until the active turn completes", async () => {
  const { service, compacted, setExecutionActive } = await createService({ active: true });
  await service.load("thread-1");
  service.handleProtocolMessage({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      tokenUsage: { last: { totalTokens: 210000 }, modelContextWindow: 240000 },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getStatus("thread-1").phase, "queued");
  assert.deepEqual(compacted, []);

  setExecutionActive(false);
  service.handleProtocolMessage({ method: "turn/completed", params: { threadId: "thread-1" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(compacted, ["thread-1"]);
  assert.equal(service.getStatus("thread-1").phase, "compacting");
});

test('DeepSeek replaces legacy fallback capacity while preserving measured token usage', async () => {
  const { service } = await createService();
  service.handleProtocolMessage({ method: 'thread/settings/updated', params: { threadId: 'deepseek', threadSettings: { model: 'deepseek-flash' } } });
  service.handleProtocolMessage({ method: 'thread/tokenUsage/updated', params: { threadId: 'deepseek', tokenUsage: { last: { totalTokens: 20896 }, modelContextWindow: 258400 } } });
  assert.equal(service.getStatus('deepseek').usedTokens, 20896);
  assert.equal(service.getStatus('deepseek').contextWindow, 996147);
  assert.equal(service.getStatus('deepseek').percentage, 2);
  await service.close();
});

test('snapshot loads do not broadcast; real usage events survive a slow runtime read', async () => {
  const events = [];
  let resolve;
  const service = await createContextManagementService({
    stateFile: path.join(os.tmpdir(), `context-read-${process.pid}.json`),
    broadcast: event => events.push(event), getExecutionStatus: () => ({ active: false }),
    getRuntimeContext: () => new Promise(done => { resolve = done; }), compactContext: async () => {},
  });
  const first = service.load('t');
  resolve({ model: 'model', usage: { usedTokens: 10, contextWindow: 1000 } });
  assert.equal((await first).usedTokens, 10);
  assert.equal(events.length, 0);
  const slow = service.load('t');
  service.handleProtocolMessage({ method: 'thread/tokenUsage/updated', params: {
    threadId: 't', tokenUsage: { last: { totalTokens: 20 }, modelContextWindow: 1000 },
  } });
  resolve({ model: 'old-model', usage: { usedTokens: 1, contextWindow: 1000 } });
  assert.equal((await slow).usedTokens, 20);
  assert.equal(service.getStatus('t').model, 'model');
  assert.equal(events.length, 1);
  const initial = service.load('new');
  service.handleProtocolMessage({ method: 'thread/tokenUsage/updated', params: {
    threadId: 'new', tokenUsage: { last: { totalTokens: 30 }, modelContextWindow: 1000 },
  } });
  resolve({ model: 'saved-model', lastSuccessfulSettings: { model: 'saved-model', reasoningEffort: 'high' } });
  const loaded = await initial;
  assert.equal(loaded.usedTokens, 30);
  assert.equal(loaded.model, 'saved-model');
  assert.equal(loaded.lastSuccessfulSettings.model, 'saved-model');
  await service.close();
});

test('compaction activity time only changes at lifecycle transitions, not usage or reads', async () => {
  const { service } = await createService();
  await service.requestCompaction('timed');
  const started = service.getStatus('timed');
  assert.equal(started.compactionUpdatedAt, started.updatedAt);
  await new Promise(resolve => setTimeout(resolve, 5));
  service.handleProtocolMessage({ method: 'thread/compacted', params: { threadId: 'timed' } });
  const completed = service.getStatus('timed');
  assert.equal(completed.phase, 'completed');
  assert.ok(Date.parse(completed.compactionUpdatedAt) > Date.parse(started.compactionUpdatedAt));
  service.handleProtocolMessage({ method: 'thread/tokenUsage/updated', params: { threadId: 'timed', tokenUsage: { last: { totalTokens: 10 }, modelContextWindow: 1000 } } });
  await service.load('timed');
  assert.equal(service.getStatus('timed').compactionUpdatedAt, completed.compactionUpdatedAt);
  await service.close();
});

test('fresh service restores saved usage without a send or a state broadcast', async () => {
  for (const threadId of ['ordinary', 'employee-main']) {
    const events = [];
    const service = await createContextManagementService({
      stateFile: path.join(os.tmpdir(), `absent-context-${process.pid}-${threadId}.json`),
      broadcast: event => events.push(event), getExecutionStatus: () => ({ active: false }),
      getRuntimeContext: async () => ({ model: 'fixture-model', reasoningEffort: 'high', usage: { usedTokens: 120, contextWindow: 1000 } }),
      compactContext: async () => { throw Error('must not compact'); },
    });
    const result = await service.load(threadId);
    assert.equal(result.usedTokens, 120);
    assert.equal(result.percentage, 12);
    assert.ok(Date.parse(result.updatedAt));
    assert.equal((await service.load(threadId)).updatedAt, result.updatedAt);
    assert.equal(result.compactionUpdatedAt, undefined);
    assert.deepEqual(events, []);
    await service.close();
  }
});

test('same-millisecond compaction transitions have increasing revisions; usage/read/duplicate completion do not', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-17T00:00:00Z') });
  const { service, events } = await createService();
  const start = await service.requestCompaction('sequence');
  assert.equal(start.compactionRevision, 1);
  service.handleProtocolMessage({ method: 'thread/compacted', params: { threadId: 'sequence' } });
  const completed = service.getStatus('sequence');
  assert.equal(completed.updatedAt, start.updatedAt);
  assert.equal(completed.compactionRevision, 2);
  t.mock.timers.tick(1000);
  service.handleProtocolMessage({ method: 'thread/compacted', params: { threadId: 'sequence' } });
  service.handleProtocolMessage({ method: 'thread/tokenUsage/updated', params: { threadId: 'sequence', tokenUsage: { last: { totalTokens: 1 }, modelContextWindow: 1000 } } });
  await service.load('sequence');
  assert.equal(service.getStatus('sequence').compactionRevision, 2);
  assert.equal(service.getStatus('sequence').compactionUpdatedAt, completed.compactionUpdatedAt);
  assert.equal((await service.requestCompaction('sequence')).compactionRevision, 3);
  service.handleProtocolMessage({ method: 'error', params: { threadId: 'sequence', error: { message: 'fixture failure' } } });
  assert.equal(service.getStatus('sequence').phase, 'failed');
  assert.equal(service.getStatus('sequence').compactionRevision, 4);
  assert.equal((await service.requestCompaction('sequence')).compactionRevision, 5);
  service.handleProtocolMessage({ method: 'turn/completed', params: { threadId: 'sequence', turn: { status: 'interrupted' } } });
  assert.equal(service.getStatus('sequence').compactionRevision, 6);
  assert.equal(service.getStatus('sequence').phase, 'failed');
  assert.equal(events.filter(e => e.type === 'context_status').at(-1).compactionRevision, 6);
  await service.close();
});

test('late compact rejection belongs only to its still-active revision', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-17T00:00:00Z') });
  for (const scenario of ['own-failure', 'completed', 'next-start', 'already-failed']) {
    const pending = [], errors = [], events = [];
    const service = await createContextManagementService({
      stateFile: path.join(os.tmpdir(), `missing-race-${process.pid}-${scenario}.json`),
      broadcast: event => events.push(event), getExecutionStatus: () => ({ active: false }),
      getRuntimeContext: async () => ({ model: 'fixture' }), onError: (id, error) => errors.push(error),
      compactContext: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    });
    await service.load('t');
    const first = service.requestCompaction('t');
    assert.equal(service.getStatus('t').compactionRevision, 1);
    if (scenario === 'already-failed') service.handleProtocolMessage({ method: 'error', params: { threadId: 't', error: { message: 'protocol failure' } } });
    else if (scenario !== 'own-failure') service.handleProtocolMessage({ method: 'thread/compacted', params: { threadId: 't' } });
    const second = scenario === 'next-start' ? service.requestCompaction('t') : null;
    const before = service.getStatus('t'), count = events.length;
    t.mock.timers.tick(1000);
    const error = new Error('late request failure');
    pending[0].reject(error);
    await assert.rejects(first, e => e === error);
    assert.deepEqual(errors, [error]);
    if (scenario === 'own-failure') {
      assert.equal(service.getStatus('t').phase, 'failed');
      assert.equal(service.getStatus('t').compactionRevision, 2);
    } else {
      assert.deepEqual(service.getStatus('t'), before, scenario);
      assert.equal(events.length, count, 'no extra failed SSE/time/revision');
    }
    if (second) {
      assert.equal(before.phase, 'compacting'); assert.equal(before.compactionRevision, 3);
      service.handleProtocolMessage({ method: 'thread/compacted', params: { threadId: 't' } });
      pending[1].resolve(); await second;
      assert.equal(service.getStatus('t').compactionRevision, 4);
      const third = service.requestCompaction('t');
      assert.equal(service.getStatus('t').compactionRevision, 5);
      pending[2].resolve(); await third;
    }
    await service.close();
  }
});


test('production compaction error adapter preserves execution for stale requests', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-17T00:00:00Z') });
  // Execute the actual bootstrap callback, without starting the production server.
  const bootstrap = await readFile(new URL('../scripts/remote-room-demo.mjs', import.meta.url), 'utf8');
  const callback = bootstrap.match(/contextManagement = await createContextManagementService\(\{\s*onError: ([\s\S]*?),\n  stateFile:/)?.[1];
  assert.ok(callback, 'production onError adapter exists');
  for (const scenario of ['own-failure', 'completed', 'next-start', 'already-failed']) {
    const executionEvents = [], logs = [], errors = [], pending = [], contextEvents = [];
    const execution = createExecutionTracker({ broadcast: event => executionEvents.push(event) });
    const adapter = new Function('execution', 'console', `return (${callback});`)(execution, { warn: (...args) => logs.push(args) });
    const service = await createContextManagementService({
      stateFile: path.join(os.tmpdir(), `missing-execution-race-${process.pid}-${scenario}.json`),
      broadcast: event => contextEvents.push(event), getExecutionStatus: execution.getStatus,
      getRuntimeContext: async () => ({ model: 'fixture' }),
      onError: (id, error, meta) => { errors.push({ id, error, meta }); adapter(id, error, meta); },
      compactContext: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    });
    await service.load('t');
    const first = service.requestCompaction('t');
    if (scenario === 'already-failed') service.handleProtocolMessage({ method: 'error', params: { threadId: 't', error: { message: 'earlier failure' } } });
    else if (scenario !== 'own-failure') service.handleProtocolMessage({ method: 'thread/compacted', params: { threadId: 't' } });
    const second = scenario === 'next-start' ? service.requestCompaction('t') : null;
    const beforeExecution = structuredClone(execution.getStatus('t'));
    const beforeContext = service.getStatus('t'), broadcasts = executionEvents.length, contextBroadcasts = contextEvents.length;
    t.mock.timers.tick(1000);
    const error = new Error('late failure with sensitive text omitted from log');
    pending[0].reject(error); await assert.rejects(first, e => e === error);
    assert.deepEqual(errors, [{ id: 't', error, meta: { current: scenario === 'own-failure', compactionRevision: 1 } }]);
    if (scenario === 'own-failure') {
      assert.equal(service.getStatus('t').phase, 'failed');
      assert.equal(service.getStatus('t').compactionRevision, 2);
      assert.equal(execution.getStatus('t').phase, 'failed');
      assert.ok(JSON.stringify(execution.getStatus('t')).includes(error.message));
      assert.ok(executionEvents.length > broadcasts); assert.equal(logs.length, 0);
    } else {
      assert.deepEqual(execution.getStatus('t'), beforeExecution, 'phase/error/updatedAt unchanged');
      assert.equal(executionEvents.length, broadcasts, 'no execution broadcast');
      assert.deepEqual(service.getStatus('t'), beforeContext);
      assert.equal(contextEvents.length, contextBroadcasts);
      assert.equal(logs.length, 1); assert.match(logs[0][0], /stale compaction/);
      assert.deepEqual(logs[0][1], { threadId: 't', compactionRevision: 1 });
      assert.ok(!JSON.stringify(logs).includes(error.message));
    }
    if (second) {
      assert.equal(service.getStatus('t').compactionRevision, 3);
      service.handleProtocolMessage({ method: 'thread/compacted', params: { threadId: 't' } });
      pending[1].resolve(); await second;
      assert.equal(service.getStatus('t').compactionRevision, 4);
      assert.deepEqual(execution.getStatus('t'), beforeExecution);
      const third = service.requestCompaction('t');
      assert.equal(service.getStatus('t').compactionRevision, 5);
      const currentError = new Error('current failure');
      pending[2].reject(currentError); await assert.rejects(third, e => e === currentError);
      assert.deepEqual(errors.at(-1).meta, { current: true, compactionRevision: 5 });
      assert.equal(service.getStatus('t').compactionRevision, 6);
      assert.equal(service.getStatus('t').phase, 'failed');
      assert.equal(execution.getStatus('t').phase, 'failed');
      assert.ok(JSON.stringify(execution.getStatus('t')).includes(currentError.message));
    }
    await service.close();
  }
});
