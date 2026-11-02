import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProviderConversationStore } from "../server/provider-conversation-store.mjs";
import { createJsonlConversationStore } from "../server/jsonl-conversation-store.mjs";
import { createBackgroundTaskService } from '../server/background-tasks/service.mjs';

test('native child follows the registered parent provider without acquiring a route', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-native-child-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const child = { threadId: 'child', parentThreadId: 'parent', nativeSubagent: true, cwd: root, title: 'child', updatedAt: new Date().toISOString() };
  const store = provider => ({ listSessions: async () => provider === 'external' ? [child] : [],
    findSession: async id => { calls.push([provider, id]); return { ...child, messages: [] }; } });
  const service = createProviderConversationStore({ current: store('current'),
    providers: { getClient: async ({ modelProviderId }) => modelProviderId }, createStore: store,
    stateFile: path.join(root, 'routes.json') });
  await service.registerSession({ threadId: 'parent', cwd: root, title: 'parent' }, 'external', 'model');
  const sessions = await service.listSessions('all', false);
  assert.equal(sessions.find(session => session.threadId === 'child')?.nativeSubagent, true);
  assert.equal((await service.findSession('child')).modelProviderId, 'external');
  assert.deepEqual(calls, [['external', 'child']]);
});

test('current parent permits a single native child owner, but rejects mismatches and duplicate homes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-native-owner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const seen = [];
  const child = { threadId: 'child', parentThreadId: 'parent', nativeSubagent: true, cwd: root, title: 'native', updatedAt: new Date().toISOString() };
  const fork = { ...child, threadId: 'fork', nativeSubagent: false };
  let duplicate = false, otherChild = false;
  const store = provider => ({ listSessions: async () => provider === 'vip' ? [child, fork]
    : provider === 'other' && otherChild ? [child] : provider === 'current' && duplicate ? [child] : [],
  findSession: async id => { seen.push([provider, id]); return { ...child, messages: [] }; } });
  const service = createProviderConversationStore({ current: store('current'),
    providers: { getClient: async ({ modelProviderId }) => modelProviderId }, createStore: store,
    stateFile: path.join(root, 'routes.json') });
  await service.registerSession({ threadId: 'parent', cwd: root }, 'current', 'model');
  await service.registerSession({ threadId: 'known-vip', cwd: root }, 'vip', 'model');
  await service.registerSession({ threadId: 'known-other', cwd: root }, 'other', 'model');
  assert.equal((await service.listSessions('all', false)).find(item => item.threadId === 'child')?.modelProviderId, 'vip');
  assert.equal((await service.findSession('child')).modelProviderId, 'vip');
  assert.deepEqual(seen, [['vip', 'child']]);
  otherChild = true;
  assert.equal((await service.listSessions('all', false)).some(item => item.threadId === 'child'), false,
    'two concrete providers with the same native id must not be guessed');
  otherChild = false;
  duplicate = true;
  assert.equal((await service.listSessions('all', false)).some(item => item.threadId === 'child'), false,
    'a current-home duplicate is also ambiguous');
  assert.equal((await service.listSessions('all', false)).some(item => item.threadId === 'fork'), false);
  duplicate = false;
  await service.registerSession({ threadId: 'parent', cwd: root }, 'other', 'model');
  assert.equal((await service.listSessions('all', false)).some(item => item.threadId === 'child'), false,
    'an explicitly different parent provider is not a current-home exception');
});

test('native header restores a child omitted by thread/list in its actual provider', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-native-header-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessionRoot = path.join(root, 'provider', 'sessions');
  await fs.mkdir(sessionRoot, { recursive: true });
  const id = '01a19a65-c6ca-7840-863a-16aeeed2d88b';
  await fs.writeFile(path.join(sessionRoot, `rollout-${id}.jsonl`), JSON.stringify({ type: 'session_meta',
    payload: { id, cwd: root, source: { subagent: { thread_spawn: { parent_thread_id: 'parent', depth: 1 } } } } }) + '\n');
  const history = createJsonlConversationStore({ sessionRoot, projectRoot: root, registerMedia: () => null });
  t.after(() => history.close());
  const reads = [];
  const service = createProviderConversationStore({ current: { listSessions: async () => [] },
    providers: { getClient: async ({ modelProviderId }) => modelProviderId }, stateFile: path.join(root, 'routes.json'),
    createStore: provider => ({ listSessions: async () => [], listNativeSubagents: history.listNativeSubagents,
      findSession: async threadId => { reads.push([provider, threadId]); return { threadId, messages: [] }; } }) });
  await service.registerSession({ threadId: 'parent', cwd: root }, 'current', 'model');
  await service.registerSession({ threadId: 'known-provider', cwd: root }, 'isolated', 'model');
  const found = (await service.listSessions('all', false)).find(item => item.threadId === id);
  assert.equal(found?.nativeSubagent, true);
  assert.equal(found?.parentThreadId, 'parent');
  assert.equal(found?.modelProviderId, 'isolated');
  assert.equal((await service.findSession(id)).modelProviderId, 'isolated');
  assert.deepEqual(reads, [['isolated', id]]);
});

test("background task history and controls use its saved provider after reopening", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-task-provider-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const store = provider => ({
    findSession: async id => { calls.push([provider, 'history', id]); return { threadId: id, messages: [{ role: 'assistant', text: '5050' }] }; },
    getThreadStatus: async id => { calls.push([provider, 'status', id]); return { type: 'idle' }; },
    compactContext: async id => { calls.push([provider, 'compact', id]); return {}; },
  });
  const options = { current: store('current'), providers: { getClient: async ({ modelProviderId }) => modelProviderId },
    createStore: store, stateFile: path.join(root, 'routes.json'), providerForThread: id => id === 'task' ? 'external' : null };
  for (let i = 0; i < 2; i++) {
    const service = createProviderConversationStore(options);
    assert.equal((await service.findSession('task')).messages[0].text, '5050');
    await service.getThreadStatus('task');
    await service.compactContext('task');
    await service.findSession('ordinary');
  }
  assert.deepEqual(calls, Array(2).fill([['external', 'history', 'task'], ['external', 'status', 'task'], ['external', 'compact', 'task'], ['current', 'history', 'ordinary']]).flat());
});

test("employee history uses its explicit provider without changing ordinary thread routing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-employee-history-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const reads = [];
  const store = provider => ({ findSession: async (...args) => { reads.push([provider, ...args]); return { messages: [] }; } });
  const service = createProviderConversationStore({ current: store("current"),
    providers: { getClient: async ({ modelProviderId }) => modelProviderId },
    createStore: client => store(client), stateFile: path.join(root, "routes.json") });
  const page = { limit: 60, cursor: "older" };
  await service.findSessionForProvider("external", "employee-thread", "all", page);
  await service.findSession("ordinary-thread", "all", page);
  assert.deepEqual(reads, [["external", "employee-thread", "all", page], ["current", "ordinary-thread", "all", page]]);
});

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
    await service.renameSession("original", "手动标题");
    sessions.get("original").title = "过时的自动标题";
    assert.equal((await service.findSession("original")).title, "手动标题");
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
    assert.equal((await restored.findSession("original")).title, "手动标题");
    assert.equal((await restored.listSessions())[0].title, "手动标题");
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


test("failed sends keep the current choice but preserve the last completed settings across restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-choice-"));
  const stateFile = path.join(root, "routes.json");
  let model = "gpt-good", effort = "high", fail = false, sent;
  const source = {
    isFreshSession: () => true,
    getRuntimeContext: async () => ({ model, reasoningEffort: effort }),
    updateModel: async (_id, next) => ({ model: model = next, reasoningEffort: effort }),
    updateReasoningEffort: async (_id, next) => ({ model, reasoningEffort: effort = next }),
    sendMessage: async (_id, _text, _files, _submission, settings) => {
      sent = settings;
      if (fail) throw Error("provider unavailable");
      return { turn: { id: "turn-good" } };
    },
  };
  const options = { current: source, stateFile, providers: {
    resolveRoute: ({ model }) => ({ modelProviderId: "current", model }),
  } };
  try {
    const service = createProviderConversationStore(options);
    await service.updateModel("thread", "gpt-good");
    await service.updateReasoningEffort("thread", "high");
    assert.equal((await service.getRuntimeContext("thread")).lastSuccessfulSettings, null);
    await service.sendMessage("thread", "hello");
    assert.deepEqual(sent, { model: "gpt-good", reasoningEffort: "high" });
    // An accepted request alone is not a successful provider response.
    assert.equal((await service.getRuntimeContext("thread")).lastSuccessfulSettings, null);
    await service.handleProtocolMessage({ method: "turn/completed", params: {
      threadId: "thread", turn: { id: "turn-good", status: "completed" },
    } });
    await service.updateModel("thread", "gpt-bad");
    await service.updateReasoningEffort("thread", "low");
    fail = true;
    await assert.rejects(service.sendMessage("thread", "retry"), /unavailable/);
    const context = await service.getRuntimeContext("thread");
    assert.equal(context.model, "gpt-bad");
    assert.equal(context.reasoningEffort, "low");
    assert.deepEqual(context.lastSuccessfulSettings, { model: "gpt-good", reasoningEffort: "high" });
    const restarted = createProviderConversationStore(options);
    assert.deepEqual((await restarted.getRuntimeContext("thread")).lastSuccessfulSettings, context.lastSuccessfulSettings);
    fail = false;
    await restarted.sendMessage("thread", "async failure");
    await restarted.handleProtocolMessage({ method: "turn/completed", params: {
      threadId: "thread", turn: { id: "turn-good", status: "failed", error: { message: "401" } },
    } });
    assert.deepEqual((await restarted.getRuntimeContext("thread")).lastSuccessfulSettings, context.lastSuccessfulSettings);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("imports the previous successful model from history instead of the latest failed selection", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-choice-history-"));
  const rollout = path.join(root, "rollout.jsonl");
  try {
    await fs.writeFile(rollout, [
      { type: "turn_context", payload: { model: "good", effort: "high" } },
      { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer" } },
      { type: "turn_context", payload: { model: "bad", effort: "low" } },
      { type: "event_msg", payload: { type: "turn_aborted" } },
    ].map((entry) => JSON.stringify(entry)).join("\n"));
    const service = createProviderConversationStore({
      current: {
        getSessionResumeInfo: async () => ({ path: rollout }),
        getRuntimeContext: async () => ({ model: "bad", reasoningEffort: "low" }),
      },
      providers: {}, stateFile: path.join(root, "routes.json"),
    });
    assert.deepEqual((await service.getRuntimeContext("thread")).lastSuccessfulSettings, {
      model: "good", reasoningEffort: "high",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test("new chats and forks persist the same registration and reopen on their actual provider", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-registration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "routes.json"), reads = [];
  const source = {
    createSession: async (model, cwd) => ({ threadId: 'new', model, cwd, title: 'new' }),
    forkSession: async () => ({ threadId: 'fork', model: 'original-model', cwd: root, title: 'branch' }),
    findSession: async id => { reads.push(id); return { threadId: id, messages: [] }; },
  };
  const options = { stateFile, current: { findSession: () => { throw Error('wrong provider'); } },
    providers: { resolveRoute: () => ({ modelProviderId: 'external', model: 'original-model' }), getClient: async () => ({}) },
    createStore: () => source };
  const service = createProviderConversationStore(options);
  await service.createSession('original-model', root);
  const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  saved.new.pendingProviderId = 'other'; saved.new.model = 'other::pending-model';
  await fs.writeFile(stateFile, JSON.stringify(saved));
  await createProviderConversationStore(options).forkSession('new', 'completed-turn');
  const records = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  for (const id of ['new', 'fork']) {
    assert.equal(records[id].providerId, 'external');
    assert.equal(records[id].createdBy, 'user');
    assert.equal(records[id].summary.cwd, root);
    assert.equal(records[id].summary.threadId, id);
  }
  assert.equal(records.fork.model, 'external::original-model');
  assert.equal(records.fork.summary.forkedFromId, 'new');
  assert.equal(records.fork.pendingProviderId, undefined);
  const reopened = createProviderConversationStore(options);
  assert.equal((await reopened.findSession('fork')).modelProviderId, 'external');
  assert.deepEqual(reads, ['fork']);
});

test('assistant background creation records the actual provider, model and effort', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-assistant-registration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'routes.json');
  const service = createProviderConversationStore({ stateFile, current: {},
    providers: { resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }), getClient: async () => ({}) },
    createStore: () => ({ createSession: async (model, cwd) => ({ threadId: 'background', model, cwd, title: 'task' }) }) });
  await service.createSession('model', root, 'external', { createdBy: 'assistant', reasoningEffort: 'high' });
  const route = JSON.parse(await fs.readFile(stateFile, 'utf8')).background;
  assert.equal(route.providerId, 'external'); assert.equal(route.model, 'external::model');
  assert.equal(route.createdBy, 'assistant'); assert.equal(route.reasoningEffort, 'high');
  assert.equal(route.summary.threadId, 'background');
});

test('legacy background task requests assistant registration with its chosen effort', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-legacy-background-'));
  const calls = [];
  const employee = { id: 'employee', name: 'employee', projectRoot: root, mainThreadId: 'parent', model: 'model', modelProviderId: 'provider', reasoningEffort: 'high' };
  const service = await createBackgroundTaskService({ stateFile: path.join(root, 'tasks.json'),
    registry: { list: () => [employee], require: () => employee },
    conversations: { createSession: async (...args) => { calls.push(args); return { threadId: 'child' }; },
      renameSession: async () => {}, sendMessage: async () => {} },
    bindings: { bindRuntime: async binding => binding }, queue: { enqueue: async () => ({}) },
    execution: { getStatus: () => ({ active: true, turnId: 'turn' }) } });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  await service.create('employee', { title: 'task', instructions: 'work' });
  for (let i = 0; i < 100 && !calls.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'provider');
  assert.equal(calls[0][3].createdBy, 'assistant');
  assert.equal(calls[0][3].reasoningEffort, 'high');
  const task = service.list('employee')[0];
  assert.deepEqual(service.actorFor('child', `task-${task.id}`), { id: 'employee', name: 'employee' });
  assert.equal(service.actorFor('child', 'human-submission'), null);
});

test('existing background registration repairs only the verified route without starting or resending', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-register-existing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'history.jsonl');
  await fs.writeFile(file, JSON.stringify({ type: 'turn_context', payload: { model: 'actual', effort: 'low' } }) + '\n');
  const calls = [];
  let duringRead = () => {};
  const service = createProviderConversationStore({ current: {},
    providers: { getClient: async ({ modelProviderId }) => modelProviderId },
    createStore: provider => ({ getSessionResumeInfo: async (threadId, options) => {
      calls.push([provider, threadId, options]); await duringRead();
      return { path: file, cwd: root, model: 'old', summary: { threadId, cwd: root, title: 'existing' } };
    } }), stateFile: path.join(root, 'routes.json') });
  await service.registerSession({ threadId: 'known', cwd: root }, 'current', 'old', { manualTitle: '保留标题' });
  const repaired = await service.registerExistingBackground({ threadId: 'known', providerId: 'vip', expectedProviderId: 'current' });
  assert.equal(repaired.createdBy, 'assistant'); assert.equal(repaired.modelProviderId, 'vip');
  assert.equal(repaired.model, 'vip::actual'); assert.equal(repaired.title, '保留标题');
  const saved = JSON.parse(await fs.readFile(path.join(root, 'routes.json'), 'utf8'));
  assert.equal(saved.known.reasoningEffort, 'low');
  assert.deepEqual(calls, [['vip', 'known', { readOnly: true }]]);
  await assert.rejects(service.registerExistingBackground({ threadId: 'known', providerId: 'other', expectedProviderId: 'vip' }), /供应商已变化/);
  await assert.rejects(service.registerExistingBackground({ threadId: 'known', providerId: 'vip', expectedProviderId: 'current' }), /供应商已变化/);
  assert.equal((await service.registerExistingBackground({ threadId: 'missing', providerId: 'deepseek' })).modelProviderId, 'deepseek');
  duringRead = () => service.registerSession({ threadId: 'racing', cwd: root }, 'other', 'new');
  await assert.rejects(service.registerExistingBackground({ threadId: 'racing', providerId: 'vip' }), /已变化/);
  assert.equal(await service.getRecordedProviderForThread('racing'), 'other');
});

test('persisted pending switch between aliases sends through the original store without releasing its writer', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-writer-alias-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'routes.json');
  await fs.writeFile(stateFile, JSON.stringify({ thread: { providerId: 'alias', pendingProviderId: 'current',
    model: 'model', runtimeModel: 'model', lastSuccessfulSettings: null } }));
  const client = {};
  const sent = [];
  const current = {
    getRuntimeContext: async () => ({ model: 'model' }),
    getSessionResumeInfo: async () => ({ path: path.join(root, 'rollout.jsonl'), cwd: root, model: 'model' }),
    releaseSession: async () => { throw new Error('must preserve existing writer'); },
    resumeProviderSession: async () => { throw new Error('must not reacquire writer'); },
    sendMessage: async (id, text) => { sent.push([id, text]); return { turn: { id: 'turn' } }; },
  };
  const service = createProviderConversationStore({ current, stateFile,
    providers: { getClient: async () => client, resolveRoute: ({ model }) => ({ modelProviderId: 'current', model }) },
    createStore: () => { throw new Error('duplicate event subscription'); },
  });
  await service.sendMessage('thread', 'continue');
  assert.deepEqual(sent, [['thread', 'continue']]);
  const route = JSON.parse(await fs.readFile(stateFile, 'utf8')).thread;
  assert.equal(route.providerId, 'current');
  assert.equal(route.pendingProviderId, undefined);
});
