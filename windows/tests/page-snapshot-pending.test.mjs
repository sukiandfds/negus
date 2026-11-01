import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationStore, mergeMessageList, mergePendingOptimisticMessages, writeConversationSnapshot, readConversationSnapshot, readInitialConversationState, storage } from './frontend-conversation-store.mjs';
const local = id => ({ id: `optimistic-${id}`, submissionId: id, role: 'user', text: 'same text', createdAt: '2026-11-01T01:33:04Z' });
const session = id => ({ threadId: id, source: 'codex', title: id, updatedAt: '', messageCount: 0, latestUser: '', latestAssistant: '', messages: [] });
const create = (...details) => new ConversationStore({ cachedSessions: details, partialSessionIds: [], sessions: details });

test('retry replaces the bubble; acknowledgement remains visible until the batch commits', () => {
  const store = create(session('thread'));
  store.addMessage('thread', { ...local('old'), deliveryState: 'failed' });
  store.changeMessages('thread', () => [local('new')]);
  assert.deepEqual(store.get('thread').session.messages.map(m => m.id), ['optimistic-new']);
  const native = { ...local('new'), id: 'native-new' };
  assert.equal(store.committed.get('thread').session.messages.length, 0);
  store.commit('thread', { ...store.empty('thread'), session: { ...session('thread'), messages: [native] } }, 0);
  assert.deepEqual(store.get('thread').session.messages.map(m => m.id), ['native-new']);
  assert.equal(store.localPending.has('thread'), false);
  store.addMessage('thread', local('second'));
  assert.equal(store.get('thread').session.messages.length, 2);
  store.changeMessages('thread', () => []);
  assert.deepEqual(store.get('thread').session.messages.map(m => m.id), ['native-new']);
});

test('legacy optimistic ID uses submission identity and repeated identical text remains distinct', () => {
  const legacy = local('old'); delete legacy.submissionId;
  const native = { ...local('old'), id: 'native-old' };
  assert.deepEqual(mergeMessageList([legacy], [native]).map(m => m.id), ['native-old']);
  assert.equal(mergeMessageList([local('one')], [local('two')]).length, 2);
  assert.equal(mergePendingOptimisticMessages({ threadId: 'thread', messages: [native] }, [legacy]).messages.length, 1);
});

test('sending into unloaded history displays immediately and survives its first commit', () => {
  const store = create();
  store.addMessage('unloaded', local('during-load'));
  assert.equal(store.get('unloaded').session.messages[0].text, 'same text');
  store.commit('unloaded', { ...store.empty('unloaded'), session: session('unloaded') }, 0);
  assert.equal(store.get('unloaded').session.messages[0].id, 'optimistic-during-load');
});

test('pending ID migration moves all bubbles, queue and model choice and leaves no orphan entry', () => {
  const store = create(session('pending:new'));
  store.addMessage('pending:new', local('first'));
  store.addMessage('pending:new', local('second'));
  store.update('pending:new', { queueItems: [{ id: 'queue-one', threadId: 'pending:new' }] });
  store.modelChoices.set('pending:new', { model: 'chosen', reasoningEffort: 'high' });
  store.migrate('pending:new', 'real', session('real'));
  assert.equal(store.committed.has('pending:new'), false);
  assert.equal(store.localPending.has('pending:new'), false);
  assert.equal(store.get('real').session.messages.length, 2);
  assert.equal(store.get('real').queueItems[0].threadId, 'real');
  assert.equal(store.get('real').contextStatus.model, 'chosen');
});

test('a late read cannot overwrite a newer queue or model mutation or another thread', () => {
  const store = create(session('a'), session('b'));
  const stale = { ...store.empty('a'), session: session('a') };
  store.update('a', { queueItems: [{ id: 'new-queue' }], contextStatus: { ...store.empty('a').contextStatus, model: 'new-model' } });
  store.commit('a', stale, 0);
  assert.equal(store.get('a').queueItems[0].id, 'new-queue');
  assert.equal(store.get('a').contextStatus.model, 'new-model');
  assert.equal(store.get('b').contextStatus.model, '');
});

test('events are idempotent across two entrances and stale epochs cannot restore old state', () => {
  const store = create(session('a'));
  const event = { type: 'execution_status', threadId: 'a', eventEpoch: 'old', eventSeq: 3 };
  assert.equal(store.acceptEvent(event), true);
  assert.equal(store.acceptEvent(event), false);
  assert.equal(store.acceptEvent({ ...event, eventSeq: 2 }), false);
  assert.equal(store.acceptEvent({ ...event, eventEpoch: 'new', eventSeq: 1 }), true);
  assert.equal(store.acceptEvent({ ...event, eventSeq: 4 }), false);
});

test('old snapshots restore all controls while only failed/occupied images persist', () => {
  storage.clear();
  const failed = { ...local('failed'), deliveryState: 'failed', deliveryError: 'failure', blocks: [{ id: 'image', type: 'image', source: '/photo', file: { id: 'photo', mimeType: 'image/png' } }] };
  const original = { ...session('a'), messages: [failed, { ...local('occupied'), deliveryState: 'occupied', deliveryError: 'busy' }, local('sending')] };
  const store = create(original);
  const view = { ...store.empty('a'), queueItems: [{ id: 'queued' }], userInputRequest: { threadId: 'a', requestId: 'question' }, goal: { objective: 'goal' } };
  store.update('a', view);
  store.update('a', { executionStatus: { ...view.executionStatus, streamingText: 'live' } }, true);
  writeConversationSnapshot({ selectedId: 'a', sessions: [original], session: store.get('a', false).session,
    presentation: { a: store.get('a', false) } });
  const snapshot = readConversationSnapshot();
  const restored = new ConversationStore({ cachedSessions: [snapshot.session], partialSessionIds: ['a'], sessions: snapshot.sessions, presentation: snapshot.presentation });
  assert.deepEqual(restored.get('a').session.messages.map(m => m.id), ['optimistic-failed', 'optimistic-occupied']);
  assert.deepEqual(restored.get('a').session.messages[0].blocks, failed.blocks);
  assert.equal(restored.get('a').queueItems[0].id, 'queued');
  assert.equal(restored.get('a').userInputRequest.requestId, 'question');
  assert.equal(restored.get('a').executionStatus.streamingText, '');
  assert.equal(restored.get('a').goal.objective, 'goal');
});

test('legacy context restores once and cannot override the new canonical snapshot', () => {
  storage.clear();
  storage.set('codex-collab-conversation-snapshot-v1', JSON.stringify({ version: 1, savedAt: '2026-10-30T01:00:00Z',
    selectedId: 'a', session: session('a'), sessions: [session('a')] }));
  const legacyContext = { ...create().empty('a').contextStatus, model: 'legacy-model', reasoningEffort: 'high' };
  storage.set('negus-context-status-v1', JSON.stringify({ version: 1, value: { a: legacyContext } }));
  const initial = readInitialConversationState();
  const store = new ConversationStore(initial);
  assert.equal(store.get('a').contextStatus.model, 'legacy-model');
  assert.equal(store.get('a').contextStatus.reasoningEffort, 'high');
  store.update('a', { contextStatus: { ...legacyContext, model: 'new-model' } });
  writeConversationSnapshot({ selectedId: 'a', sessions: initial.sessions, session: store.get('a', false).session,
    presentation: { a: store.get('a', false) } });
  const restored = new ConversationStore(readInitialConversationState());
  assert.equal(restored.get('a').contextStatus.model, 'new-model');
  assert.equal(restored.get('a').session.threadId, 'a');
});

test('persistent revision ignores live and pending changes but tracks failed messages and confirmation', () => {
  const store = create(session('a'));
  const active = { ...store.empty('a').executionStatus, phase: 'working', active: true, turnId: 'turn' };
  store.update('a', { executionStatus: active });
  let revision = store.getPersistSnapshot();
  for (let i = 0; i < 20; i++) store.update('a', { executionStatus: { ...active, streamingText: `stream-${i}`, streamingItemId: 'item' } }, true);
  store.invalidate('a');
  store.sendingQueue.set('queue', 'time'); store.notify(); store.sendingQueue.delete('queue'); store.notify();
  assert.equal(store.getPersistSnapshot(), revision);
  const message = { ...local('one'), deliveryState: 'preparing' };
  store.addMessage('a', message);
  for (const deliveryState of ['sending', 'pending']) store.changeMessages('a', items => items.map(item => ({ ...item, deliveryState })));
  assert.equal(store.getPersistSnapshot(), revision);
  const change = patch => store.changeMessages('a', items => items.map(item => ({ ...item, ...patch })));
  change({ deliveryState: 'failed', deliveryError: 'failure', blocks: [{ type: 'image', id: 'image', source: '/photo' }] });
  assert.equal(store.getPersistSnapshot(), ++revision);
  change({ deliveryError: 'new failure', blocks: [{ type: 'image', id: 'image', source: '/new-photo' }] });
  assert.equal(store.getPersistSnapshot(), ++revision);
  change({ deliveryState: 'occupied', deliveryError: 'busy' });
  assert.equal(store.getPersistSnapshot(), ++revision);
  change({ deliveryState: 'sending' });
  assert.equal(store.getPersistSnapshot(), ++revision, 'retry removes the persisted failure');
  change({ deliveryState: 'failed' });
  assert.equal(store.getPersistSnapshot(), ++revision);
  const confirmed = { ...message, id: 'native-one', deliveryState: undefined };
  store.commit('a', { ...store.empty('a'), session: { ...session('a'), messages: [confirmed] } }, store.revisions.get('a'));
  assert.equal(store.getPersistSnapshot(), ++revision);
  assert.equal(store.localPending.has('a'), false);
  store.addMessage('a', { ...local('two'), deliveryState: 'occupied' });
  assert.equal(store.getPersistSnapshot(), ++revision);
  store.changeMessages('a', () => []);
  assert.equal(store.getPersistSnapshot(), ++revision);
  store.migrate('a', 'b', session('b'));
  assert.equal(store.getPersistSnapshot(), ++revision);
});
