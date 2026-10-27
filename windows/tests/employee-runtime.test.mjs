import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEmployeeProjectRegistry } from "../server/employee-project-registry.mjs";
import { createEmployeeRuntimeService } from "../server/employee-runtime-service.mjs";

const fixture = async (t, { execution = null, onTurnCompleted = null, taskService = null, readHistory } = {}) => {
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
    projectRoot: "D:\\project",
    client,
    broadcast: (event) => events.push(event),
    execution,
    onTurnCompleted,
    taskService,
  });
  t.after(async () => {
    runtime.close();
    await registry.close();
  });
  return { registry, client, conversationStore, runtime, events, calls, get listener() { return listener; } };
};

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

test("employee registry keeps identity state private from API-shaped values", async (t) => {
  const { registry } = await fixture(t);
  const employee = registry.get("developer");
  assert.equal(employee.id, "developer");
  assert.equal("instructions" in employee, false);
  assert.equal(registry.require("developer").instructions.includes("Legacy policy marker"), false);
  const grok = registry.get("grok");
  assert.equal(grok.modelProviderId, "fusheng-grok");
  assert.equal(grok.model, "grok-4.6");
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
  const execution = {
    publishStatus: (threadId, status) => statuses.push({ threadId, ...status }),
    publishThreadEvent: (threadId, event) => threadEvents.push({ threadId, event }),
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
  assert.equal(statuses.at(-1).phase, "idle");
  assert.deepEqual(threadEvents[0], {
    threadId: "employee-thread",
    event: {
      type: "assistant_delta",
      threadId: "employee-thread",
      turnId: "employee-turn",
      itemId: "assistant-item",
      delta: "done",
    },
  });
  assert.deepEqual(threadEvents.at(-1), {
    threadId: "employee-thread",
    event: { type: "sessions_changed", threadId: "employee-thread" },
  });
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
  await assert.rejects(
    () => runtime.updateModelSettings("researcher", { model: "gpt-5.6-terra" }),
    /跨供应商/u,
  );
  assert.equal(registry.get("researcher").modelProviderId, "fusheng-grok");
  await runtime.sendMessage({ employeeId: "researcher", text: "identify your model" });
  assert.equal(grokCalls.some((call) => call.method === "turn/start"), true);
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
    ? { thread: { id: params.threadId, status: state === 'unknown' ? undefined : { type: state }, turns: [] } }
    : original(method, params);
  await f.runtime.open('researcher');
  const unloads = f.calls.filter(c => c.method === 'thread/unsubscribe');
  assert.equal(unloads.length, 1);
  assert.equal(f.calls.some(c => c.method === 'thread/start'), false);
  if (state === 'idle') assert.ok(f.calls.find(c => c.method === 'thread/resume').params.config['mcp_servers.negus_tasks']);
  if (state === 'active') assert.equal((await f.runtime.getStatus('researcher')).status.active, true);
});

test('completion callback waits for send lock even when a turn completes before its start response', async t => {
  let completion;
  const finished = new Promise(resolve => { completion = resolve; });
  const f = await fixture(t, { onTurnCompleted: async () => {
    try { await f.runtime.sendMessage({ employeeId: 'researcher', text: '后台结果' }); completion(); }
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
