import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAppServerConversationStore } from '../server/app-server-conversation-store.mjs';
import { createJsonlConversationStore } from '../server/jsonl-conversation-store.mjs';
import { createConversationService } from '../server/conversation-service.mjs';

test('native list asks for all subagent sources and labels only native source, not fork parent', async () => {
  const root = process.cwd();
  const seen = [];
  const store = createAppServerConversationStore({ projectRoot: root, autoTitleEnabled: false,
    client: { subscribe: () => () => {}, close() {}, request: async (method, params) => {
      assert.equal(method, 'thread/list'); seen.push(params.sourceKinds);
      return { data: [
        { id: 'native', cwd: root, updatedAt: 1, source: { subAgent: { thread_spawn: { parent_thread_id: 'parent', depth: 1 } } } },
        { id: 'fork', cwd: root, updatedAt: 1, source: 'appServer', parentThreadId: 'parent' },
      ] };
    } },
  });
  try {
    const sessions = await store.listSessions();
    assert.equal(sessions.find(item => item.threadId === 'native').nativeSubagent, true);
    assert.equal(sessions.find(item => item.threadId === 'native').parentThreadId, 'parent');
    assert.equal(sessions.find(item => item.threadId === 'fork').nativeSubagent, false);
    assert.ok(['subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'appServer'].every(kind => seen[0].includes(kind)));
  } finally { store.close(); }
});

test('supplemental messages prevent reuse of an incomplete history-file revision', async () => {
  let extra = [];
  const service = createConversationService({ primary: { getSourceRevision: async () => 'r1' }, fallback: {},
    supplementalMessages: { list: async () => extra } });
  assert.equal(await service.getSourceRevision('t1'), 'r1');
  extra = [{ id: 'image-result' }];
  assert.equal(await service.getSourceRevision('t1'), null);
});

test('unchanged list reuses preview; Desktop writes invalidate revision without changing message time', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-source-revision-'));
  const id = '00000000-0000-4000-8000-000000000001';
  const file = path.join(root, `rollout-${id}.jsonl`);
  const timestamp = '2026-11-01T00:00:00Z';
  await fs.writeFile(file, [
    { type: 'session_meta', payload: { id, cwd: root } },
    { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] } },
  ].map(JSON.stringify).join('\n') + '\n');
  const thread = { id, cwd: root, path: file, updatedAt: Date.parse(timestamp) / 1000 };
  const calls = [];
  const store = createAppServerConversationStore({ projectRoot: root, autoTitleEnabled: false,
    client: { subscribe: () => () => {}, close() {}, request: async method => {
      calls.push(method); assert.equal(method, 'thread/list'); return { data: [thread] };
    } },
  });
  const history = createJsonlConversationStore({ sessionRoot: root, projectRoot: root, registerMedia: () => null });
  const originalOpen = fs.open;
  let reads = 0;
  fs.open = async (...args) => { if (args[0] === file) reads++; return originalOpen(...args); };
  try {
    const [first] = await store.listSessions();
    const initialReads = reads;
    assert.ok(first.sourceRevision);
    const [unchanged] = await store.listSessions();
    assert.equal(unchanged.sourceRevision, first.sourceRevision);
    assert.equal(reads, initialReads, 'unchanged history must not be opened again');
    await fs.appendFile(file, JSON.stringify({ type: 'turn_context', payload: { model: 'new-model', effort: 'high' } }) + '\n');
    const [changed] = await store.listSessions();
    assert.notEqual(changed.sourceRevision, first.sourceRevision);
    assert.equal(changed.updatedAt, first.updatedAt, 'a non-message write still changes the revision');
    assert.ok(reads > initialReads);
    assert.equal((await history.findSession(id)).sourceRevision, changed.sourceRevision);
    assert.ok(calls.every(method => method === 'thread/list'), 'listing must never resume or read native turns');
  } finally {
    fs.open = originalOpen;
    store.close(); history.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
