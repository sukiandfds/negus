import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { zstdCompressSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createJsonlConversationStore } from '../server/jsonl-conversation-store.mjs';
import { createProviderConversationStore } from '../server/provider-conversation-store.mjs';
import { createConversationService } from '../server/conversation-service.mjs';
import { createSystemRoutes } from '../server/routes/system-routes.mjs';
import { createConversationRoutes } from '../server/routes/conversation-routes.mjs';
import { createContextManagementService } from '../server/context-management-service.mjs';
import { createAppServerConversationStore } from '../server/app-server-conversation-store.mjs';
import { createModelProviderService } from '../server/model-provider-service.mjs';
import { createExecutionTracker } from '../server/execution-tracker.mjs';

export const createHistoryFixture = async ({ legacySuccess = false, failedFinal = false } = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-history-isolated-'));
  const home = path.join(root, 'old-home'), sessions = path.join(home, 'sessions'), legacy = path.join(root, 'legacy', 'sessions');
  await fs.mkdir(sessions, { recursive: true }); await fs.mkdir(legacy, { recursive: true });
  const id = '00000000-0000-4000-8000-000000000020';
  const stamp = n => new Date(Date.UTC(2026, 10, 20, 0, 0, n)).toISOString();
  const meta = (threadId = id, cwd = root, extra = {}) => ({ type: 'session_meta', payload: { id: threadId, cwd, ...extra } });
  const expected = [];
  const records = (first, last) => Array.from({ length: last - first }, (_, offset) => {
    const n = first + offset, turn = `turn-${n}`, time = stamp(n * 3);
    const message = role => ({ timestamp: time, type: 'response_item', payload: { type: 'message', role, id: `${role}-${n}`,
      ...(role === 'assistant' ? { phase: 'final_answer' } : {}), internal_chat_message_metadata_passthrough: { turn_id: turn },
      content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: `${role} history ${n}` },
        ...(n === 47 && role === 'user' ? [{ type: 'input_image', image_url: 'https://example.invalid/fixture.png' }] : [])] } });
    const user = message('user'), assistant = message('assistant');
    expected.push(...[user, assistant].map(r => ({ id: `codex:${turn}:${r.payload.id}`, text: r.payload.content[0].text,
      role: r.payload.role, createdAt: r.timestamp, itemId: r.payload.id })));
    return [{ type: 'event_msg', payload: { type: 'task_started', turn_id: turn } },
      { type: 'turn_context', payload: { model: 'model-a', effort: 'high' } }, user, assistant, { timestamp: time, type: 'event_msg', payload: { type: 'agent_message', phase: 'final_answer', message: `assistant history ${n}` } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: turn } }];
  }).flat();
  const encode = rows => rows.map(JSON.stringify).join('\n') + '\n';
  const original = path.join(legacy, `rollout-${id}.jsonl`);
  const first = records(0, 30), tail = records(30, 48);
  await fs.writeFile(original, encode([meta(), ...first]));
  const file = path.join(sessions, `rollout-${id}_continuation.jsonl`);
  await fs.writeFile(file, encode([meta(), { type: 'compacted', payload: { message: 'compressed context', replacement_history: [] } }, ...tail,
    { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 123 }, model_context_window: 1000 } } }]));
  await fs.writeFile(path.join(sessions, 'packed.jsonl.zst'), zstdCompressSync(Buffer.from(encode([meta('packed'), ...tail]))));
  await fs.writeFile(path.join(sessions, 'fork.jsonl'), encode([meta('fork', root, { forked_from_id: id }), ...first.slice(0, 12)]));
  await fs.writeFile(path.join(sessions, 'empty.jsonl'), encode([meta('empty')]));
  await fs.writeFile(path.join(sessions, 'broken.jsonl'), encode([meta('broken')]) + '{bad json}\n');
  const forbidden = path.join(root, 'forbidden.jsonl');
  await fs.writeFile(forbidden, encode([meta('forbidden', path.join(root, 'other-project')), ...tail]));
  const db = new DatabaseSync(path.join(home, 'goals_1.sqlite'));
  db.exec('CREATE TABLE thread_goals(thread_id TEXT, objective TEXT, status TEXT, token_budget INTEGER, tokens_used INTEGER, time_used_seconds INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER)');
  db.prepare('INSERT INTO thread_goals VALUES(?,?,?,?,?,?,?,?)').run(id, 'fixture goal', 'paused', 1000, 123, 2, 1, 2); db.close();
  const stateFile = path.join(root, 'routes.json');
  const routeFor = threadId => ({ providerId: 'ccswitch_removed', model: 'ccswitch_removed::model-a', summary: { threadId, cwd: root, source: 'codex', title: `fixture ${threadId}` },
    ...(legacySuccess ? {} : { lastSuccessfulSettings: { model: 'ccswitch_removed::model-a', reasoningEffort: 'high', providerName: '已删除配置A', modelProviderId: 'ccswitch_removed' } }) });
  await fs.writeFile(stateFile, JSON.stringify(Object.fromEntries([id, 'packed', 'fork', 'empty', 'broken', 'forbidden'].map(threadId => [threadId,
    { ...routeFor(threadId), ...(threadId === 'forbidden' ? { resumeInfo: { path: forbidden, cwd: root } } : {}) }]))));
  if (legacySuccess) {
    const configRoot = path.join(root, 'model-providers', 'ccswitch_removed', 'codex-home');
    await fs.mkdir(configRoot, { recursive: true });
    await fs.writeFile(path.join(configRoot, 'config.toml'), '[model_providers.ccswitch_removed]\nname = "已删除配置A"\n');
    await fs.writeFile(path.join(sessions, `rollout-2026-11-21T00-00-00-${id}_failed.jsonl`), encode([
      { ...meta(), timestamp: '2026-11-21T00:00:00Z' }, { type: 'compacted', payload: { message: 'compacted' } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'failed-b' } },
      { type: 'turn_context', payload: { model: 'model-b', effort: 'low', turn_id: 'failed-b' } },
      ...(failedFinal ? [{ type: 'response_item', timestamp: '2026-11-21T00:00:01Z', payload: { type: 'message', role: 'assistant', id: 'failed-b-reply', phase: 'final_answer', content: [{ type: 'output_text', text: 'B final before aborted' }] } }] : []),
      { type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'failed-b' } },
    ]));
  }
  const modelCalls = { credentials: 0, currentConfig: 0, rpc: 0, initialization: 0, wake: 0 };
  let catalogRoute, catalogStore, catalogProviders, systemRoute;
  const modelsRoute = () => {
    if (catalogRoute) return catalogRoute;
    let initialized = false;
    const client = { subscribe: () => () => {}, close() {}, request: async method => {
      if (!initialized) { initialized = true; modelCalls.initialization++; modelCalls.wake++; }
      modelCalls.rpc++; if (method !== 'model/list') throw new Error(`unexpected RPC ${method}`);
      return { data: [], nextCursor: null };
    } };
    const native = createAppServerConversationStore({ projectRoot: root, client, autoTitleEnabled: false });
    catalogProviders = createModelProviderService({ projectRoot: root, defaultCodexHome: home, defaultClient: client,
      providers: [{ id: 'current', mode: 'current', displayName: '当前配置' }],
      currentApiConfiguration: async () => { modelCalls.currentConfig++; return null; },
      credentialStore: { isConfigured: async () => { modelCalls.credentials++; return controls.configured; } },
      sharedConfig: { list: async () => controls.configured ? ['removed', 'second'].map(id => ({ id, name: id === 'removed' ? '配置A' : '配置C', model: 'model-a', configured: true, switchable: true })) : [], runtimeProviders: async () => controls.configured ? ['removed', 'second'].map(id => ({ id: `ccswitch_${id}`, displayName: id === 'removed' ? '配置A' : '配置C',
        models: ['a', 'b'].map(x => ({ id: `model-${x}`, model: `model-${x}`, displayName: `模型${x.toUpperCase()}`, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] })) })) : [],
        readCredential: async () => { modelCalls.credentials++; if (!controls.configured) throw new Error('missing fixture credentials'); return 'fixture-only'; } },
    });
    catalogStore = createProviderConversationStore({ current: native, providers: catalogProviders, stateFile: path.join(root, 'catalog-routes.json') });
    catalogRoute = createConversationRoutes({ conversations: catalogStore, modelProviders: catalogProviders });
    return catalogRoute;
  };
  const settingsRoute = () => {
    systemRoute ||= createSystemRoutes({ projectRoot: root, modelProviders: new Proxy({}, {
      get: (_target, key) => { if (key === 'sharedConfig') return { list: (...args) => { modelsRoute(); return catalogProviders.sharedConfig.list(...args); } }; modelsRoute(); const value = catalogProviders[key]; return typeof value === 'function' ? value.bind(catalogProviders) : value; },
    }) });
    return systemRoute;
  };
  const calls = { client: 0, credentials: 0, refresh: 0, sends: 0, resumes: 0, body: 0 };
  const controls = { configured: false, contextDelay: 0, goalDelay: 0, bodyDelay: 0, revisionDelay: 0, revisionReads: 0, goalFail: false, sendFail: false };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const history = createJsonlConversationStore({ sessionRoot: sessions, fallbackSessionRoots: [legacy], projectRoot: root,
    registerMedia: file => ({ id: path.basename(file), url: '/api/media/fixture' }), onChange() {} });
  const execution = createExecutionTracker({ broadcast() {} });
  const sender = { getSessionResumeInfo: async threadId => history.findSession(threadId, 'all', { metadataOnly: true }),
    getRuntimeContext: async () => ({ model: 'model-a', reasoningEffort: 'high' }),
    updateReasoningEffort: async (_id, reasoningEffort) => ({ reasoningEffort }),
    updateModel: async (_id, model, options) => ({ model, reasoningEffort: options.reasoningEffort }),
    resumeProviderSession: async () => { calls.resumes++; },
    sendMessage: async () => { calls.sends++; if (controls.sendFail) throw new Error('fixture 402'); return { turn: { id: 'successful-turn' } }; },
    steerMessage: async (...args) => controls.steer(...args),
    getPendingUserInput: async () => null, close() {} };
  const providers = {
    refreshShared: async () => { calls.refresh++; }, providers: () => controls.configured ? [{ id: 'ccswitch_removed', displayName: '配置A' }] : [],
    resolveRoute: ({ model, modelProviderId }) => ({ model: model.split('::').at(-1), modelProviderId: modelProviderId || 'ccswitch_removed' }),
    isProviderConfigured: async () => { calls.credentials++; return controls.configured; },
    getClient: async () => { calls.client++; if (!controls.configured) throw new Error('credentials must not be read'); return {}; },
  };
  const primary = createProviderConversationStore({ current: sender, providers, stateFile, createStore: () => sender,
    historyFor: () => ({ ...history, findSession: async (...args) => { calls.body++; if (controls.bodyDelay) await delay(controls.bodyDelay); return history.findSession(...args); },
      getSessionResumeInfo: (threadId, options) => history.findSession(threadId, 'all', { ...options, metadataOnly: true }) }) });
  const conversations = createConversationService({ primary, fallback: history });
  const originalRevision = conversations.getSourceRevision;
  conversations.getSourceRevision = async (...args) => { if (controls.revisionDelay) await delay(controls.revisionDelay); const value = await originalRevision(...args); controls.revisionReads++; return value; };
  const originalGoal = conversations.getGoal;
  conversations.getGoal = async (...args) => { if (controls.goalDelay) await delay(controls.goalDelay); if (controls.goalFail) throw new Error('fixture goal disk failure'); return originalGoal(...args); };
  const context = await createContextManagementService({ stateFile: path.join(root, 'context.json'), broadcast() {},
    getExecutionStatus: execution.getStatus, compactContext: async () => {}, getRuntimeContext: async threadId => {
      if (controls.contextDelay) await delay(controls.contextDelay); return conversations.getRuntimeContext(threadId);
    } });
  const route = createConversationRoutes({ conversations, execution, contextManagement: context, followUpQueue: { list: () => [] },
    media: { resolveMany: ids => (ids || []).map(id => ({ id, name: 'fixture.png', mimeType: 'image/png', path: '/fixture.png', url: '/api/media/photo' })), get: () => ({ id: 'photo', name: 'fixture.png', mimeType: 'image/png', path: '/fixture.png', url: '/api/media/photo' }) },
    agentTasks: { decorateConversationSession: (_id, session) => session && ({ ...session, messages: session.messages.map(m => ({ ...m, authorName: m.role === 'assistant' ? '原助手' : '用户' })) }) } });
  const server = http.createServer(async (req, res) => {
    try { const url = new URL(req.url, 'http://fixture'); if (!await (url.pathname.startsWith('/api/model-defaults') || url.pathname.startsWith('/api/model-channels') ? settingsRoute() : url.pathname === '/api/models' ? modelsRoute() : route)(req, res, url)) { res.writeHead(404); res.end('{}'); } }
    catch (error) { res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (pathname, body) => {
    const response = await fetch(base + pathname, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: response.status, value: await response.json() };
  };
  return { root, id, file, original, history, modelCalls, calls, controls, expected, primary, conversations, execution, request, base,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); conversations.close(); catalogStore?.close(); catalogProviders?.close(); await execution.close(); await context.close(); await fs.rm(root, { recursive: true, force: true }); } };
};
