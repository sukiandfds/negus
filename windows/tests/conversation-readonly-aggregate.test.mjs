import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createAppServerConversationStore } from '../server/app-server-conversation-store.mjs';
import { createProviderConversationStore } from '../server/provider-conversation-store.mjs';
import { createConversationService } from '../server/conversation-service.mjs';
import { createContextManagementService } from '../server/context-management-service.mjs';
import { createConversationRoutes } from '../server/routes/conversation-routes.mjs';

for (const loaded of [true, false]) test(`aggregate read does not start work for ${loaded ? 'loaded' : 'unloaded'} thread`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-readonly-aggregate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'sessions', 'history.jsonl');
  await fs.mkdir(path.dirname(file));
  // FEAT-001 后当前设置从 rollout 记录读：文件里要有一条真实形状的 turn_context（带 model），不能只放占位行。
  await fs.writeFile(file, '{}\n' + JSON.stringify({ timestamp: '2026-09-22T05:47:00.000Z', type: 'turn_context', payload: { model: 'model-a', effort: 'high' } }) + '\n');
  const thread = { id: 't1', cwd: root, path: file, model: 'model-a', reasoningEffort: 'high', updatedAt: 1,
    turns: [{ id: 'turn-1', items: [{ id: 'm1', type: 'agentMessage', text: 'answer' }] }] };
  const calls = [], fallbackCalls = [];
  const client = { subscribe: () => () => {}, close() {}, getPendingUserInput: () => null,
    request: async method => {
      calls.push(method);
      if (method === 'thread/read') { if (!loaded) throw Error('thread not loaded'); return { thread }; }
      if (method === 'thread/goal/get') { if (!loaded) throw Error('thread not loaded'); return { goal: null }; }
      throw Error(`unexpected protocol call: ${method}`);
    } };
  const fallback = async (_id, _source, options) => {
    fallbackCalls.push(options);
    return options.metadataOnly ? thread : { threadId: 't1', cwd: root, messages: [{ id: 'fallback', role: 'assistant', text: 'answer' }] };
  };
  const native = createAppServerConversationStore({ projectRoot: root, client, autoTitleEnabled: false, registerMedia: () => null, historyFallback: fallback });
  const stateFile = path.join(root, 'routes.json');
  await fs.writeFile(stateFile, JSON.stringify({ t1: { providerId: 'current', resumeInfo: { path: file, cwd: root } } }));
  // FEAT-001 后 provider store 的只读路径经 historyFor 走历史 store（生产接线 remote-room-demo / existing-projects 均必传），
  // 本测试用 fallback 充当历史 store，按同样的形状补齐 historyFor。
  const historyFor = async () => ({
    findSession: (id, source, options) => fallback(id, source, options),
    getSessionResumeInfo: async (id, options) => fallback(id, 'all', { ...options, metadataOnly: true }),
    listSessions: async () => [],
    listNativeSubagents: async () => [],
  });
  const provider = createProviderConversationStore({ current: native, providers: {}, historyFor, stateFile });
  const conversations = createConversationService({ primary: provider, fallback: { findSession: fallback } });
  const context = await createContextManagementService({ stateFile: path.join(root, 'context.json'), broadcast: () => {},
    getExecutionStatus: () => ({ active: false }), getRuntimeContext: provider.getRuntimeContext,
    compactContext: () => assert.fail('read must not compact') });
  t.after(async () => { await context.close(); provider.close(); });
  const route = createConversationRoutes({ conversations, contextManagement: context,
    execution: { getStatus: () => ({ active: false }) }, followUpQueue: { list: () => [] } });
  const get = async suffix => {
    const request = Readable.from([]); request.method = 'GET';
    const response = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    await route(request, response, new URL(`http://localhost/api/session?threadId=t1&view=1${suffix}`));
    assert.equal(response.status, 200); return JSON.parse(response.body);
  };
  const first = await get('');
  assert.ok(first.session.messages.length); assert.equal(first.context.model, 'model-a'); assert.equal(first.goal, null);
  assert.ok(first.sourceRevision);
  const bodiesBefore = fallbackCalls.filter(options => !options.metadataOnly).length;
  const reused = await get(`&sourceRevision=${encodeURIComponent(first.sourceRevision)}`);
  assert.equal(reused.session, null);
  assert.equal(fallbackCalls.filter(options => !options.metadataOnly).length, bodiesBefore);
  // FEAT-001：聚合读全部走历史 store，不发任何协议请求（thread/read、thread/goal/get 都不许出现），
  // 这正是"读不启动工作"的现行实现；目标从持久化文件读，不经协议。
  assert.deepEqual(calls, [], JSON.stringify(calls));
  assert.ok(fallbackCalls.some(options => options.metadataOnly));
  console.log(JSON.stringify({ loaded, protocol: calls, fallbackReads: fallbackCalls.length }));
});
