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
  await fs.writeFile(file, '{}\n');
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
  const provider = createProviderConversationStore({ current: native, providers: {}, stateFile });
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
  const before = calls.filter(method => method === 'thread/read').length;
  const bodiesBefore = fallbackCalls.filter(options => !options.metadataOnly).length;
  const reused = await get(`&sourceRevision=${encodeURIComponent(first.sourceRevision)}`);
  assert.equal(reused.session, null);
  assert.equal(fallbackCalls.filter(options => !options.metadataOnly).length, bodiesBefore);
  if (loaded) assert.equal(calls.filter(method => method === 'thread/read').length, before);
  assert.ok(calls.includes('thread/read')); assert.equal(calls.filter(method => method === 'thread/goal/get').length, 2);
  assert.ok(calls.every(method => ['thread/read', 'thread/goal/get'].includes(method)), JSON.stringify(calls));
  if (!loaded) assert.ok(fallbackCalls.some(options => options.metadataOnly));
  console.log(JSON.stringify({ loaded, protocol: calls, threadReadsBeforeReuse: before, fallbackReads: fallbackCalls.length }));
});
