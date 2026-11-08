import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(realpathSync(new URL('../node_modules/vite/package.json', import.meta.url)));
const { build } = require('esbuild');
const storage = new Map();
globalThis.window = { location: { search: '' }, localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
} };
const bundle = await build({
  stdin: { contents: `export { buildConversationDirectory } from './src/conversationDirectory';
    export { writeConversationSnapshot } from './shared/features/conversations/data/conversationSnapshot';
    export { readInitialConversationState } from './shared/features/conversations/state/initialConversation';
    export { ConversationRows } from './src/components/ConversationRows';
    export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server';`,
    resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, loader: { '.css': 'empty', '.module.css': 'empty' },
});
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { buildConversationDirectory, writeConversationSnapshot, readInitialConversationState,
  ConversationRows, createElement, renderToStaticMarkup } = loaded.exports;
const time = hour => `2026-10-28T${hour}:00:00Z`;
const session = (threadId, reply, hour) => ({ threadId, source: 'codex', title: threadId, updatedAt: time(hour),
  messageCount: 1, latestUser: '', latestAssistant: reply,
  messages: [{ id: `${threadId}-${hour}`, role: 'assistant', text: reply, createdAt: time(hour) }] });
const directory = () => ({ statusByThread: {}, contextByThread: {}, projects: ['A', 'B'].map(threadId => ({
  id: threadId, employeeId: threadId, name: threadId, kind: 'employee', lastActivityAt: time('08'),
  conversations: [{ id: threadId, threadId, conversationId: `conversation-${threadId}`, title: threadId,
    main: true, lastActivityAt: time('08') }],
})) });
const render = rows => renderToStaticMarkup(createElement(ConversationRows, { items: rows,
  c: { selectedId: 'A', archivedView: false, archiveBusyIds: new Set() }, opening: '', query: '', onOpen: () => {} }));

test('opening B then A preserves B preview after reopening and an A-only list refresh', () => {
  storage.clear();
  const openedB = session('B', 'B上次已读取的回复', '10');
  const openedA = session('A', 'A当前回复', '09');
  const cached = new Map([['B', openedB], ['A', openedA]]);
  writeConversationSnapshot({ selectedId: 'B', sessions: [openedB], session: openedB, cachedSessions: cached });
  writeConversationSnapshot({ selectedId: 'A', sessions: [openedA], session: openedA, cachedSessions: cached });
  window.location.search = '?agent=A&thread=A';
  const restored = readInitialConversationState();
  assert.equal(restored.selectedId, 'A');
  assert.deepEqual(restored.sessions.map(entry => entry.threadId), ['A']);
  const rows = buildConversationDirectory(directory(), restored.sessions, false, '',
    new Map(restored.cachedSessions.map(entry => [entry.threadId, entry])));
  assert.match(render(rows.all), /B上次已读取的回复/);
  assert.equal(rows.all.find(entry => entry.threadId === 'B').time, time('10'));
  assert.equal(rows.employees[0].threadId, 'B');
});

test('a fresh directory reply updates unopened B and an older directory cannot overwrite cached B', () => {
  const state = directory();
  const cached = new Map([['B', session('B', 'B缓存回复', '10')]]);
  const entry = state.projects[1].conversations[0];
  Object.assign(entry, { latestMessage: 'B旧目录回复', lastActivityAt: time('09') });
  const buildRows = () => buildConversationDirectory(state, [session('A', 'A回复', '09')], false, '', cached);
  assert.match(render(buildRows().all), /B缓存回复/);
  assert.doesNotMatch(render(buildRows().all), /B旧目录回复/);
  Object.assign(entry, { latestMessage: 'B刚收到的新回复', lastActivityAt: time('11') });
  assert.match(render(buildRows().all), /B刚收到的新回复/);
  assert.equal(buildRows().all[0].threadId, 'B');
  assert.equal(buildRows().all[0].time, time('11'));
  Object.assign(entry, { latestMessage: 'B旧目录回复', latestMessageAt: time('09'), lastActivityAt: time('12') });
  assert.match(render(buildRows().all), /B缓存回复/);
  assert.doesNotMatch(render(buildRows().all), /B旧目录回复/);
});

test('cached conversations do not restore removed or archived directory entries', () => {
  const state = directory();
  state.projects[1].conversations[0].archived = true;
  const cached = new Map([['B', session('B', 'B已归档', '10')], ['removed', session('removed', '已删除', '11')]]);
  const rows = buildConversationDirectory(state, [], false, '', cached);
  assert.equal(rows.all.some(entry => entry.threadId === 'B' || entry.threadId === 'removed'), false);
});

test('an archived employee main conversation does not return as a placeholder row', () => {
  const state = directory();
  state.projects[0].conversations[0].archived = true;
  const rows = buildConversationDirectory(state, [], false);
  assert.equal(rows.employees.some(entry => entry.agentId === 'A'), false);
  assert.equal(rows.all.some(entry => entry.threadId === 'A'), false);
});

test('a stale active session response cannot restore a confirmed archived row', () => {
  const stale = session('C', '归档前的旧摘要', '10');
  const rows = buildConversationDirectory({ ...directory(), projects: [] }, [stale], false, '', undefined, { C: true });
  assert.equal(rows.all.some(entry => entry.threadId === 'C'), false);
});

test('task rows ignore recovery timestamps in cached summaries but retain actual new messages', () => {
  const state = directory();
  const entry = state.projects[1].conversations[0];
  Object.assign(entry, { conversationId: 'handoff-1', lastActivityAt: time('10'), latestMessageAt: time('10'), latestMessage: '目录消息' });
  const cached = new Map([['B', { ...session('B', '缓存消息', '09'), updatedAt: time('23') }]]);
  const row = () => buildConversationDirectory(state, [], false, '', cached).all.find(item => item.threadId === 'B');
  assert.equal(row().time, time('10'));
  assert.equal(row().preview, '目录消息');
  cached.set('B', { ...session('B', '新消息', '11'), updatedAt: time('23') });
  assert.equal(row().time, time('11'));
});

test('prefetched recent conversations survive reload without opening each one', () => {
  storage.clear();
  const recent = Array.from({ length: 12 }, (_, i) => session(`prefetch-${i}`, `reply-${i}`, String(i).padStart(2, '0')));
  writeConversationSnapshot({ selectedId: recent[11].threadId, sessions: recent, session: recent[11],
    cachedSessions: new Map(recent.map(item => [item.threadId, item])) });
  window.location.search = '?thread=prefetch-10';
  const restored = readInitialConversationState();
  assert.equal(restored.session.messages[0].text, 'reply-10');
  assert.equal(restored.cachedSessions.length, 12);
  assert.equal(restored.cachedSessions.some(item => item.threadId === 'prefetch-0'), true);
});

test('old history format is refreshed once while new format reuses the cache', () => {
  storage.clear();
  const legacy = session('legacy', 'old', '09');
  const updated = { ...session('updated', 'new', '10'), historyFormatVersion: 3 };
  writeConversationSnapshot({ selectedId: 'legacy', sessions: [legacy, updated], session: legacy,
    cachedSessions: new Map([['legacy', legacy], ['updated', updated]]) });
  window.location.search = '?thread=legacy';
  const initial = readInitialConversationState();
  assert.ok(initial.partialSessionIds.includes('legacy'));
  assert.ok(!initial.partialSessionIds.includes('updated'));
  assert.equal(initial.session.messages[0].text, 'old');
  const refreshed = { ...legacy, historyFormatVersion: 3 };
  writeConversationSnapshot({ selectedId: 'legacy', sessions: [refreshed], session: refreshed, cachedSessions: new Map([['legacy', refreshed]]) });
  assert.ok(!readInitialConversationState().partialSessionIds.includes('legacy'));
});

test('persisted snapshots keep confirmed messages and exclude pending and live overlays', () => {
  storage.clear();
  const original = session('A', 'confirmed', '09');
  original.messages.push(
    { id: 'optimistic-one', submissionId: 'one', role: 'user', text: 'same', blocks: [{ type: 'image', id: 'img', source: 'image' }] },
    { id: 'optimistic-two', submissionId: 'two', role: 'user', text: 'same' },
    { id: 'stream-segment:1', role: 'assistant', text: 'in progress' },
  );
  const presentation = { A: { executionStatus: { commentary: 'working', streamingText: 'partial', streamingItemId: 'item' },
    streamingText: 'partial', commentaryText: 'working', syncSignature: 'old' } };
  writeConversationSnapshot({ selectedId: 'A', sessions: [original], session: original, cachedSessions: new Map([['A', original]]), presentation });
  const stored = JSON.parse(storage.get('negus-conversation-snapshot-v1'));
  assert.deepEqual(stored.session.messages.map(message => message.id), ['A-09']);
  assert.equal(stored.isPartial, true);
  assert.equal(stored.presentation.A.streamingText, '');
  assert.equal(stored.presentation.A.executionStatus.streamingText, '');
  assert.equal(stored.presentation.A.syncSignature, undefined);
  assert.equal(stored.sessions[0].messages, undefined, 'the summary must not persist message bodies');
  assert.equal(original.messages.length, 4, 'writing must not alter visible pending messages');
  window.location.search = '?thread=A';
  assert.deepEqual(readInitialConversationState().session.messages.map(message => message.id), ['A-09']);
});

test('legacy snapshots remove pending overlays and require a fresh read', () => {
  storage.clear();
  const legacy = session('B', 'confirmed', '10');
  legacy.sourceSignature = 'old';
  legacy.messages.push({ id: 'optimistic-previous', role: 'user', text: 'pending' });
  storage.set('negus-conversation-snapshot-v1', JSON.stringify({ version: 1, savedAt: time('11'), selectedId: 'B', sessions: [legacy], session: legacy }));
  window.location.search = '?thread=B';
  const restored = readInitialConversationState();
  assert.deepEqual(restored.session.messages.map(message => message.id), ['B-10']);
  assert.equal(restored.session.sourceSignature, undefined);
  assert.equal(restored.sessionIsPartial, true);
});

test('failed and occupied messages keep their attachments and error across refresh', () => {
  storage.clear();
  const original = session('A', 'confirmed', '09');
  const failed = { id: 'optimistic-failed', submissionId: 'failed', role: 'user', text: 'photo',
    deliveryState: 'failed', deliveryError: 'upload failed', blocks: [{ type: 'image', id: 'img', source: '/api/media/photo' }] };
  const occupied = { ...failed, id: 'optimistic-occupied', submissionId: 'occupied', deliveryState: 'occupied', deliveryError: 'busy' };
  original.messages.push(failed, occupied);
  writeConversationSnapshot({ selectedId: 'A', sessions: [original], session: original });
  window.location.search = '?thread=A';
  const restored = readInitialConversationState();
  assert.deepEqual(restored.session.messages.slice(1), [failed, occupied]);
  assert.equal(restored.sessionIsPartial, true);
});

test('all loaded messages and local failures survive in selected and recent conversations', () => {
  storage.clear();
  const failed = { id: 'optimistic-failed', submissionId: 'failed', role: 'user', text: 'photo',
    deliveryState: 'failed', deliveryError: 'upload failed', blocks: [{ type: 'image', id: 'img', source: '/photo' }] };
  const occupied = { ...failed, id: 'optimistic-occupied', submissionId: 'occupied', deliveryState: 'occupied', deliveryError: 'busy' };
  const ordinary = Array.from({ length: 60 }, (_, i) => ({ id: `server-${i}`, role: 'user', text: `message-${i}`,
    ...(i === 0 ? { deliveryState: 'failed' } : {}) }));
  const selected = { ...session('selected', '', '10'), messages: [failed, occupied, ...ordinary] };
  const recent = { ...session('recent', '', '09'), messages: [failed, occupied, ...ordinary] };
  assert.equal(writeConversationSnapshot({ selectedId: 'selected', sessions: [selected, recent], session: selected,
    cachedSessions: new Map([['selected', selected], ['recent', recent]]) }), true);
  const stored = JSON.parse(storage.get('negus-conversation-snapshot-v1'));
  for (const detail of [stored.session, stored.recentSessions[0].session]) {
    assert.deepEqual(detail.messages, [failed, occupied, ...ordinary]);
    assert.equal(detail.messages.some(message => message.id === 'server-0'), true);
  }
  assert.equal(stored.isPartial, true);
  assert.equal(stored.recentSessions[0].isPartial, true);
  window.location.search = '?thread=selected';
  assert.deepEqual(readInitialConversationState().session.messages, stored.session.messages);
});

test('61 loaded messages remain complete without fixed message eviction', () => {
  storage.clear();
  const original = { ...session('ordinary', '', '10'), messages: Array.from({ length: 61 }, (_, i) => ({ id: `m-${i}`, role: 'user', text: '' })) };
  assert.equal(writeConversationSnapshot({ selectedId: 'ordinary', sessions: [original], session: original }), true);
  const stored = JSON.parse(storage.get('negus-conversation-snapshot-v1'));
  assert.equal(stored.isPartial, false);
  assert.deepEqual(stored.session.messages, original.messages);
});

test('large cached bodies are retained without the former snapshot budget', () => {
  storage.clear();
  const original = { ...session('large', '', '10'), messages: [{ id: 'large', role: 'assistant', text: 'x'.repeat(2 * 1024 * 1024) }] };
  assert.equal(writeConversationSnapshot({ selectedId: 'large', sessions: [original], session: original }), true);
  window.location.search = '?thread=large';
  assert.deepEqual(readInitialConversationState().session.messages, original.messages);
});

test('storage write failure is reported without throwing or overwriting the snapshot', () => {
  storage.clear();
  const original = session('selected', 'previous', '09');
  assert.equal(writeConversationSnapshot({ selectedId: 'selected', sessions: [original], session: original }), true);
  const previous = storage.get('negus-conversation-snapshot-v1');
  const setItem = window.localStorage.setItem, log = console.error, errors = [];
  window.localStorage.setItem = () => { throw new Error('quota'); };
  console.error = message => errors.push(message);
  try {
    assert.equal(writeConversationSnapshot({ selectedId: 'selected', sessions: [original], session: original }), false);
    assert.equal(storage.get('negus-conversation-snapshot-v1'), previous);
    assert.match(errors[0], /storage failed/);
  } finally { window.localStorage.setItem = setItem; console.error = log; }
});

test('committed latest reply wins over stale preview in newer detail cache', () => {
  const state = directory();
  const latest = { ...session('A', '您好，我在。', '10'), latestMessage: '助手：您好，我在。' };
  const cached = { ...session('A', '您好，我在。', '11'), latestMessage: '用户：旧指令' };
  const rows = buildConversationDirectory(state, [latest], false, '', new Map([['A', cached]]));
  assert.equal(rows.all.find(row => row.threadId === 'A').preview, '助手：您好，我在。');
  latest.latestMessage = '助手：新的回复';
  cached.messages[cached.messages.length - 1].text = '新的回复';
  cached.messages.push({ id: 'old-goal', role: 'user', text: '/goal 旧指令', createdAt: time('08') });
  assert.equal(buildConversationDirectory(state, [latest], false, '', new Map([['A', cached]])).all.find(row => row.threadId === 'A').preview, '助手：新的回复');
});

test('incomplete directory summaries keep cached identity at equal or newer timestamps', () => {
  const cached = { ...session('A', '已显示正文', '09'), cwd: '/fixture/negus', createdBy: 'user', latestMessage: '助手：已显示正文' };
  for (const projects of [[], directory().projects]) {
    for (const hour of ['09', '10']) {
      const listed = { threadId: 'A', title: '新标题', source: 'codex', updatedAt: time(hour) };
      const rows = buildConversationDirectory({ ...directory(), projects }, [listed], false, '', new Map([['A', cached]]));
      const row = rows.all.find(row => row.threadId === 'A');
      assert.equal(row.session.cwd, cached.cwd);
      assert.equal(row.session.createdBy, 'user');
      assert.equal(row.name, projects.length ? 'A' : '新标题');
      assert.match(row.preview, /已显示正文/);
    }
  }
});
