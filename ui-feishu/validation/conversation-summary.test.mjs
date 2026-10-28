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
  assert.equal(restored.cachedSessions.length, 10);
  assert.equal(restored.cachedSessions.some(item => item.threadId === 'prefetch-0'), false);
});
