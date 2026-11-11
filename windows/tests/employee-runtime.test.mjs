import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEmployeeProjectDirectory } from "../server/employee-project-directory.mjs";
import { createEmployeeProjectRegistry } from "../server/employee-project-registry.mjs";
import { createEmployeeRuntimeService } from "../server/employee-runtime-service.mjs";
import { createEmployeeProjectDirectoryRoutes } from "../server/routes/employee-project-directory-routes.mjs";

const fixture = async (t, { execution = null, onTurnCompleted = null, taskService = null, growthService = null, readHistory, registerSession } = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-employee-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = await createEmployeeProjectRegistry({
    stateFile: path.join(root, "employee-projects.json"),
    workspaceRoot: "D:\\project",
  });
  let listener = () => {};
  const calls = [];
  const client = {
    subscribe(handler) { listener = handler; return () => {}; },
    close() {},
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: "employee-thread" } };
      if (method === "thread/read") return { thread: { id: params.threadId, turns: [] } };
      if (method === "thread/resume") return { thread: { id: params.threadId } };
      if (method === "turn/start") return { turn: { id: "employee-turn", status: "inProgress" } };
      return {};
    },
  };
  const conversationStore = {
    async bindRuntime(value) {
      return { conversationId: value.conversationId || "employee-conversation", ...value };
    },
    async readMessages() { return []; },
    async recordRuntimeEvent() {},
  };
  const events = [];
  const runtime = createEmployeeRuntimeService({
    registry,
    conversationStore,
    readHistory,
    registerSession,
    projectRoot: "D:\\project",
    client,
    broadcast: (event) => events.push(event),
    execution,
    onTurnCompleted,
    taskService,
    growthService,
  });
  t.after(async () => {
    runtime.close();
    await registry.close();
  });
  return { root, registry, client, conversationStore, runtime, events, calls, get listener() { return listener; } };
};

test("a failed memory suggestion cannot fail an accepted employee turn", async t => {
  let attempted = false;
  const { runtime, events } = await fixture(t, { growthService: { suggestFromMessage: async () => { attempted = true; throw Error("storage unavailable"); } } });
  const result = await runtime.sendMessage({ employeeId: "developer", text: "记住，标注来源", requestId: "memory" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempted, true);
  assert.equal(result.status, "inProgress");
  assert.equal(events.filter(event => event.type === "employee_status").at(-1).status.phase, "working");
});

test("employee history preserves ordinary messages and pagination on the selected provider", async (t) => {
  const messages = [
    { id: "progress", role: "assistant", phase: "commentary", text: "checking", createdAt: "2026-10-26T01:00:00Z" },
    { id: "command", role: "tool", text: "pwd", blocks: [{ type: "command", command: "pwd" }] },
    { id: "image", role: "user", text: "", blocks: [{ type: "image", file: { id: "image-file", url: "/api/media/image-file" } }] },
  ];
  const reads = [];
  const { runtime, registry, conversationStore } = await fixture(t, { readHistory: async (...args) => {
    reads.push(args);
    return { threadId: args[1], title: "Native history", messages, hasMore: true, nextCursor: "older-page" };
  } });
  conversationStore.readMessages = async () => { throw Error("simplified history must not be read"); };
  await registry.bindConversation("developer", "history-conversation");
  await registry.setModelSettings("developer", { modelProviderId: "external" });
  const pagination = { limit: 60, cursor: "previous-page" };
  const session = await runtime.readSession("developer", pagination);
  assert.deepEqual(reads, [["external", "employee-thread", "all", pagination]]);
  assert.deepEqual(session.messages, messages);
  assert.equal(session.hasMore, true);
  assert.equal(session.nextCursor, "older-page");
  assert.equal(session.conversationKind, "direct");
  assert.equal(session.conversationId, "history-conversation");
});

test("employee cached-view history reads the existing binding without resuming or creating a thread", async (t) => {
  const reads = [];
  const { runtime, registry, conversationStore, calls } = await fixture(t, { readHistory: async (...args) => {
    reads.push(args); return { threadId: args[1], messages: [] };
  } });
  await registry.bindMainThread("developer", "employee-thread");
  await registry.bindConversation("developer", "employee-conversation");
  conversationStore.findByAgentKind = () => ({ conversationId: "employee-conversation", runtimeSessionId: "employee-thread" });
  const result = await runtime.readSession("developer", { limit: 60, readOnly: true });
  assert.equal(result.threadId, "employee-thread");
  assert.equal(reads[0][3].readOnly, undefined);
  assert.deepEqual(calls, []);
});

test("employee registry keeps identity state private from API-shaped values", async (t) => {
  const { registry } = await fixture(t);
  const employee = registry.get("developer");
  assert.equal(employee.id, "developer");
  assert.equal("instructions" in employee, false);
  assert.equal(registry.require("developer").instructions.includes("Legacy policy marker"), false);
  const grok = registry.get("grok");
  assert.equal(grok.modelProviderId, "current");
  assert.equal(grok.model, "");
  assert.equal(grok.mainThreadId, null);
});

test("employee runtime binds one main thread with main-agent host access", async (t) => {
  const { registry, runtime, events, calls, listener } = await fixture(t);
  const opened = await runtime.open("developer");
  assert.equal(opened.employee.modificationConfirmed, true);
  assert.equal(calls.find((call) => call.method === "thread/start").params.sandbox, "danger-full-access");
  assert.equal(calls.find((call) => call.method === "thread/start").params.approvalPolicy, "never");
  await runtime.sendMessage({ employeeId: "developer", text: "先讨论方案", requestId: "request-1" });
  const turnStart = calls.find((call) => call.method === "turn/start");
  assert.equal(turnStart.params.cwd, "D:\\project");
  assert.equal(turnStart.params.sandboxPolicy.type, "dangerFullAccess");
  assert.equal(turnStart.params.approvalPolicy, "never");
  const role = turnStart.params.additionalContext['negus.employee'];
  assert.equal(role.kind, 'application');
  assert.match(role.value, /替代对话中旧的员工身份/);
  assert.match(role.value, /技术研发/u);
  assert.ok(role.value.includes(path.resolve('employees/developer/system-prompt.md')));
  assert.equal(role.value.includes('默认提示词 1.'), false, 'role update must not repeat global rules and crowd out the employee identity');
  assert.equal(turnStart.params.developerInstructions, undefined);
  assert.equal((events.find((event) => event.type === "employee_status")?.modificationConfirmed), true);
  listener({ method: "turn/completed", params: { threadId: "employee-thread", turn: { status: "completed" } } });
  await runtime.confirmModification("developer");
  assert.equal(calls.at(-1).method, "thread/resume");
  assert.equal(calls.at(-1).params.sandbox, "danger-full-access");
  assert.equal(calls.at(-1).params.approvalPolicy, "never");
  assert.equal(registry.get("developer").modificationConfirmed, true);
  assert.equal((await runtime.getStatus("developer")).modificationConfirmed, true);
});

test("employee runtime mirrors status and message progress to the shared conversation UI", async (t) => {
  const statuses = [];
  const threadEvents = [];
  const forwarded = [];
  const execution = {
    publishStatus: (threadId, status) => statuses.push({ threadId, ...status }),
    publishThreadEvent: (threadId, event) => threadEvents.push({ threadId, event }),
    handleProtocolMessage: (message) => forwarded.push(message.method),
  };
  const { runtime, listener } = await fixture(t, { execution });

  await runtime.open("developer");
  await runtime.sendMessage({ employeeId: "developer", text: "inspect the project", requestId: "request-bridge" });
  listener({
    method: "item/agentMessage/delta",
    params: { threadId: "employee-thread", turnId: "employee-turn", itemId: "assistant-item", delta: "done" },
  });
  listener({
    method: "item/completed",
    params: {
      threadId: "employee-thread",
      turnId: "employee-turn",
      item: { id: "assistant-item", type: "agentMessage", phase: "final_answer", text: "done" },
    },
  });
  listener({ method: "turn/completed", params: { threadId: "employee-thread", turn: { id: "employee-turn", status: "completed" } } });

  assert.equal(statuses.some((event) => event.threadId === "employee-thread" && event.phase === "working" && event.active), true);
  // The execution tracker owns the turn's events: they are forwarded once, not mirrored a second time.
  assert.deepEqual(forwarded, ["item/agentMessage/delta", "item/completed", "turn/completed"]);
  assert.equal(threadEvents.some(({ event }) => event.type === "assistant_delta"), false);
  assert.equal((await runtime.getStatus("developer")).status.phase, "idle");
  assert.deepEqual(threadEvents.at(-1), {
    threadId: "employee-thread",
    event: { type: "sessions_changed", threadId: "employee-thread" },
  });
});

test("the current turn completion publishes idle immediately", async (t) => {
  const f = await fixture(t);
  await f.runtime.sendMessage({ employeeId: "developer", text: "finish current turn", requestId: "current-complete" });
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turnId: "employee-turn",
    turn: { id: "employee-turn", status: "completed" },
  } });
  const status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.active, false);
  assert.equal(status.phase, "idle");
  assert.equal(status.turnId, "");
  assert.deepEqual(f.events.filter(event => event.type === "employee_status").at(-1).status, status);
});

test("late completion and output from another turn cannot change the current status or reply", async (t) => {
  const f = await fixture(t);
  await f.runtime.sendMessage({ employeeId: "developer", text: "new turn", requestId: "new-turn" });
  const before = (await f.runtime.getStatus("developer")).status;
  const messagesBefore = f.events.filter(event => event.type === "employee_message_completed").length;
  const deltasBefore = f.events.filter(event => event.type === "employee_assistant_delta").length;

  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { id: "old-turn", status: "completed" },
  } });
  f.listener({ method: "item/completed", params: {
    threadId: "employee-thread",
    turnId: "old-turn",
    item: { id: "old-final", type: "agentMessage", phase: "final_answer", text: "old answer" },
  } });
  f.listener({ method: "item/agentMessage/delta", params: {
    threadId: "employee-thread", turnId: "old-turn", itemId: "old-final", delta: "old",
  } });

  const status = (await f.runtime.getStatus("developer")).status;
  assert.deepEqual(status, before);
  assert.equal(f.events.filter(event => event.type === "employee_message_completed").length, messagesBefore);
  assert.equal(f.events.filter(event => event.type === "employee_assistant_delta").length, deltasBefore);
});

test("stale turn events during a new submission cannot clear or change it", async (t) => {
  const f = await fixture(t);
  let releaseStart;
  let reachedStart;
  const startReached = new Promise(resolve => { reachedStart = resolve; });
  const startGate = new Promise(resolve => { releaseStart = resolve; });
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => {
    if (method === "turn/start") {
      reachedStart();
      await startGate;
    }
    return request(method, params);
  };

  const sending = f.runtime.sendMessage({ employeeId: "developer", text: "new submission", requestId: "new-submission" });
  await startReached;
  const before = (await f.runtime.getStatus("developer")).status;
  const messagesBefore = f.events.filter(event => event.type === "employee_message_completed").length;
  const deltasBefore = f.events.filter(event => event.type === "employee_assistant_delta").length;

  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread", turn: { id: "old-turn", status: "completed" },
  } });
  f.listener({ method: "item/completed", params: {
    threadId: "employee-thread",
    turnId: "old-turn",
    item: { id: "old-final", type: "agentMessage", phase: "final_answer", text: "old answer" },
  } });
  f.listener({ method: "item/agentMessage/delta", params: {
    threadId: "employee-thread", turnId: "old-turn", itemId: "old-final", delta: "old",
  } });

  assert.deepEqual((await f.runtime.getStatus("developer")).status, before);
  assert.equal(f.events.filter(event => event.type === "employee_message_completed").length, messagesBefore);
  assert.equal(f.events.filter(event => event.type === "employee_assistant_delta").length, deltasBefore);
  releaseStart();
  await sending;
  const status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.active, true);
  assert.equal(status.phase, "working");
  assert.equal(status.turnId, "employee-turn");
});

test("a compatible completion without a turn ID still returns the employee to idle", async (t) => {
  const f = await fixture(t);
  await f.runtime.sendMessage({ employeeId: "developer", text: "legacy completion", requestId: "legacy-complete" });
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { status: "completed" },
  } });
  const status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.active, false);
  assert.equal(status.phase, "idle");
  assert.equal(status.turnId, "");
});

test("old turn/started while idle does not reactivate the employee", async (t) => {
  const f = await fixture(t);
  await f.runtime.sendMessage({ employeeId: "developer", text: "finish", requestId: "finish" });
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { id: "employee-turn", status: "completed" },
  } });
  const idle = (await f.runtime.getStatus("developer")).status;
  f.listener({ method: "turn/started", params: {
    threadId: "employee-thread",
    turn: { id: "old-turn" },
  } });
  assert.deepEqual((await f.runtime.getStatus("developer")).status, idle);
});

test("turn/start only binds after its response confirms the candidate turn", async (t) => {
  const f = await fixture(t);
  let releaseStart;
  let reachedStart;
  const startReached = new Promise(resolve => { reachedStart = resolve; });
  const startGate = new Promise(resolve => { releaseStart = resolve; });
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => {
    if (method === "turn/start") {
      reachedStart();
      await startGate;
    }
    return request(method, params);
  };

  const sending = f.runtime.sendMessage({ employeeId: "developer", text: "new task", requestId: "new-task" });
  await startReached;
  f.listener({ method: "turn/started", params: {
    threadId: "employee-thread",
    turn: { id: "employee-turn" },
  } });
  let status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.phase, "submitted");
  assert.equal(status.turnId, "");

  f.listener({ method: "turn/started", params: {
    threadId: "employee-thread",
    turn: { id: "other-turn" },
  } });
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { status: "completed" },
  } });
  status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.phase, "submitted");
  assert.equal(status.active, true);

  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { id: "employee-turn", status: "completed" },
  } });
  status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.phase, "submitted");
  assert.equal(status.active, true);

  releaseStart();
  await sending;
  status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.phase, "idle");
  assert.equal(status.active, false);
  assert.equal(status.turnId, "");
});

test("compatible completion without a turn ID can arrive before the start response", async (t) => {
  const f = await fixture(t);
  let releaseStart;
  let reachedStart;
  const startReached = new Promise(resolve => { reachedStart = resolve; });
  const startGate = new Promise(resolve => { releaseStart = resolve; });
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => {
    if (method === "turn/start") {
      reachedStart();
      await startGate;
    }
    return request(method, params);
  };

  const sending = f.runtime.sendMessage({ employeeId: "developer", text: "legacy early completion", requestId: "legacy-early" });
  await startReached;
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { status: "completed" },
  } });
  let status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.phase, "submitted");
  assert.equal(status.active, true);

  releaseStart();
  await sending;
  status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.phase, "idle");
  assert.equal(status.active, false);
  assert.equal(status.turnId, "");
});

test("steer preserves the current turn and accepts its delta and final answer", async (t) => {
  const f = await fixture(t);
  await f.runtime.sendMessage({ employeeId: "developer", text: "first", requestId: "first" });
  let releaseSteer;
  let reachedSteer;
  const steerReached = new Promise(resolve => { reachedSteer = resolve; });
  const steerGate = new Promise(resolve => { releaseSteer = resolve; });
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => {
    if (method === "turn/steer") {
      reachedSteer();
      await steerGate;
    }
    return request(method, params);
  };

  const deltasBefore = f.events.filter(event => event.type === "employee_assistant_delta").length;
  const messagesBefore = f.events.filter(event => event.type === "employee_message_completed").length;
  const steering = f.runtime.sendMessage({ employeeId: "developer", text: "follow up", requestId: "follow-up" });
  await steerReached;
  assert.equal((await f.runtime.getStatus("developer")).status.turnId, "employee-turn");
  f.listener({ method: "item/agentMessage/delta", params: {
    threadId: "employee-thread", turnId: "employee-turn", itemId: "steer-answer", delta: "new",
  } });
  f.listener({ method: "item/completed", params: {
    threadId: "employee-thread", turnId: "employee-turn",
    item: { id: "steer-answer", type: "agentMessage", phase: "final_answer", text: "new answer" },
  } });
  assert.equal(f.events.filter(event => event.type === "employee_assistant_delta").length, deltasBefore + 1);
  assert.equal(f.events.filter(event => event.type === "employee_message_completed").length, messagesBefore + 1);

  releaseSteer();
  await steering;
  assert.equal((await f.runtime.getStatus("developer")).status.turnId, "employee-turn");
});

test("a failed submission cannot replay its buffered events into the next send", async (t) => {
  const f = await fixture(t);
  let starts = 0;
  let releaseFirst;
  let reachedFirst;
  const firstReached = new Promise(resolve => { reachedFirst = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => {
    if (method === "turn/start" && ++starts === 1) {
      reachedFirst();
      await firstGate;
      throw Error("start unavailable");
    }
    return request(method, params);
  };

  const first = f.runtime.sendMessage({ employeeId: "developer", text: "first", requestId: "first" });
  await firstReached;
  f.listener({ method: "item/completed", params: {
    threadId: "employee-thread", turnId: "employee-turn",
    item: { id: "stale-early", type: "agentMessage", phase: "final_answer", text: "must not replay" },
  } });
  releaseFirst();
  await assert.rejects(first, /start unavailable/);
  const messagesBefore = f.events.filter(event => event.type === "employee_message_completed").length;
  await f.runtime.sendMessage({ employeeId: "developer", text: "second", requestId: "second" });
  assert.equal(f.events.filter(event => event.type === "employee_message_completed").length, messagesBefore);
});

test("untagged agent output is rejected while untagged completion remains compatible", async (t) => {
  const f = await fixture(t);
  await f.runtime.sendMessage({ employeeId: "developer", text: "current", requestId: "current" });
  const deltasBefore = f.events.filter(event => event.type === "employee_assistant_delta").length;
  const messagesBefore = f.events.filter(event => event.type === "employee_message_completed").length;
  f.listener({ method: "item/agentMessage/delta", params: {
    threadId: "employee-thread", itemId: "untagged", delta: "old",
  } });
  f.listener({ method: "item/completed", params: {
    threadId: "employee-thread",
    item: { id: "untagged", type: "agentMessage", phase: "final_answer", text: "old answer" },
  } });
  assert.equal(f.events.filter(event => event.type === "employee_assistant_delta").length, deltasBefore);
  assert.equal(f.events.filter(event => event.type === "employee_message_completed").length, messagesBefore);
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { status: "completed" },
  } });
  const status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.active, false);
  assert.equal(status.phase, "idle");
});

test("a late old completion cannot clear a newly confirmed turn", async (t) => {
  const f = await fixture(t);
  await f.runtime.sendMessage({ employeeId: "developer", text: "first turn", requestId: "first-turn" });
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { id: "employee-turn", status: "completed" },
  } });
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => method === "turn/start"
    ? { turn: { id: "next-turn", status: "inProgress" } }
    : request(method, params);
  await f.runtime.sendMessage({ employeeId: "developer", text: "next turn", requestId: "next-turn" });
  f.listener({ method: "turn/started", params: {
    threadId: "employee-thread",
    turn: { id: "next-turn" },
  } });
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { id: "employee-turn", status: "completed" },
  } });
  const status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.active, true);
  assert.equal(status.phase, "working");
  assert.equal(status.turnId, "next-turn");
});

test("opening an active employee thread recovers its unfinished turn", async (t) => {
  const f = await fixture(t);
  await f.registry.bindMainThread("developer", "employee-thread");
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => method === "thread/read"
    ? { thread: {
      id: params.threadId,
      status: { type: "active" },
      turns: [{ id: "recovered-turn", status: "inProgress", items: [] }],
    } }
    : request(method, params);

  await f.runtime.open("developer");
  let status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.active, true);
  assert.equal(status.turnId, "recovered-turn");
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { id: "recovered-turn", status: "completed" },
  } });
  status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.active, false);
  assert.equal(status.turnId, "");
});

test("an active thread without a recoverable turn ends in the safe interrupted state", async (t) => {
  const f = await fixture(t);
  await f.registry.bindMainThread("developer", "employee-thread");
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => method === "thread/read"
    ? { thread: { id: params.threadId, status: { type: "active" }, turns: [] } }
    : request(method, params);

  await f.runtime.open("developer");
  const status = (await f.runtime.getStatus("developer")).status;
  assert.equal(status.active, false);
  assert.equal(status.phase, "interrupted");
  assert.equal(status.turnId, "");
});

test("project directory becomes idle when the current turn completes", async (t) => {
  const f = await fixture(t);
  const directory = createEmployeeProjectDirectory({
    project: "negus",
    projectRoot: f.root,
    registry: f.registry,
    employeeRuntime: f.runtime,
    employeeConversations: f.conversationStore,
    conversations: {
      findSession: async () => ({ threadId: "employee-thread", messages: [], updatedAt: null }),
      listSessions: async () => [],
    },
  });
  const route = createEmployeeProjectDirectoryRoutes({ directory });
  const read = async () => {
    let body = "";
    await route({ method: "GET" }, { writeHead() {}, end(value) { body = value; } }, new URL("http://localhost/api/project-directory"));
    return JSON.parse(body).projects.find(project => project.employeeId === "developer");
  };

  await f.runtime.sendMessage({ employeeId: "developer", text: "directory status", requestId: "directory-status" });
  let employee = await read();
  assert.equal(employee.status.active, true);
  assert.equal(employee.status.label, "正在主对话工作");
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { id: "employee-turn", status: "completed" },
  } });
  employee = await read();
  assert.equal(employee.status.active, false);
  assert.equal(employee.status.label, "等待任务");
});

test("an event from a previous employee thread is ignored", async (t) => {
  const f = await fixture(t);
  await f.runtime.sendMessage({ employeeId: "developer", text: "current thread", requestId: "current-thread" });
  const before = (await f.runtime.getStatus("developer")).status;
  await f.registry.bindMainThread("developer", "replacement-thread");
  f.listener({ method: "turn/completed", params: {
    threadId: "employee-thread",
    turn: { id: "employee-turn", status: "completed" },
  } });
  assert.deepEqual((await f.runtime.getStatus("developer")).status, before);
});

test("only interrupts the exact Turn owned by the requested Goal", async (t) => {
  const completions = [];
  const { runtime, calls, listener } = await fixture(t, {
    onTurnCompleted: (completion) => completions.push(completion),
  });
  await runtime.open("developer");
  await runtime.sendMessage({ employeeId: "developer", text: "run exact work", requestId: "request-exact-turn" });

  await assert.rejects(
    () => runtime.interrupt("developer", "another-turn"),
    /Goal|任务/u,
  );
  assert.equal(calls.some((call) => call.method === "turn/interrupt"), false);

  await runtime.interrupt("developer", "employee-turn");
  assert.deepEqual(calls.at(-1), {
    method: "turn/interrupt",
    params: { threadId: "employee-thread", turnId: "employee-turn" },
  });

  listener({
    method: "turn/completed",
    params: { threadId: "employee-thread", turn: { id: "employee-turn", status: "interrupted" } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(completions, [{
    employeeId: "developer",
    threadId: "employee-thread",
    turnId: "employee-turn",
    status: "interrupted",
    error: "",
  }]);
});

test("a new direct employee Thread uses the selected provider without migrating providers later", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-employee-provider-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = await createEmployeeProjectRegistry({
    stateFile: path.join(root, "employee-projects.json"),
    workspaceRoot: "D:\\project",
  });
  const currentCalls = [];
  const grokCalls = [];
  const client = (calls, threadId) => ({
    subscribe: () => () => {},
    close: () => {},
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: threadId } };
      if (method === "thread/read") return { thread: { id: params.threadId, turns: [] } };
      if (method === "thread/resume") return { thread: { id: params.threadId }, model: params.threadId === threadId ? "grok-4.6" : "" };
      if (method === "turn/start") return { turn: { id: "grok-turn", status: "inProgress" } };
      return {};
    },
  });
  const currentClient = client(currentCalls, "current-thread");
  const grokClient = client(grokCalls, "grok-thread");
  const modelProviders = {
    resolveRoute: ({ modelProviderId = "", model = "" }) => {
      const external = modelProviderId === "fusheng-grok" || (!modelProviderId && model === "grok-4.6");
      return {
        modelProviderId: external ? "fusheng-grok" : "current",
        model: model || (external ? "grok-4.6" : ""),
      };
    },
    getClient: async (route) => route.modelProviderId === "fusheng-grok" ? grokClient : currentClient,
  };
  const conversationStore = {
    async bindRuntime(value) { return { conversationId: "employee-grok-conversation", ...value }; },
    async readMessages() { return []; },
    async recordRuntimeEvent() {},
  };
  const runtime = createEmployeeRuntimeService({
    registry,
    conversationStore,
    projectRoot: "D:\\project",
    client: currentClient,
    modelProviders,
  });
  t.after(async () => { runtime.close(); await registry.close(); });

  await runtime.updateModelSettings("researcher", { model: "grok-4.6" });
  const opened = await runtime.open("researcher");
  assert.equal(opened.conversation.threadId, "grok-thread");
  assert.equal(currentCalls.some((call) => call.method === "thread/start"), false);
  assert.equal(grokCalls.find((call) => call.method === "thread/start").params.model, "grok-4.6");
  // A later cross-provider choice is saved for the next send; the existing thread stays where it is.
  await runtime.updateModelSettings("researcher", { model: "gpt-5.6-terra" });
  assert.equal(registry.get("researcher").modelProviderId, "fusheng-grok");
  assert.equal(registry.get("researcher").pendingModelSettings.model, "gpt-5.6-terra");
  assert.equal(currentCalls.some((call) => call.method === "thread/start"), false);
});

test("employee native goal notifications and controls share the owned client", async t => {
 const events=[];
 const f=await fixture(t,{execution:{publishThreadEvent:(...args)=>events.push(args)}});
 await f.runtime.open("developer");
 const goal={status:"blocked",objective:"owned goal"};
 f.listener({method:"thread/goal/updated",params:{threadId:"employee-thread",goal}});
 assert.deepEqual(events.at(-1),["employee-thread",{type:"goal_status",threadId:"employee-thread",conversationId:(await f.runtime.getStatus("developer")).conversationId,goal}]);
 await f.runtime.setGoal("employee-thread",{status:"paused"});
 assert.deepEqual(f.calls.at(-1),{method:"thread/goal/set",params:{threadId:"employee-thread",status:"paused"}});
 await assert.rejects(f.runtime.getGoal("unowned"),/Thread/);
});

const taskService = {
  leaderConfig: id => id === 'researcher' ? { 'mcp_servers.negus_tasks': { command: 'task-tools' } } : {},
  leaderInstructions: id => id === 'researcher' ? '委派后台调研' : '',
};

test('product leader starts with task tools and sends first message without resuming an empty thread', async t => {
  const f = await fixture(t, { taskService });
  await f.runtime.open('researcher');
  await f.runtime.getRuntimeContext('employee-thread');
  await f.runtime.sendMessage({ employeeId: 'researcher', text: '调研竞品' });
  assert.equal(f.calls.filter(c => c.method === 'thread/resume').length, 0);
  const start = f.calls.find(c => c.method === 'thread/start');
  assert.ok(start.params.config['mcp_servers.negus_tasks']);
  assert.match(start.params.developerInstructions, /委派后台调研/);
  assert.match(f.calls.find(c => c.method === 'turn/start').params.additionalContext['negus.employee'].value, /委派后台调研/);
});

for (const state of ['idle', 'active', 'unknown']) test(`existing product leader tool reload does not gate on ${state} state`, async t => {
  const f = await fixture(t, { taskService });
  await f.registry.bindMainThread('researcher', 'existing-product');
  const original = f.client.request;
  f.client.request = async (method, params) => method === 'thread/read'
    ? { thread: {
      id: params.threadId,
      status: state === 'unknown' ? undefined : { type: state },
      turns: state === 'active' ? [{ id: 'active-turn', status: 'inProgress', items: [] }] : [],
    } }
    : original(method, params);
  await f.runtime.open('researcher');
  const unloads = f.calls.filter(c => c.method === 'thread/unsubscribe');
  assert.equal(unloads.length, 1);
  assert.equal(f.calls.some(c => c.method === 'thread/start'), false);
  if (state === 'idle') assert.ok(f.calls.find(c => c.method === 'thread/resume').params.config['mcp_servers.negus_tasks']);
  if (state === 'active') {
    const status = (await f.runtime.getStatus('researcher')).status;
    assert.equal(status.active, true);
    assert.equal(status.turnId, 'active-turn');
  }
});

test('completion callback waits for send lock even when a turn completes before its start response', async t => {
  let completion;
  const completionStatuses = [];
  const finished = new Promise(resolve => { completion = resolve; });
  const f = await fixture(t, { onTurnCompleted: async () => {
    try {
      completionStatuses.push((await f.runtime.getStatus('researcher')).status);
      await f.runtime.sendMessage({ employeeId: 'researcher', text: '后台结果' });
      completion();
    }
    catch (error) { completion(error); }
  } });
  const original = f.client.request;
  let first = true;
  f.client.request = async (method, params) => {
    const result = await original(method, params);
    if (method === 'turn/start' && first) {
      first = false;
      f.listener({ method: 'turn/completed', params: { threadId: 'employee-thread', turn: { id: 'employee-turn', status: 'completed' } } });
    }
    return result;
  };
  await f.runtime.sendMessage({ employeeId: 'researcher', text: '主对话' });
  assert.equal(await finished, undefined);
  assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 2);
  assert.equal(completionStatuses[0].active, false);
  assert.equal(completionStatuses[0].phase, 'idle');
  assert.equal(completionStatuses[0].turnId, '');
});

test("employee steering preserves submission identity and current turn when response has no turn object", async (t) => {
  const { runtime, calls } = await fixture(t);
  await runtime.sendMessage({ employeeId: "developer", text: "same", requestId: "first" });
  for (const requestId of ["second", "third"]) {
    const result = await runtime.sendMessage({ employeeId: "developer", text: "same", requestId });
    assert.equal(calls.at(-1).method, "turn/steer");
    assert.equal(calls.at(-1).params.clientUserMessageId, requestId);
    assert.equal(calls.at(-1).params.expectedTurnId, "employee-turn");
    assert.equal(result.turnId, "employee-turn");
  }
});


test('employee fork registers as ordinary user conversation without replacing the employee', async t => {
  const registrations = [];
  const f = await fixture(t, { registerSession: async (...args) => { registrations.push(args); return args[0]; } });
  await f.runtime.open('developer');
  const before = f.registry.require('developer');
  const original = f.client.request.bind(f.client);
  f.client.request = async (method, params) => method === 'thread/fork'
    ? { thread: { id: 'employee-fork', model: 'actual-model', cwd: before.projectRoot } }
    : original(method, params);
  const result = await f.runtime.forkSession('developer', 'finished-turn');
  assert.equal(result.conversationKind, 'standard');
  assert.equal(result.forkedFromId, before.mainThreadId);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][1], before.modelProviderId || 'current');
  assert.ok(registrations[0][2].endsWith('actual-model'));
  assert.equal(f.registry.require('developer').mainThreadId, before.mainThreadId);
  assert.equal(f.registry.require('developer').conversationId, before.conversationId);
  assert.equal(result.conversationId, undefined);
});
