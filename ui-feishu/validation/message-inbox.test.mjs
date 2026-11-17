import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMessageInbox } from '../kernel/message-inbox.mjs';
const until = async check => { const end = Date.now() + 2000; while (!check()) { if (Date.now() > end) assert.fail('condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

test('intake survives crash between message publication and task dispatch, preserving selected recipient', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-inbox-')); const stateFile = path.join(root, 'inbox.json');
  let messages = 0; let interrupted = true; const dispatched = [];
  const options = { stateFile, publish: async entry => { messages++; return { id: entry.id, text: 'hello' }; },
    dispatch: async (input, message, controls) => {
      if (!controls.routing) await controls.saveRouting({ agentIds: ['a'] });
      if (interrupted) return new Promise(() => {});
      dispatched.push({ id: message.id, routing: controls.routing }); return { jobId: 'job' };
    } };
  const inbox = await createMessageInbox(options);
  const result = await inbox.accept('idempotent-key', { text: 'hello' });
  await until(() => inbox.list()[0]?.routing);
  await inbox.close(); interrupted = false;
  const restored = await createMessageInbox(options);
  t.after(async () => { await restored.close(); await fs.rm(root, { recursive: true, force: true }); });
  await until(() => restored.list()[0]?.state === 'dispatched');
  const duplicate = await restored.accept('idempotent-key', { text: 'hello' });
  assert.equal(messages, 1); assert.equal(duplicate.message.id, result.message.id);
  assert.deepEqual(dispatched, [{ id: result.message.id, routing: { agentIds: ['a'] } }]);
});

test('dispatch failures remain visible and a retry uses the existing message', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-inbox-')); let attempts = 0; let published = 0; const failures = [];
  const inbox = await createMessageInbox({ stateFile: path.join(root, 'inbox.json'), publish: async () => { published++; return { id: 'message' }; },
    dispatch: async () => { if (++attempts === 1) throw Error('offline'); return { jobId: 'job' }; }, onError: (entry, error) => failures.push(error.message) });
  t.after(async () => { await inbox.close(); await fs.rm(root, { recursive: true, force: true }); });
  await inbox.accept('key', {}); await until(() => inbox.list()[0]?.state === 'failed');
  await inbox.accept('key', {}); await until(() => inbox.list()[0]?.state === 'dispatched');
  assert.equal(published, 1); assert.deepEqual(failures, ['offline']);
});
