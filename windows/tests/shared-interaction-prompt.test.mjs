import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { basePrompt } from "../server/base-prompt.mjs";
import { employeeTurnInstructions } from "../server/employee-definitions.mjs";
import { loadUserProfilePrompt } from "../server/user-profile-prompt.mjs";

test("普通对话有无画像、员工角色均加载一份共用交互规则", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-interaction-prompt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ordinary = await loadUserProfilePrompt(root);
  await fs.writeFile(path.join(root, "USER_PROFILE.md"), "测试画像");
  const profiled = await loadUserProfilePrompt(root);
  assert.match(profiled, /测试画像/);
  for (const prompt of [basePrompt, ordinary, profiled, employeeTurnInstructions("隔离员工角色")]) {
    assert.equal((prompt.match(/处理交互时，先写清用户点了什么/g) || []).length, 1);
    assert.match(prompt, /可撤回的选择与真正提交/);
    assert.match(prompt, /执行以用户明确授权为准/);
    assert.doesNotMatch(prompt, /vip 0\.12/);
  }
});

test("普通后台实际首次创建、首轮、恢复、后续轮次和分支请求各含一份共用规则", async t => {
  const { createAppServerConversationStore } = await import("../server/app-server-conversation-store.mjs");
  const { createBackgroundTaskService } = await import("../server/background-tasks/service.mjs");
  const { createConversationRoutes } = await import("../server/routes/conversation-routes.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-worker-prompt-"));
  await fs.writeFile(path.join(root, "USER_PROFILE.md"), "隔离画像标记");
  const requests = [];
  const firstTurn = Promise.withResolvers();
  const thread = { id: "worker", cwd: root };
  const employee = { id: "fixture", name: "隔离员工", projectRoot: root, mainThreadId: "origin" };
  let worker;
  const store = createAppServerConversationStore({
    projectRoot: root,
    autoTitleEnabled: false,
    threadRuntimeOptions: value => worker?.runtimeOptions(value),
    client: {
      subscribe: () => () => {},
      close() {},
      async request(method, params) {
        requests.push({ method, params });
        if (method === "turn/start") {
          firstTurn.resolve();
          return { turn: { id: "fixture-turn" } };
        }
        if (["thread/start", "thread/read", "thread/resume", "thread/name/set"].includes(method)) return { thread };
        if (method === "thread/fork") return { thread: { id: "forked-worker", cwd: root } };
        throw new Error(method);
      },
    },
  });
  t.after(async () => { await worker?.close?.(); store.close(); await fs.rm(root, { recursive: true, force: true }); });
  worker = await createBackgroundTaskService({
    stateFile: path.join(root, "tasks.json"),
    registry: { list: () => [employee], require: () => employee },
    growthService: { getContext: () => "隔离成长标记" },
    modelProviders: { providers: () => [{ id: "current", defaultModel: "fixture-model" }],
      isProviderConfigured: async () => true, resolveRoute: request => request },
    execution: { getStatus: () => ({ active: true, turnId: "origin-turn" }) },
    bindings: { bindRuntime: async () => ({ conversationId: "fixture-binding" }) },
    conversations: {
      createSession: (model, cwd, _provider, options) => store.createSession(model, cwd, options),
      renameSession: (...args) => store.renameSession(...args),
      sendMessage: (...args) => store.sendMessage(...args),
    },
  });
  const startup = await worker.create(employee.id, { title: "隔离任务", instructions: "检查实际请求参数" });
  const deadline = AbortSignal.timeout(4000);
  await Promise.race([firstTurn.promise, new Promise((_, reject) => deadline.addEventListener("abort", () =>
    reject(new Error(JSON.stringify(worker.list(employee.id)))), { once: true }))]);
  await worker.close();
  worker = { runtimeOptions: worker.runtimeOptions };
  await store.sendMessage(thread.id, "下一轮隔离请求");
  const binding = { conversationKind: "task", runtimeSessionId: thread.id };
  const route = createConversationRoutes({
    conversations: store, execution: { getStatus: () => ({ active: false }) },
    agentConversationStore: { findByRuntimeSession: () => binding, resolve: async () => binding },
    agentTasks: { ownsThread: id => id === thread.id },
  });
  const request = Object.assign(Readable.from([Buffer.from(JSON.stringify({
    threadId: thread.id, conversationId: "fixture-binding", lastTurnId: "fixture-turn",
  }))]), { method: "POST" });
  let status;
  let response;
  await route(request, {
    writeHead(code) { status = code; },
    end(body) { response = JSON.parse(body); },
  }, new URL("http://127.0.0.1/api/session/fork"));
  assert.equal(status, 201);
  assert.equal(response.session.threadId, "forked-worker");
  assert.equal(response.sourceThreadId, thread.id);
  assert.equal(response.forkedFromTurnId, "fixture-turn");
  const protocol = requests.filter(request => ["thread/start", "thread/resume", "turn/start", "thread/fork"].includes(request.method));
  assert.deepEqual(protocol.map(request => request.method), ["thread/start", "turn/start", "thread/resume", "turn/start", "thread/fork"]);
  for (const { method, params } of protocol) {
    const instructions = params.developerInstructions;
    for (const marker of ["区分可撤回的选择与真正提交", "隔离画像标记", "你是临时后台任务执行者"]) {
      assert.equal(instructions.split(marker).length - 1, 1, method + ": " + marker);
    }
    assert.equal(instructions.includes("隔离成长标记"), method === "turn/start");
    assert.equal("additionalDeveloperInstructions" in params, false);
  }
  assert.equal(protocol[1].params.clientUserMessageId, "task-" + startup.id);
  assert.equal(protocol[4].params.threadId, thread.id);
  assert.equal(protocol[4].params.lastTurnId, "fixture-turn");
});
