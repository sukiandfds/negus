import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProviderConversationStore } from "../server/provider-conversation-store.mjs";

test("channel switching preserves the thread and sends only the next user message, including after restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-model-transfer-"));
  try {
    const sessions = new Map([["original", { threadId: "original", cwd: root, title: "项目讨论", messages: [{role:"user",text:"前文"},{role:"assistant",text:"已处理"}], hasMore:false }]]);
    const calls = [];
    let counter = 0;
    const store = (providerId) => ({
      findSession: async (id) => sessions.get(id),
      createSession: async (model, cwd) => {
        const result = { threadId: `${providerId}-${++counter}`, cwd, model, messages: [], hasMore: false };
        sessions.set(result.threadId, result); return result;
      },
      renameSession: async (id, title) => { sessions.get(id).title = title; },
      sendMessage: async (id, text) => { calls.push({ id, text, providerId }); },
      updateModel: async (id, model) => { calls.push({ id, model, providerId }); return { model }; },
      getSessionResumeInfo: async (id) => ({ path: path.join(root, 'rollout.jsonl'), cwd: root, model: providerId === 'current' ? 'gpt-6-astra' : 'grok-4.6', summary: sessions.get(id) }),
      releaseSession: async () => {},
      resumeProviderSession: async (id, options) => { assert.equal(id, 'original'); assert.equal(options.cwd, root); },
      getRuntimeContext: async () => ({ model: 'gpt-6-astra' }),
      listSessions: async () => [...sessions.values()],
      listModels: async () => [],
      close() {},
    });
    const providers = {
      resolveRoute: ({model}) => ({modelProviderId: model.startsWith("grok") ? "fusheng-grok" : "current"}),
      getClient: async () => ({}), listModels: async (models) => models,
      isProviderConfigured: async () => true,
    };
    const options = { current: store("current"), providers, createStore: () => store("fusheng-grok"), stateFile: path.join(root,"routes.json") };
    const service = createProviderConversationStore(options);
    await service.updateModel("original", "grok-4.6");
    assert.equal(sessions.size, 1);
    assert.equal(calls.length, 0);
    const next = await service.updateModel("original", "grok-4.6", {allowProviderSwitch:true});
    assert.equal(next.threadId, 'original');
    assert.equal(sessions.get("original").messages.length, 2);
    assert.equal(calls.length, 0);
    assert.equal((await service.getRuntimeContext('original')).model, 'grok-4.6');
    await service.sendMessage('original', '下一条用户消息');
    assert.equal(calls[0].text, '下一条用户消息');
    assert.equal(calls[0].providerId, "fusheng-grok");
    assert.equal((await service.listSessions()).length, 1);
    const restored = createProviderConversationStore(options);
    await restored.updateModel(next.threadId, "grok-4.5");
    assert.equal(calls.at(-1).providerId, "fusheng-grok");
    assert.equal(sessions.size, 1);
    const back = await restored.updateModel(next.threadId, "gpt-6-astra", {allowProviderSwitch:true});
    assert.equal(back.modelProvider, "current");
    assert.equal(back.threadId, 'original');
    assert.equal(sessions.size, 1);
    await restored.sendMessage('original', '切回后继续');
    assert.equal(calls.at(-1).providerId, 'current');
    assert.equal((await restored.findSession(next.threadId)).model, "gpt-6-astra");
    sessions.get("original").messages = [{role:"user",text:"x".repeat(100001)}];
    await restored.updateModel("original", "grok-4.6", {allowProviderSwitch:true});
    assert.equal(sessions.size, 1);
    const failing = createProviderConversationStore({ ...options, createStore: () => ({ ...store('fusheng-grok'), resumeProviderSession: async () => { throw Error('resume failed'); } }) });
    const sendsBeforeFailure = calls.filter((call) => call.text).length;
    await assert.rejects(failing.sendMessage('original', '失败时不能发送'), /resume failed/);
    assert.equal(calls.filter((call) => call.text).length, sendsBeforeFailure);
    assert.equal(sessions.size, 1);
  } finally { await fs.rm(root, { recursive:true, force:true }); }
});

test("sorts a switched channel by the latest assistant reply instead of the stale sidebar time", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-sidebar-sort-"));
  const rollout = path.join(root, "rollout.jsonl");
  await fs.writeFile(rollout, `${JSON.stringify({
    timestamp: "2026-09-23T02:45:20.909Z",
    type: "response_item",
    payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "done" }] },
  })}\n`, "utf8");
  const stale = {
    threadId: "original",
    cwd: root,
    title: "stale",
    updatedAt: "2026-09-22T16:48:01.000Z",
    source: "codex",
    archived: false,
  };
  const store = (providerId) => ({
    findSession: async () => stale,
    createSession: async () => stale,
    sendMessage: async () => {},
    updateModel: async () => ({ model: "gpt-6-astra" }),
    getSessionResumeInfo: async () => ({ path: rollout, cwd: root, model: "gpt-6-astra", summary: stale }),
    releaseSession: async () => {},
    resumeProviderSession: async () => {},
    getRuntimeContext: async () => ({ model: stale.updatedAt }),
    listSessions: async () => [],
    listModels: async () => [],
    close() {},
  });
  const providers = {
    resolveRoute: ({ model }) => ({ modelProviderId: String(model).startsWith("grok") ? "fusheng-grok" : "current", model }),
    getClient: async () => ({}),
    listModels: async (models) => models,
    isProviderConfigured: async () => true,
  };
  const service = createProviderConversationStore({
    current: store("current"),
    providers,
    createStore: () => store("fusheng-grok"),
    stateFile: path.join(root, "routes.json"),
  });
  try {
    await service.updateModel("original", "grok-4.6", { allowProviderSwitch: true });
    await service.sendMessage("original", "next");
    const [session] = await service.listSessions();
    assert.equal(session.threadId, "original");
    assert.equal(session.updatedAt, "2026-09-23T02:45:20.909Z");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("archives a local ghost conversation when the provider thread is gone", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-ghost-archive-"));
  const ghost = {
    threadId: "ghost",
    cwd: root,
    title: "新对话 · ghost",
    updatedAt: "2026-09-22T09:33:13.000Z",
    source: "codex",
    archived: false,
  };
  const store = () => ({
    createSession: async () => ghost,
    listSessions: async () => [],
    archiveSession: async () => { throw new Error("thread not loaded: ghost"); },
    unarchiveSession: async () => { throw new Error("session not found: ghost"); },
    listModels: async () => [],
    close() {},
  });
  const providers = {
    resolveRoute: ({ model }) => ({ modelProviderId: String(model).startsWith("grok") ? "fusheng-grok" : "current", model }),
    getClient: async () => ({}),
    listModels: async (models) => models,
    isProviderConfigured: async () => true,
  };
  const service = createProviderConversationStore({
    current: store(),
    providers,
    createStore: store,
    stateFile: path.join(root, "routes.json"),
  });
  try {
    await service.createSession("grok-4.7", root);
    assert.equal((await service.listSessions()).length, 1);
    await assert.rejects(service.archiveSession("missing"), /thread not loaded/);
    const archived = await service.archiveSession("ghost");
    assert.equal(archived.threadId, "ghost");
    assert.equal(archived.archived, true);
    assert.equal((await service.listSessions()).length, 0);
    const archivedList = await service.listSessions("all", true);
    assert.equal(archivedList.length, 1);
    assert.equal(archivedList[0].threadId, "ghost");
    const restored = await service.unarchiveSession("ghost");
    assert.equal(restored.archived, false);
    assert.equal((await service.listSessions()).length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
