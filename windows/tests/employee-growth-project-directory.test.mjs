import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEmployeeProjectDirectory } from "../server/employee-project-directory.mjs";
import { createEmployeeGrowthReviewer } from "../server/employee-growth-reviewer.mjs";
import { createEmployeeGrowthService } from "../server/employee-growth-service.mjs";
import { createEmployeeGrowthStore } from "../server/employee-growth-store.mjs";
import { createEmployeeProjectRegistry } from "../server/employee-project-registry.mjs";
import { createEmployeeRuntimeService } from "../server/employee-runtime-service.mjs";
import { createMultiAgentService } from "../server/multi-agent-service.mjs";
import { createBackgroundTaskService } from "../server/background-tasks/service.mjs";
import { createEmployeeGrowthRoutes } from "../server/routes/employee-growth-routes.mjs";

const fixture = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-growth-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = await createEmployeeProjectRegistry({
    stateFile: path.join(root, "employee-projects.json"),
    workspaceRoot: root,
  });
  const stateFile = path.join(root, "growth.json");
  const store = await createEmployeeGrowthStore({
    stateFile,
    registry,
  });
  const growth = createEmployeeGrowthService({
    registry,
    store,
    reviewer: createEmployeeGrowthReviewer({
      review: async () => ({
        facts: [{ text: "fact" }],
        rules: [{ text: "rule" }],
        skills: [{ name: "safe skill", text: "skill" }],
      }),
    }),
    broadcast: () => {},
  });
  t.after(async () => {
    await store.close();
    await registry.close();
  });
  return { root, registry, store, growth, stateFile };
};

test("registry provisions isolated context roots and keeps legacy developer bindings", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-registry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "employee-projects.json");
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify({ employees: [{ id: "developer", mainThreadId: "old-thread", conversationId: "old-conversation" }] }));
  const registry = await createEmployeeProjectRegistry({ stateFile, workspaceRoot: root });
  t.after(() => registry.close());
  assert.deepEqual(registry.list().map((item) => item.id), ["negus-assistant", "manager", "researcher", "developer", "reviewer", "grok"]);
  assert.equal(registry.get("developer").mainThreadId, "old-thread");
  assert.equal(registry.get("developer").conversationId, "old-conversation");
  assert.notEqual(registry.get("manager").contextRoot, registry.get("developer").contextRoot);
});

test("growth stores facts immediately and keeps rules/skills pending until approval", async (t) => {
  const { root, registry, store, growth } = await fixture(t);
  const ready = await growth.reviewTask({ employeeId: "developer", turnId: "turn-1", taskText: "task", replyText: "reply" });
  assert.equal(ready.facts.length, 1);
  assert.equal(ready.proposals.length, 2);
  assert.equal(store.get("developer").proposals.every((item) => item.status === "pending"), true);
  const rule = ready.proposals.find((item) => item.kind === "rule");
  const first = await growth.decide("developer", rule.id, "approved", { requestId: "approve-1" });
  const second = await growth.decide("developer", rule.id, "approved", { requestId: "approve-1" });
  assert.equal(first.status, "approved");
  assert.equal(second.status, "approved");
  assert.match(growth.getContext("developer"), /rule/);
  const directory = createEmployeeProjectDirectory({
    project: "negus",
    projectRoot: root,
    registry,
    employeeRuntime: { getStatus: async () => ({ status: { phase: "idle", active: false } }) },
  });
  const listing = await directory.list();
  assert.equal(listing.projects.length, 7);
  assert.equal(listing.projects.filter((item) => item.kind === "employee").length, 6);
});

test("reviewer failures return a failed result without throwing", async (t) => {
  const { registry, store } = await fixture(t);
  const events = [];
  const growth = createEmployeeGrowthService({
    registry,
    store,
    reviewer: createEmployeeGrowthReviewer({ review: async () => { throw new Error("review unavailable"); } }),
    broadcast: (event) => events.push(event),
  });
  const result = await growth.reviewTask({ employeeId: "developer", turnId: "turn-failed" });
  assert.match(result.error, /review unavailable/);
  assert.equal(events.at(-1).type, "employee_growth_failed");
});

test("explicit memory requests are pending and idempotent; only approved global rules remain active", async (t) => {
  const { growth, registry } = await fixture(t);
  assert.equal(await growth.suggestFromMessage("developer", "帮我调研一手来源", "ordinary"), null);
  assert.equal(await growth.suggestFromMessage("developer", "以后可能会下雨", "ordinary-2"), null);
  assert.equal(await growth.suggestFromMessage("developer", "记住了这件事", "ordinary-3"), null);
  assert.equal(await growth.suggestFromMessage("developer", "今后可能下雨", "ordinary-4"), null);
  const pending = await growth.suggestFromMessage("developer", "记住，以后调研都必须标注一手来源。", "message-1");
  const duplicate = await growth.suggestFromMessage("developer", "记住，以后调研都必须标注一手来源。", "message-1");
  assert.equal(pending.id, duplicate.id);
  assert.equal(growth.get("developer").proposals.length, 1);
  assert.equal(pending.status, "pending");
  assert.equal(growth.getContext("developer"), "");
  await growth.decide("developer", pending.id, "approved");
  assert.match(growth.getContext("developer"), /一手来源/);
  assert.equal(growth.getContext("manager"), "");
  const file = path.join(registry.require("developer").contextRoot, "AGENTS.md");
  await fs.rm(file, { force: true });
  await fs.mkdir(file);
  await growth.changeRule("developer", pending.id, "disabled");
  assert.equal(growth.getContext("developer"), "");
  const manual = await growth.addRule("developer", "始终给出证据", "manual-1");
  assert.equal(manual.status, "approved");
  assert.match(growth.getContext("developer"), /始终给出证据/);
  await growth.changeRule("developer", manual.id, "deleted");
  assert.equal(growth.getContext("developer"), "");
  assert.equal(growth.get("developer").proposals.find(item => item.id === manual.id).status, "deleted");
  assert.equal((await growth.suggestFromMessage("developer", "以后必须标注来源", "strong")).status, "pending");
});

test("saved facts and approved skills remain in employee context", async t => {
  const { growth } = await fixture(t);
  const result = await growth.reviewTask({ employeeId: "developer", turnId: "compat" });
  const skill = result.proposals.find(item => item.kind === "skill");
  await growth.decide("developer", skill.id, "approved");
  assert.match(growth.getContext("developer"), /员工已保存事实：\n- fact/);
  assert.match(growth.getContext("developer"), /员工已批准 Skill：\n- skill/);
});

test("rule decisions remain consistent when notifications fail", async t => {
  const { registry, store } = await fixture(t);
  const growth = createEmployeeGrowthService({ registry, store, broadcast: () => { throw Error("notification unavailable"); } });
  const rule = await growth.addRule("developer", "标注来源", "notify");
  assert.equal(rule.status, "approved");
  assert.equal((await growth.changeRule("developer", rule.id, "disabled")).status, "disabled");
  assert.equal((await growth.changeRule("developer", rule.id, "deleted")).status, "deleted");
  assert.equal(growth.get("developer").proposals.find(item => item.id === rule.id).status, "deleted");
  assert.equal(growth.getContext("developer"), "");
});

test("rule disable requests are idempotent and preserve persistence failures", async t => {
  const { growth, store, stateFile } = await fixture(t);
  const rule = await growth.addRule("developer", "每次标注一手来源", "manual-disable");
  const logCount = store.get("developer").logs.length;
  const first = await growth.changeRule("developer", rule.id, "disabled", { requestId: "disable-rule-1" });
  const retried = await growth.changeRule("developer", rule.id, "disabled", { requestId: "disable-rule-1" });
  const repeated = await growth.changeRule("developer", rule.id, "disabled", { requestId: "disable-rule-2" });
  assert.equal(first.status, "disabled");
  assert.equal(retried.status, "disabled");
  assert.equal(repeated.status, "disabled");
  assert.equal(store.get("developer").logs.length, logCount + 1);
  assert.equal(store.get("developer").logs.at(-1).requestId, "disable-rule-1");
  assert.equal(growth.getContext("developer"), "");

  const nextRule = await growth.addRule("developer", "交付前核对证据", "manual-persist");
  await fs.unlink(stateFile);
  await fs.mkdir(stateFile);
  const failed = await Promise.allSettled([
    growth.changeRule("developer", nextRule.id, "disabled", { requestId: "persist-failed" }),
    growth.changeRule("developer", nextRule.id, "disabled", { requestId: "persist-failed" }),
  ]);
  assert.equal(failed.every(result => result.status === "rejected"), true);
  assert.match(failed[0].reason.message, /ENOTDIR|EISDIR|EEXIST|ENOTEMPTY/u);
  assert.equal(store.get("developer").proposals.find(item => item.id === nextRule.id).status, "approved");
  assert.match(growth.getContext("developer"), /交付前核对证据/);
  await fs.rm(stateFile, { recursive: true, force: true });
  assert.equal((await growth.changeRule("developer", nextRule.id, "disabled", { requestId: "persist-retry" })).status, "disabled");
});

test("failed delete restores an approved rule snapshot and a successful retry stays idempotent", async t => {
  const { growth, store, stateFile } = await fixture(t);
  const rule = await growth.addRule("developer", "删除前核对审计", "delete-approved");
  const before = store.get("developer").proposals.find(item => item.id === rule.id);
  const beforeLogs = store.get("developer").logs;
  assert.match(growth.getContext("developer"), /删除前核对审计/);
  await fs.unlink(stateFile);
  await fs.mkdir(stateFile);
  await assert.rejects(growth.changeRule("developer", rule.id, "deleted", { requestId: "delete-approved-failed" }), /ENOTDIR|EISDIR|EEXIST|ENOTEMPTY/u);
  assert.deepEqual(store.get("developer").proposals.find(item => item.id === rule.id), before);
  assert.deepEqual(store.get("developer").logs, beforeLogs);
  assert.match(growth.getContext("developer"), /删除前核对审计/);
  await fs.rm(stateFile, { recursive: true, force: true });

  const deleted = await growth.changeRule("developer", rule.id, "deleted", { requestId: "delete-approved-retry" });
  assert.equal(deleted.status, "deleted");
  assert.equal(growth.getContext("developer"), "");
  const afterDelete = store.get("developer").proposals.find(item => item.id === rule.id);
  const logsAfterDelete = store.get("developer").logs;
  const repeated = await growth.changeRule("developer", rule.id, "deleted", { requestId: "delete-approved-again" });
  assert.equal(repeated.status, "deleted");
  assert.deepEqual(store.get("developer").proposals.find(item => item.id === rule.id), afterDelete);
  assert.deepEqual(store.get("developer").logs, logsAfterDelete);
});

test("failed delete from disabled restores audit metadata without overwriting concurrent writes", async t => {
  const { growth, store, stateFile } = await fixture(t);
  const rule = await growth.addRule("developer", "停用后保留审计", "delete-disabled");
  await growth.changeRule("developer", rule.id, "disabled", { requestId: "disable-ok" });
  const before = store.get("developer").proposals.find(item => item.id === rule.id);
  const beforeLogs = store.get("developer").logs;
  assert.equal(before.status, "disabled");
  assert.ok(before.statusChangedAt);
  assert.equal(before.statusRequestId, "disable-ok");
  assert.equal(growth.getContext("developer"), "");

  await fs.unlink(stateFile);
  await fs.mkdir(stateFile);
  const failedDelete = growth.changeRule("developer", rule.id, "deleted", { requestId: "delete-disabled-failed" });
  await Promise.resolve();
  const concurrentWrite = store.appendLog("developer", { action: "concurrent_write", itemId: "other" });
  const [failed, concurrent] = await Promise.allSettled([failedDelete, concurrentWrite]);
  assert.equal(failed.status, "rejected");
  assert.equal(concurrent.status, "rejected");
  assert.deepEqual(store.get("developer").proposals.find(item => item.id === rule.id), before);
  assert.equal(growth.getContext("developer"), "");
  const logsAfterFailure = store.get("developer").logs;
  assert.deepEqual(logsAfterFailure.slice(0, beforeLogs.length), beforeLogs);
  assert.equal(logsAfterFailure.filter(item => item.action === "concurrent_write").length, 1);
  assert.equal(logsAfterFailure.some(item => item.action === "rule_deleted"), false);

  await fs.rm(stateFile, { recursive: true, force: true });
  assert.equal((await growth.changeRule("developer", rule.id, "deleted", { requestId: "delete-disabled-retry" })).status, "deleted");
  const persisted = JSON.parse(await fs.readFile(stateFile, "utf8"));
  const persistedLogs = persisted.employees.developer.logs;
  assert.equal(persistedLogs.filter(item => item.action === "concurrent_write").length, 1);
  assert.equal(persistedLogs.some(item => item.requestId === "delete-disabled-retry"), true);
  assert.equal(persistedLogs.some(item => item.requestId === "delete-disabled-failed"), false);
});

test("disable-rule route forwards the requestId for an idempotent retry", async t => {
  const { growth } = await fixture(t);
  const rule = await growth.addRule("developer", "先查证再回答", "manual-route");
  const route = createEmployeeGrowthRoutes({ growth });
  const server = http.createServer(async (request, response) => {
    if (!(await route(request, response, new URL(request.url, "http://127.0.0.1")))) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const send = () => fetch(`http://127.0.0.1:${port}/api/employee-growth/disable-rule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: "developer", proposalId: rule.id, requestId: "disable-route-1" }),
  });
  const first = await send();
  const retried = await send();
  assert.equal(first.status, 202);
  assert.equal(retried.status, 202);
  assert.equal((await first.json()).status, "disabled");
  assert.equal((await retried.json()).status, "disabled");
  assert.equal(growth.get("developer").proposals.find(item => item.id === rule.id).statusRequestId, "disable-route-1");
});

test("three execution paths load the same rule snapshot at the start of a turn", async (t) => {
  const { root, registry, growth } = await fixture(t);
  const rule = await growth.addRule("developer", "每次标注一手来源", "rule-1");
  const requests = [];
  const client = { subscribe: () => () => {}, request: async (method, params) => {
    requests.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread" } };
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "turn/start") return { turn: { id: "turn" } };
    return {};
  } };
  const runtime = createEmployeeRuntimeService({ registry, projectRoot: root, client, growthService: growth, contextProvider: growth.getContext,
    conversationStore: { bindRuntime: async value => value, recordRuntimeEvent: async () => {} } });
  t.after(() => runtime.close());
  await runtime.sendMessage({ employeeId: "developer", text: "普通问题", requestId: "normal" });
  const direct = requests.find(call => call.method === "turn/start").params.additionalContext["negus.employee"].value;
  assert.match(direct, /每次标注一手来源/);
  assert.equal(growth.get("developer").proposals.length, 1);

  let agent = { id: "developer", name: "Developer", instructions: "", threadId: "group-thread" };
  let delivered = false;
  const room = { snapshot: () => ({ agents: [agent] }), getAgent: () => agent,
    updateAgent: async (_id, patch) => (agent = { ...agent, ...patch }),
    getAgentContext: () => ({ messages: [], throughSequence: 1 }),
    addMessage: async message => message, advanceAgentContext: async () => { delivered = true; },
    beginAgentWork: () => {}, finishAgentWork: () => {} };
  const group = createMultiAgentService({ projectRoot: root, room, broadcast: () => {}, appServerClient: client, growthService: growth });
  t.after(() => group.close());
  await group.enqueueDiscussion({ agentIds: ["developer"], requestText: "调研" });
  for (let i = 0; i < 100 && !delivered; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered, true);
  const groupStart = requests.find(call => call.method === "turn/start" && call.params.threadId === "group-thread");
  assert.match(groupStart.params.developerInstructions, /每次标注一手来源/);
  await group.close();

  await registry.bindMainThread("developer", "leader");
  const tasks = await createBackgroundTaskService({ stateFile: path.join(root, "tasks.json"), registry, growthService: growth,
    modelProviders: {
      providers: () => [{ id: "ccswitch_deepseek", displayName: "DeepSeek", models: [{ model: "deepseek-flash" }] }],
      isProviderConfigured: async () => true,
      resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }),
    },
    conversations: { createSession: async () => ({ threadId: "worker" }), renameSession: async () => {}, sendMessage: async () => {} },
    bindings: { bindRuntime: async value => value }, queue: { enqueue: async () => {} },
    execution: { getStatus: () => ({ active: true, turnId: "leader-turn" }) } });
  t.after(() => tasks.close());
  await tasks.create("developer", { title: "调研", instructions: "调查来源" });
  for (let i = 0; i < 100 && !tasks.runtimeOptions({ id: "worker" }); i++) await new Promise(resolve => setTimeout(resolve, 2));
  const snapshot = tasks.runtimeOptions({ id: "worker" }).turn.developerInstructions;
  assert.match(snapshot, /每次标注一手来源/);
  await growth.changeRule("developer", rule.id, "disabled");
  assert.equal(growth.getContext("developer"), "");
  await runtime.confirmModification("developer");
  await runtime.sendMessage({ employeeId: "developer", text: "停用后的问题", requestId: "normal-after-disable" });
  const latestDirect = requests.filter(call => call.method === "turn/start" && call.params.additionalContext?.["negus.employee"]).at(-1);
  assert.doesNotMatch(latestDirect.params.additionalContext["negus.employee"].value, /每次标注一手来源/);
  const groupAfterDisable = createMultiAgentService({ projectRoot: root, room, broadcast: () => {}, appServerClient: client, growthService: growth });
  t.after(() => groupAfterDisable.close());
  delivered = false;
  await groupAfterDisable.enqueueDiscussion({ agentIds: ["developer"], requestText: "停用后的调研" });
  for (let i = 0; i < 100 && !delivered; i++) await new Promise(resolve => setImmediate(resolve));
  const latestGroup = requests.filter(call => call.method === "turn/start" && call.params.threadId === "group-thread").at(-1);
  assert.doesNotMatch(latestGroup.params.developerInstructions, /每次标注一手来源/);
  assert.doesNotMatch(tasks.runtimeOptions({ id: "worker" }).turn.developerInstructions, /每次标注一手来源/);
  assert.match(snapshot, /每次标注一手来源/);
});

test("directory bounds employee history reads and shares concurrent scans without retaining stale results", async () => {
  let release;
  let scans = 0;
  const reads = [];
  let activity = "2026-09-22T01:00:00.000Z";
  const directory = createEmployeeProjectDirectory({
    project: "negus", projectRoot: "D:/fixture",
    registry: { list: () => [{ id: "developer", mainThreadId: "employee-thread", conversationId: "employee-conversation" }] },
    employeeConversations: { readMessages: async () => [{ role: "user", createdAt: "2026-09-21T00:00:00.000Z" }] },
    conversations: {
      findSession: async (...args) => { reads.push(args); return { updatedAt: activity }; },
      listSessions: async () => { scans += 1; await new Promise((resolve) => { release = resolve; }); return []; },
    },
  });
  const first = directory.list();
  const duplicate = directory.list();
  assert.equal(first, duplicate);
  await new Promise(setImmediate);
  assert.equal(scans, 1);
  release();
  const result = await first;
  assert.deepEqual(reads, [["employee-thread", "all", { limit: 1 }]]);
  assert.equal(result.projects.find((project) => project.kind === "employee").lastActivityAt, activity);
  activity = "2026-09-22T02:00:00.000Z";
  const next = directory.list();
  await new Promise(setImmediate);
  assert.equal(scans, 2);
  release();
  assert.equal((await next).projects.find((project) => project.kind === "employee").lastActivityAt, activity);
});

test("failed directory scan releases the shared request for retry", async () => {
  let fail = true;
  const directory = createEmployeeProjectDirectory({
    project: "negus", projectRoot: "D:/fixture",
    registry: { list: () => { if (fail) throw new Error("unavailable"); return []; } },
  });
  await assert.rejects(directory.list(), /unavailable/);
  fail = false;
  assert.equal((await directory.list()).projects.length, 1);
});

test("directory returns fresh employee previews without opening their conversations", async () => {
  const messages = [{ role: "assistant", text: "上次回复", createdAt: "2026-10-28T09:00:00Z" }];
  const directory = createEmployeeProjectDirectory({
    project: "negus", projectRoot: "/fixture",
    registry: { list: () => [{ id: "developer", mainThreadId: "thread-B", conversationId: "conversation-B" }] },
    employeeConversations: { readMessages: async () => messages },
    conversations: {
      findSession: async () => ({ updatedAt: "2026-10-28T10:00:00Z",
        messages: [{ role: "assistant", text: "原生记录新回复", createdAt: "2026-10-28T10:00:00Z" }] }),
      listSessions: async () => [],
    },
  });
  const first = (await directory.list()).projects.find(project => project.kind === "employee").conversations[0];
  assert.equal(first.latestMessage, "原生记录新回复");
  messages.push({ role: "assistant", text: "刚收到\n更新的回复", createdAt: "2026-10-28T11:00:00Z" });
  const next = (await directory.list()).projects.find(project => project.kind === "employee").conversations[0];
  assert.equal(next.latestMessage, "刚收到 更新的回复");
  assert.equal(next.latestMessageAt, "2026-10-28T11:00:00Z");
  assert.equal(next.lastActivityAt, "2026-10-28T11:00:00Z");
  assert.equal(next.messages, undefined);
});

test("task directory deduplicates threads and sorts by real messages, not recovery updates", async () => {
  let latestMessageAt = "2026-10-28T05:46:02.516Z";
  const calls = [];
  const directory = createEmployeeProjectDirectory({
    project: "negus", projectRoot: "/fixture",
    registry: { list: () => [{ id: "developer" }] },
    agentTasks: { directoryEntries: () => [
      { threadId: "thread", conversationId: "handoff-1", lastActivityAt: "2026-10-28T04:45:27Z", status: { active: false, phase: "completed" } },
      { threadId: "thread", conversationId: "handoff-1", lastActivityAt: "2026-10-28T15:28:22Z", status: { active: false, phase: "completed" } },
    ], providerForThread: () => "vip" },
    taskSessionSummaries: async (...args) => { calls.push(args); return [{ threadId: "thread", latestMessageAt, latestMessage: "消息" }]; },
    conversations: { listSessions: async () => [] },
  });
  const read = async () => (await directory.list()).projects.find(project => project.kind === "employee");
  const first = await read();
  assert.equal(first.conversations.length, 1);
  assert.equal(first.conversations[0].lastActivityAt, latestMessageAt);
  assert.equal(first.lastActivityAt, latestMessageAt);
  assert.deepEqual(calls, [["vip", "all", false]]);
  latestMessageAt = "2026-10-28T16:00:00Z";
  assert.equal((await read()).conversations[0].lastActivityAt, latestMessageAt);
});
