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
