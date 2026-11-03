import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExecutionTracker } from '../server/execution-tracker.mjs';
import { mergeMessageList, ConversationStore } from './frontend-conversation-store.mjs';
const msg = (id, at, extra = {}) => ({ id, role: 'assistant', text: id, createdAt: `2026-11-03T10:${at}Z`, ...extra });
test('display timestamps win over native turn index and turn grouping, including replay', () => {
 const messages = [msg('late', '04:00', { turnId: 'a', turnItemIndex: 0, turnStartedAtMs: 1 }),
  msg('middle', '03:00', { role: 'user', turnId: 'b', turnStartedAtMs: 2 }),
  msg('early', '02:00', { turnId: 'a', turnItemIndex: 1, turnStartedAtMs: 1 })];
 assert.deepEqual(mergeMessageList([], messages).map(x => x.id), ['early', 'middle', 'late']);
 assert.deepEqual(mergeMessageList([], messages.reverse()).map(x => x.id), ['early', 'middle', 'late']);
});
test('optimistic confirmation adjusts once and stale history cannot undo authoritative time', () => {
 const optimistic = msg('optimistic-s', '02:00', { role: 'user', submissionId: 's' });
 const confirmed = { ...optimistic, createdAt: '2026-11-03T10:06:00Z', serverTimestamp: true };
 const formal = { ...optimistic, id: 'formal', itemId: 'native', createdAt: '2026-11-03T10:02:00Z' };
 const messages = mergeMessageList([confirmed, msg('other', '04:00')], [formal, optimistic]);
 assert.equal(messages.length, 2);
 assert.equal(messages[1].id, 'formal');
 assert.equal(messages[1].createdAt, confirmed.createdAt);
});
test('complete bodies survive stale snapshots and formal body replaces by identity', () => {
 const store = new ConversationStore({ partialSessionIds: [], cachedSessions: [] });
 const message = msg('codex:t:i', '02:00', { itemId: 'i', turnId: 't', serverTimestamp: true });
 store.completeMessage('thread', message);
 assert.equal(store.get('thread').session.messages.length, 1);
 store.completeMessage('thread', message);
 assert.equal(store.get('thread').session.messages.length, 1);
 store.clearCompletedMessages('thread');
 assert.equal(store.get('thread').session.messages.length, 0);
});
test('complete events persist time across restart, late completion, refresh and history handoff', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-complete-'));
 const stateFile = path.join(root, 'execution.json');
 const events = [];
 let tracker = createExecutionTracker({ stateFile, broadcast: event => events.push(event) });
 try {
 tracker.handleProtocolMessage({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 't' } } });
 tracker.handleProtocolMessage({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 't', itemId: 'i', delta: 'partial' } });
 const partial = { threadId: 'thread', messages: [{ id: 'codex:t:i', role: 'assistant', itemId: 'i', turnId: 't', text: 'partial' }] };
 assert.equal(tracker.completeSession(partial, true).messages.length, 0);
 tracker.handleProtocolMessage({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 't', status: 'completed' } } });
 tracker.handleProtocolMessage({ method: 'item/completed', params: { threadId: 'thread', turnId: 't', item: { id: 'i', type: 'agentMessage', phase: 'final_answer', text: 'whole reply' } } });
 const complete = events.find(event => event.type === 'assistant_message_completed').message;
 assert.equal(tracker.getStatus('thread').active, false);
 assert.equal(events.some(event => event.type === 'assistant_delta'), false);
 assert.equal(tracker.completeSession({ threadId: 'thread', messages: [] }, true).messages[0].text, 'whole reply');
 const history = { ...partial, messages: [{ ...partial.messages[0], text: 'whole reply', createdAt: '2026-01-01T00:00:00Z' }] };
 assert.equal(tracker.completeSession(history, true).messages.length, 1);
 assert.equal(tracker.completeSession(history, true).messages[0].createdAt, complete.createdAt);
 await tracker.close();
 tracker = createExecutionTracker({ stateFile, broadcast: () => {} });
 assert.equal(tracker.completeSession(history, true).messages[0].createdAt, complete.createdAt);
 tracker.clearCompletedMessages('thread');
 assert.equal(tracker.completeSession({ threadId: 'thread', messages: [] }, true).messages.length, 0);
 } finally { await tracker.close(); await fs.rm(root, { recursive: true, force: true }); }
});
