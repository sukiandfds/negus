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
  stdin: { contents: `export { buildConversationDirectory, mergeDirectoryProjects, snapshotStatusByThread } from './src/conversationDirectory';
    export { ConversationStore } from './shared/features/conversations/state/conversationStore';
    export { writeConversationSnapshot } from './shared/features/conversations/data/conversationSnapshot';
    export { readInitialConversationState } from './shared/features/conversations/state/initialConversation';
    export { compactTime } from './src/presentation';
    export { ContentRenderer } from './shared/features/conversations/rendering/ContentRenderer';
    export { ConversationRows } from './src/components/ConversationRows';
    export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server';`,
    resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, loader: { '.css': 'empty', '.module.css': 'empty' },
});
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { buildConversationDirectory, mergeDirectoryProjects, snapshotStatusByThread, ConversationStore,
  writeConversationSnapshot, readInitialConversationState,
  compactTime, ContentRenderer, ConversationRows, createElement, renderToStaticMarkup } = loaded.exports;
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

test('compact time keeps the existing local date and clock formats', () => {
  assert.equal(compactTime(''), '');
  assert.equal(compactTime('not-a-date'), '');
  const today = new Date();
  today.setHours(8, 30, 0, 0);
  assert.match(compactTime(today.toISOString()), /^08:30$/);
  assert.equal(compactTime('2026-10-28T10:00:00Z'),
    new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date('2026-10-28T10:00:00Z')));
});

test('markdown content keeps formatting and file-link context', () => {
  const html = renderToStaticMarkup(createElement(ContentRenderer, {
    threadId: 'thread-A',
    message: { id: 'message-A', role: 'assistant', text: '**粗体**\n\n[文档](guide.md)', createdAt: time('10') },
  }));
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /guide\.md/);
  assert.match(html, /threadId=thread-A/);
  assert.match(html, /messageId=message-A/);
});

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

test('employee rows show aggregate work status instead of only the main conversation status', () => {
  const state = directory();
  state.projects[0].status = { phase: 'idle', label: 'idle', active: false, indicator: null };
  state.projects[0].conversations[0].status = { phase: 'idle', active: false };
  state.projects[0].conversations.push({
    id: 'task-active', threadId: 'task-active', conversationId: 'handoff-active', title: '后台任务',
    status: { phase: 'working', label: '正在处理后台任务', active: true, indicator: 'green', turnId: 'turn' },
  });
  const rows = buildConversationDirectory(state, [], false);
  const employee = rows.employees.find(entry => entry.agentId === state.projects[0].employeeId);
  assert.equal(employee.active, true);
  assert.equal(employee.label, '正在处理后台任务');
  assert.equal(rows.all.find(entry => entry.threadId === 'A').active, true);
  assert.equal(rows.all.find(entry => entry.threadId === 'A').label, '正在处理后台任务');
});

test('an idle live status does not mark the employee main conversation as working', () => {
  const state = directory();
  state.statusByThread.A = { phase: 'idle', label: '等待任务', active: false, turnId: '' };
  state.projects[0].status = { phase: 'idle', label: '等待任务', active: false, turnId: '' };
  state.projects[0].conversations[0].status = { phase: 'idle', label: '等待任务', active: false, turnId: '' };
  const rows = buildConversationDirectory(state, [], false);
  const employee = rows.employees.find(entry => entry.agentId === 'A');
  assert.equal(employee.active, false);
  assert.notEqual(employee.label, '正在主对话工作');
});

test('conversation created outside Negus is labeled as coming from codex', () => {
  const codexSession = session('codex-thread', 'Codex reply', '10');
  const negusSession = { ...session('negus-thread', 'Negus reply', '09'), createdBy: 'user' };
  const rows = buildConversationDirectory({ statusByThread: {}, contextByThread: {}, projects: [] }, [codexSession, negusSession], false);
  assert.equal(rows.all.find(entry => entry.threadId === 'codex-thread').origin, 'codex');
  assert.equal(rows.all.find(entry => entry.threadId === 'negus-thread').origin, 'user');
  assert.match(render(rows.all), /来自codex/);
  assert.match(render(rows.all), /来自用户/);
});

test('project conversation without a Negus creator is labeled as coming from codex', () => {
  const state = {
    statusByThread: {},
    contextByThread: {},
    projects: [{
      id: 'negus', projectId: 'project:personal:negus', name: 'negus', kind: 'personal',
      conversations: [{ id: 'codex-thread', threadId: 'codex-thread', title: 'Codex created', role: 'standard' }],
    }],
  };
  const rows = buildConversationDirectory(state, [session('codex-thread', 'Codex reply', '10')], false);
  assert.equal(rows.all.find(entry => entry.threadId === 'codex-thread').origin, 'codex');
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

const taskThread = '01a1c0f0-d87c-73c3-99b5-3c7dbcd6d4fd';
const taskConversation = 'handoff-a384e87138066c9940e3df30e879e513';
const taskDirectory = (phase, label, hour, title, latestMessage) => {
  const state = directory();
  const active = ['starting', 'running'].includes(phase);
  state.projects[0].mainThreadId = 'A';
  state.projects[0].status = { phase, label, active, indicator: active ? 'green' : null };
  state.projects[0].lastActivityAt = time(hour);
  state.projects[0].conversations.push({
    id: taskThread, threadId: taskThread, conversationId: taskConversation, title,
    lastActivityAt: time(hour), latestMessageAt: time(hour), latestMessage,
    status: { phase, label, active, indicator: active ? 'green' : null },
  });
  return state;
};
const taskRows = (projects, sessions = [], cachedSessions = new Map(), statusByThread = {}) =>
  buildConversationDirectory({ statusByThread, contextByThread: {}, projects }, sessions, false, '', cachedSessions);
const taskRow = (projects, sessions = [], cachedSessions = new Map(), statusByThread = {}) =>
  taskRows(projects, sessions, cachedSessions, statusByThread).all.find(row => row.threadId === taskThread);

test('task metadata follows directory status through running, completed and failures while body reads fail', () => {
  const initial = directory();
  initial.projects[0].mainThreadId = 'A';
  let merged = mergeDirectoryProjects(initial.projects, taskDirectory('running', '正在处理后台任务', '11', '任务运行中', '目录运行状态').projects);
  let row = taskRow(merged);
  assert.equal(row.active, true);
  assert.equal(row.name, '任务运行中');
  assert.equal(row.preview, '目录运行状态');
  assert.equal(taskRows(merged).employees.find(employee => employee.agentId === 'A').active, true);

  merged = mergeDirectoryProjects(merged, taskDirectory('completed', '已完成', '12', '任务已完成', '目录完成状态').projects);
  row = taskRow(merged);
  assert.equal(row.active, false);
  assert.equal(row.name, '任务已完成');
  assert.equal(row.preview, '目录完成状态');
  assert.equal(taskRows(merged).employees.find(employee => employee.agentId === 'A').active, false);
  assert.equal(merged[0].status.active, false);

  merged = mergeDirectoryProjects(merged, taskDirectory('failed', '执行失败', '13', '任务失败', '目录失败状态').projects);
  row = taskRow(merged);
  assert.equal(row.active, false);
  assert.equal(row.label, '');
  assert.equal(row.name, '任务失败');
  assert.equal(row.preview, '目录失败状态');
  assert.equal(merged[0].conversations.find(item => item.threadId === taskThread).status.phase, 'failed');

  merged = mergeDirectoryProjects(merged, taskDirectory('systemError', '系统异常', '14', '任务系统异常', '目录异常状态').projects);
  row = taskRow(merged);
  assert.equal(row.active, false);
  assert.notEqual(row.label, '助手正在运行...');
  assert.equal(row.name, '任务系统异常');
  assert.equal(row.preview, '目录异常状态');
  assert.equal(merged[0].conversations.find(item => item.threadId === taskThread).status.phase, 'systemError');
});

test('body success supplements one task without reverting directory status and live status still wins', () => {
  const directoryState = taskDirectory('systemError', '系统异常', '14', '任务系统异常', '目录异常状态');
  const merged = mergeDirectoryProjects([], directoryState.projects);
  assert.equal(taskRow(merged).name, '任务系统异常');
  const body = session(taskThread, '正文稍后读取成功', '15');
  const row = taskRow(merged, [body], new Map([[taskThread, body]]));
  assert.equal(row.active, false);
  assert.equal(row.name, '任务系统异常');
  assert.match(row.preview, /正文稍后读取成功/);
  assert.deepEqual(row.session.messages.map(message => message.text), ['正文稍后读取成功']);
  assert.equal(taskRow(merged).threadId, taskThread);

  const live = taskRow(merged, [body], new Map([[taskThread, body]]),
    { [taskThread]: { phase: 'running', label: '实时运行', active: true, indicator: 'green' } });
  assert.equal(live.active, true);
});

const liveStatus = (phase, active) => ({
  type: 'execution_status', threadId: taskThread, turnId: active ? 'turn-live' : '', phase,
  label: active ? '实时运行' : phase, detail: '', commentary: '', streamingItemId: '', streamingText: '',
  activities: [], active, startedAt: null, updatedAt: null, durationMs: null,
});
const conversationStore = () => new ConversationStore({
  selectedId: taskThread, snapshotSavedAt: '', sessionIsPartial: false, session: null,
  cachedSessions: [], partialSessionIds: [], sessions: [],
});

test('unchanged snapshots finish requests without notifying, persisting or replacing state', async () => {
  const store = conversationStore();
  const base = store.empty(taskThread);
  const snapshot = {
    session: { ...session(taskThread, '已完成内容', '10'), contentVersion: 1, sourceRevision: 'r1' },
    executionStatus: liveStatus('completed', false), contextStatus: { ...base.contextStatus, threadId: taskThread },
    goal: null, queueItems: [], userInputRequest: null,
  };
  assert.equal(store.commit(taskThread, structuredClone(snapshot), 0), true);
  const committed = store.committed.get(taskThread);
  const persisted = store.getPersistSnapshot();
  let notifications = 0;
  store.subscribe(() => notifications++);

  assert.equal(store.commit(taskThread, structuredClone(snapshot), 0), false);
  assert.equal(notifications, 0);
  assert.equal(store.getPersistSnapshot(), persisted);
  assert.equal(store.committed.get(taskThread), committed);

  const request = store.request(taskThread);
  let accepted;
  void request.then(value => { accepted = value; });
  assert.equal(store.commit(taskThread, structuredClone(snapshot), store.revisions.get(taskThread)), true);
  assert.equal(await request, true);
  assert.equal(accepted, true);
});

test('an unchanged snapshot still notifies when it clears a stale live state', () => {
  const store = conversationStore();
  const base = store.empty(taskThread);
  const snapshot = {
    session: session(taskThread, '已完成内容', '10'),
    executionStatus: liveStatus('idle', false), contextStatus: { ...base.contextStatus, threadId: taskThread },
    goal: null, queueItems: [], userInputRequest: null,
  };
  store.commit(taskThread, snapshot, 0);
  store.update(taskThread, { executionStatus: liveStatus('working', true) }, true);
  let notifications = 0;
  store.subscribe(() => notifications++);

  const changed = store.commit(taskThread, structuredClone(snapshot), 0);
  if (changed) store.notify();
  assert.equal(changed, true);
  assert.equal(store.live.has(taskThread), false);
  assert.equal(store.get(taskThread).executionStatus.active, false);
  assert.equal(notifications, 1);
});

test('optimistic confirmation remains visible work even when body content is unchanged', async () => {
  const store = conversationStore();
  const base = store.empty(taskThread);
  const snapshot = {
    session: session(taskThread, '原回复', '10'),
    executionStatus: liveStatus('completed', false), contextStatus: { ...base.contextStatus, threadId: taskThread },
    goal: null, queueItems: [], userInputRequest: null,
  };
  store.commit(taskThread, snapshot, 0);
  store.addMessage(taskThread, { id: 'optimistic-submit-1', submissionId: 'submit-1', role: 'user', text: '新消息', createdAt: time('11') });
  const persisted = store.getPersistSnapshot();
  const request = store.request(taskThread);
  const confirmed = {
    ...snapshot,
    session: { ...snapshot.session, messages: [...snapshot.session.messages,
      { id: 'native-submit-1', submissionId: 'submit-1', role: 'user', text: '新消息', createdAt: time('11') }] },
  };

  assert.equal(store.commit(taskThread, confirmed, store.revisions.get(taskThread)), true);
  assert.equal(store.get(taskThread).session.messages.some(message => message.id === 'native-submit-1'), true);
  assert.equal(store.localPending.has(taskThread), false);
  assert.ok(store.getPersistSnapshot() > persisted);
  assert.equal(await request, true);
});

test('uncommitted live task status reaches both task and employee parent through store wiring', () => {
  const store = conversationStore();
  store.update(taskThread, { executionStatus: liveStatus('running', true) }, true);
  const directoryState = taskDirectory('completed', '已完成', '10', '目录任务标题', '目录已完成');
  directoryState.projects[0].status = { phase: 'idle', label: 'idle', active: false, indicator: null };
  const statuses = snapshotStatusByThread(store, taskThread, directoryState.projects);
  assert.equal(statuses[taskThread].active, true);
  assert.equal(store.committed.has(taskThread), false);
  const rows = taskRows(directoryState.projects, [], new Map(), statuses);
  assert.equal(rows.all.find(row => row.threadId === taskThread).active, true);
  assert.equal(rows.employees.find(employee => employee.agentId === 'A').active, true);
});

test('live completion and failure fall back to current directory status without reviving running', () => {
  const store = conversationStore();
  for (const phase of ['completed', 'failed']) {
    store.update(taskThread, { executionStatus: liveStatus(phase, false) }, true);
    const runningDirectory = taskDirectory('running', '正在处理后台任务', '11', '目录运行标题', '目录运行摘要');
    const statuses = snapshotStatusByThread(store, taskThread, runningDirectory.projects);
    assert.equal(statuses[taskThread].active, false);
    assert.equal(taskRows(runningDirectory.projects, [], new Map(), statuses)
      .all.find(row => row.threadId === taskThread).active, false);
    const directoryState = taskDirectory(phase, phase, '12', `目录${phase}标题`, `目录${phase}摘要`);
    const backgroundStatuses = snapshotStatusByThread(store, 'another-selected-task', directoryState.projects);
    assert.equal(backgroundStatuses[taskThread].active, false);
    const rows = taskRows(directoryState.projects, [], new Map(), backgroundStatuses);
    assert.equal(rows.all.find(row => row.threadId === taskThread).active, false);
    assert.equal(rows.employees.find(employee => employee.agentId === 'A').active, false);
  }
});

test('non-selected stale committed active yields to completed directory for task and parent', () => {
  const store = conversationStore();
  store.update(taskThread, { executionStatus: { ...liveStatus('working', true), turnId: 'old-turn' } });
  const state = taskDirectory('completed', '已完成', '12', '目录完成标题', '目录完成摘要');
  state.projects[0].status = { phase: 'running', label: '正在处理后台任务', active: true, indicator: 'green' };
  const statuses = snapshotStatusByThread(store, 'other-selected-task', state.projects);
  assert.equal(statuses[taskThread], undefined);
  const rows = taskRows(state.projects, [], new Map(), statuses);
  assert.equal(rows.all.find(row => row.threadId === taskThread).active, false);
  const employee = rows.employees.find(row => row.agentId === 'A');
  assert.equal(employee.active, false);
  assert.notEqual(employee.label, '正在处理后台任务');
});

test('selected live terminal overrides directory project running for task and parent', () => {
  const store = conversationStore();
  for (const phase of ['completed', 'failed', 'interrupted', 'systemError']) {
    store.update(taskThread, { executionStatus: liveStatus(phase, false) }, true);
    const state = taskDirectory('running', '正在处理后台任务', '12', '目录运行标题', '目录运行摘要');
    state.projects[0].status = { phase: 'running', label: '正在处理后台任务', active: true, indicator: 'green' };
    const statuses = snapshotStatusByThread(store, taskThread, state.projects);
    const rows = taskRows(state.projects, [], new Map(), statuses);
    assert.equal(rows.all.find(row => row.threadId === taskThread).active, false);
    const employee = rows.employees.find(row => row.agentId === 'A');
    assert.equal(employee.active, false);
    assert.notEqual(employee.label, '正在处理后台任务');
  }
});

test('live running on selected or another task keeps task and parent active', () => {
  const state = taskDirectory('completed', '已完成', '12', '目录完成标题', '目录完成摘要');
  const secondThread = '01a1c0d8-eff4-7b52-aade-e15d421a206f';
  state.projects[0].conversations.push({
    id: secondThread, threadId: secondThread, conversationId: 'handoff-second',
    title: '另一活动任务', status: { phase: 'completed', label: '已完成', active: false },
  });
  const selectedStore = conversationStore();
  selectedStore.update(taskThread, { executionStatus: liveStatus('running', true) }, true);
  let rows = taskRows(state.projects, [], new Map(), snapshotStatusByThread(selectedStore, taskThread, state.projects));
  assert.equal(rows.all.find(row => row.threadId === taskThread).active, true);
  assert.equal(rows.employees.find(row => row.agentId === 'A').active, true);

  const backgroundStore = conversationStore();
  backgroundStore.update(secondThread, { executionStatus: { ...liveStatus('running', true), threadId: secondThread } }, true);
  rows = taskRows(state.projects, [], new Map(), snapshotStatusByThread(backgroundStore, taskThread, state.projects));
  assert.equal(rows.all.find(row => row.threadId === secondThread).active, true);
  assert.equal(rows.employees.find(row => row.agentId === 'A').active, true);
});

test('committed active supplements only an active directory status on the same turn', () => {
  const store = conversationStore();
  const committed = { ...liveStatus('working', true), turnId: 'shared-turn' };
  store.update(taskThread, { executionStatus: committed });
  const activeDirectory = taskDirectory('working', '正在处理后台任务', '12', '目录运行标题', '目录运行摘要');
  activeDirectory.projects[0].conversations[1].status = {
    phase: 'working', label: '正在处理后台任务', active: true, indicator: 'green', turnId: 'shared-turn',
  };
  let statuses = snapshotStatusByThread(store, 'other-selected-task', activeDirectory.projects);
  assert.equal(statuses[taskThread].active, true);
  let rows = taskRows(activeDirectory.projects, [], new Map(), statuses);
  assert.equal(rows.all.find(row => row.threadId === taskThread).active, true);
  assert.equal(rows.employees.find(row => row.agentId === 'A').active, true);

  activeDirectory.projects[0].conversations[1].status.turnId = 'newer-turn';
  statuses = snapshotStatusByThread(store, 'other-selected-task', activeDirectory.projects);
  assert.equal(statuses[taskThread], undefined);
});

test('backend terminal commit clears stale live streaming and keeps final answer; real working stays active', () => {
  const store = conversationStore();
  store.update(taskThread, { executionStatus: {
    ...liveStatus('working', true), streamingText: '过期流式内容',
    activities: [{ id: 'active-tool', phase: 'tool', label: '仍在执行', detail: '', completed: false, updatedAt: '' }],
  } }, true);
  const final = session(taskThread, '任务最终答复', '16');
  store.commit(taskThread, {
    ...store.empty(taskThread),
    session: final,
    executionStatus: { ...liveStatus('completed', false), turnId: 'turn-live', hasFinalAnswer: true },
  }, 0);
  let current = store.get(taskThread);
  assert.equal(current.executionStatus.active, false);
  assert.equal(current.executionStatus.phase, 'completed');
  assert.equal(current.executionStatus.hasFinalAnswer, true);
  assert.equal(current.executionStatus.streamingText, '');
  assert.deepEqual(current.executionStatus.activities, []);
  assert.equal(current.session.messages.at(-1).text, '任务最终答复');

  const workingStore = conversationStore();
  workingStore.update(taskThread, { executionStatus: {
    ...liveStatus('working', true), streamingText: '仍在输出',
  } }, true);
  workingStore.commit(taskThread, {
    ...workingStore.empty(taskThread),
    executionStatus: { ...liveStatus('working', true), turnId: 'turn-live', streamingText: '' },
  }, 0);
  current = workingStore.get(taskThread);
  assert.equal(current.executionStatus.active, true);
  assert.equal(current.executionStatus.streamingText, '仍在输出');
});

test('directory refresh retains old tasks and applies the latest running status', () => {
  const previous = directory();
  previous.projects[0].mainThreadId = 'A';
  previous.projects[0].conversations.push({
    id: 'old-task', threadId: 'old-task', conversationId: 'handoff-old', title: '旧任务',
    status: { phase: 'completed', label: '已完成', active: false },
  });
  const next = directory();
  next.projects[0].mainThreadId = 'A';
  next.projects[0].status = { phase: 'running', label: 'running', active: true, indicator: 'green' };
  next.projects[0].conversations.push(
    { id: 'old-task', threadId: 'old-task', conversationId: 'handoff-old', title: '旧任务', status: { phase: 'completed', label: '已完成', active: false } },
    { id: 'new-task', threadId: 'new-task', conversationId: 'handoff-new', title: '新任务', status: { phase: 'running', label: 'running', active: true, indicator: 'green' } },
  );
  const merged = mergeDirectoryProjects(previous.projects, next.projects);
  assert.deepEqual(merged[0].conversations.map(row => row.threadId), ['A', 'old-task', 'new-task']);
  assert.equal(merged[0].status.active, true);
});

test('one thread stays one row and archived or removed tasks do not revive', () => {
  const running = taskDirectory('running', '正在处理后台任务', '11', '任务运行中', '运行摘要');
  running.projects[0].conversations.push({
    ...running.projects[0].conversations.at(-1), title: '重复完成项',
    status: { phase: 'completed', label: '已完成', active: false }, active: false,
  });
  let merged = mergeDirectoryProjects([], running.projects);
  let rows = taskRow(merged);
  assert.equal(rows.name, '重复完成项');
  assert.equal(rows.active, false);
  assert.equal(buildConversationDirectory({ statusByThread: {}, contextByThread: {}, projects: merged }, [], false)
    .all.filter(item => item.threadId === taskThread).length, 1);

  const archived = taskDirectory('completed', '已完成', '12', '任务已完成', '完成摘要');
  archived.projects[0].conversations.at(-1).archived = true;
  merged = mergeDirectoryProjects(merged, archived.projects);
  assert.equal(buildConversationDirectory({ statusByThread: {}, contextByThread: {}, projects: merged }, [], false)
    .all.some(item => item.threadId === taskThread), false);

  const removed = directory();
  removed.projects[0].mainThreadId = 'A';
  merged = mergeDirectoryProjects(merged, removed.projects);
  const cached = new Map([[taskThread, session(taskThread, '不应复活', '15')]]);
  assert.equal(buildConversationDirectory({ statusByThread: {}, contextByThread: {}, projects: merged }, [], false, '', cached)
    .all.some(item => item.threadId === taskThread), false);
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
