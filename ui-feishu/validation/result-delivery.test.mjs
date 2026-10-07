import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extendEmployeeTasks } from '../server/employee-task-extension.mjs';
import { createFollowUpQueueService } from '../../windows/server/follow-up-queue-service.mjs';

const until = async check => {
  const end = Date.now() + 1500;
  while (!check()) { if (Date.now() > end) assert.fail('condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
async function fixture(t, initialPhase = 'completed', failSend = false, parentState) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-result-delivery-'));
  const task = { id: 'child', kind: 'delegation', agentId: 'b', conversationId: 'child-conversation',
    title: '调研', state: 'completed', result: '调研结果', runtime: { threadId: 'child-thread', turnId: 'child-turn' },
    source: { threadId: 'main', agentId: 'a', conversationId: 'direct-a' }, suppressContinuation: true };
  const tasks = [task];
  if (parentState) { task.parentTaskId = 'parent'; tasks.push({ id: 'parent', kind: 'external', state: parentState, runtime: { threadId: 'main', turnId: 'main-turn' } }); }
  await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify({ version: 1, tasks, deliveries: [{ id: 'result:child', taskId: 'child', state: 'pending', attempts: 0 }] }));
  const f = { phase: initialPhase, failSend, sent: [], turns: [] };
  const execution = { getStatus: () => ({ active: f.phase === 'working', phase: f.phase, turnId: 'main-turn' }) };
  const queue = createFollowUpQueueService({ stateFile: path.join(root, 'queue.json'), execution,
    conversations: { sendMessage: async (_threadId, text) => { f.sent.push(text); if (f.failSend) throw Error('供应商不可用');
      f.turns.push({ id: `notification-${f.sent.length}`, items: [{ type: 'userMessage', content: [{ type: 'inputText', text }] }] }); } },
    media: { resolveMany: () => [] }, publishThreadEvent: () => {},
  });
  const employees = [{ id: 'a', name: '助手', mainThreadId: 'main' }, { id: 'b', name: '研究员' }];
  const original = { ownsThread: () => false, list: () => [], directoryEntries: () => [], runtimeOptions: () => null, hasPendingWork: () => false, close: async () => {} };
  const extension = await extendEmployeeTasks(original, { stateRoot: root,
    registry: { list: () => employees, require: id => employees.find(employee => employee.id === id) },
    appServerClient: { request: async method => { assert.equal(method, 'thread/read'); return { thread: { turns: f.turns } }; } },
    bindings: {}, execution, queue,
  });
  t.after(async () => { await extension.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  return Object.assign(f, { extension, queue, delivery: () => extension.deliveries()[0] });
}

test('retry result retries the failed underlying queue and acknowledges native history', async t => {
  const f = await fixture(t, 'completed', true);
  await until(() => f.delivery().state === 'failed');
  assert.equal(f.sent.length, 1);
  const queueId = f.queue.list('main')[0].id;
  f.failSend = false;
  await f.extension.retryDelivery('result:child');
  await until(() => f.delivery().state === 'delivered');
  assert.equal(f.sent.length, 2);
  assert.equal(f.queue.list('main').length, 0);
  assert.equal(f.delivery().receipt.queueId, queueId);
  await f.extension.retryDelivery('result:child');
  assert.equal(f.sent.length, 2, 'retrying an acknowledged result must not resend');
});

for (const phase of ['interrupted', 'failed', 'systemError']) test(`source ${phase} exposes undelivered result and only explicit retry resumes delivery`, async t => {
  const f = await fixture(t, phase);
  await until(() => f.delivery().state === 'failed');
  assert.equal(f.sent.length, 0);
  assert.equal(f.queue.list('main').length, 0);
  await f.extension.retryDelivery('result:child');
  await until(() => f.delivery().state === 'delivered');
  assert.equal(f.sent.length, 1);
});

test('source stopping while result waits also exposes retry instead of hanging', async t => {
  const f = await fixture(t, 'working');
  await until(() => f.queue.list('main').length === 1);
  f.phase = 'interrupted';
  await until(() => f.delivery().state === 'failed');
  assert.equal(f.sent.length, 0);
});

test('retry confirms an ambiguously delivered result without sending it twice', async t => {
  const f = await fixture(t, 'completed', true);
  await until(() => f.delivery().state === 'failed');
  f.turns.push({ id: 'already-accepted', items: [{ type: 'userMessage', content: [{ type: 'inputText', text: f.sent[0] }] }] });
  f.failSend = false;
  await f.extension.retryDelivery('result:child');
  await until(() => f.delivery().state === 'delivered');
  assert.equal(f.sent.length, 1);
  assert.equal(f.delivery().receipt.acknowledged, true);
});

test('persisted stopped source remains blocked even when its visible status has reset to idle', async t => {
  const f = await fixture(t, 'idle', false, 'interrupted');
  await until(() => f.delivery().state === 'failed');
  assert.equal(f.sent.length, 0);
  await f.extension.retryDelivery('result:child');
  await until(() => f.delivery().state === 'delivered');
  assert.equal(f.sent.length, 1);
});
