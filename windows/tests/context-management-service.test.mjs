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
