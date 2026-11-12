import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscussionPrompt, createMultiAgentService, mentionedAgentIds } from "../server/multi-agent-service.mjs";

const agents = [
  { id: "manager", name: "项目经理 Agent", responsibility: "协调与总结" },
  { id: "reviewer", name: "审查 Agent", responsibility: "审查风险" },
];

test("finds every mentioned Agent in message order", () => {
  assert.deepEqual(
    mentionedAgentIds("请 @审查 Agent 看完后交给 @项目经理 Agent", agents),
    ["reviewer", "manager"],
  );
});

test("discussion prompt contains the request and recent room context", () => {
  const prompt = buildDiscussionPrompt({
    agent: agents[1],
    mode: "discussion",
    requestText: "检查当前方案",
    snapshot: {
      agents,
      messages: [{ type: "human", authorName: "Hans", text: "检查当前方案" }],
    },
    followUp: false,
  });

  assert.match(prompt, /检查当前方案/u);
  assert.match(prompt, /\[Hans\] 检查当前方案/u);
  assert.match(prompt, /@项目经理 Agent/u);
  assert.match(prompt, /只分析和讨论，不修改文件/u);
});

const createFakeRoom = () => {
  const roomAgents = new Map([
    ["manager", { id: "manager", name: "项目经理 Agent", responsibility: "协调", instructions: "", threadId: null, active: false }],
    ["reviewer", { id: "reviewer", name: "审查 Agent", responsibility: "审查", instructions: "", threadId: null, active: false }],
  ]);
  const messages = [];
  return {
    messages,
    snapshot: () => ({ agents: [...roomAgents.values()], messages: [...messages] }),
    getAgent: (id) => roomAgents.get(id) || null,
    updateAgent: async (id, patch) => {
      roomAgents.set(id, { ...roomAgents.get(id), ...patch });
      return roomAgents.get(id);
    },
    addMessage: async (message) => {
      const stored = { id: `message-${messages.length + 1}`, ...message };
      messages.push(stored);
      return stored;
    },
  };
};

const createFakeClient = () => {
  const calls = [];
  let protocolListener = () => {};
  let healthListener = () => {};
  let nextThread = 1;
  return {
    calls,
    emit: (message) => protocolListener(message),
    emitHealth: (event) => healthListener(event),
    subscribe: (listener) => { protocolListener = listener; return () => {}; },
    subscribeHealth: (listener) => { healthListener = listener; return () => {}; },
    close: () => {},
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: `thread-${nextThread++}` } };
      if (method === "turn/start") return { turn: { id: `turn-${params.threadId}` } };
      return {};
    },
  };
};

const settle = async (predicate) => {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), "condition was not reached");
};

test("stopping a group task interrupts the running Agent and drops the queue behind it", async () => {
  const room = createFakeRoom();
  const client = createFakeClient();
  const service = createMultiAgentService({ projectRoot: "/project", room, broadcast: () => {}, client });
  const started = () => client.calls.filter((call) => call.method === "turn/start");

  assert.deepEqual(await service.interrupt(), { interrupted: false, agentIds: [] });

  await service.enqueueDiscussion({ agentIds: ["manager"], mode: "discussion", requestText: "第一件事" });
  await service.enqueueDiscussion({ agentIds: ["reviewer"], mode: "discussion", requestText: "第二件事" });
  await settle(() => started().length === 1);

  const result = await service.interrupt();
  assert.equal(result.interrupted, true);
  assert.deepEqual(result.agentIds.sort(), ["manager", "reviewer"]);
  assert.deepEqual(client.calls.at(-1), {
    method: "turn/interrupt",
    params: { threadId: "thread-1", turnId: "turn-thread-1" },
  });

  client.emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-thread-1", status: "interrupted" } } });
  await settle(() => !room.getAgent("manager").active && !room.getAgent("reviewer").active);

  assert.equal(room.getAgent("manager").phase, "interrupted");
  assert.equal(room.getAgent("reviewer").phase, "interrupted");
  assert.equal(started().length, 1, "the queued discussion must never start");
  service.close();
});

test("an app-server crash fails the running Agent instead of waiting for the reply timeout", async () => {
  const room = createFakeRoom();
  const client = createFakeClient();
  const service = createMultiAgentService({ projectRoot: "/project", room, broadcast: () => {}, client });

  await service.enqueueDiscussion({ agentIds: ["manager"], mode: "discussion", requestText: "检查" });
  await settle(() => client.calls.some((call) => call.method === "turn/start"));
  client.emitHealth({ phase: "exited", error: new Error("gone") });
  await settle(() => room.getAgent("manager").phase === "failed");

  assert.equal(room.getAgent("manager").active, false);
  assert.equal(room.getAgent("manager").detail, "Codex 进程已退出");
  service.close();
});
