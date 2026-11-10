import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ConversationStore } from "./frontend-conversation-store.mjs";
import ts from '../../ui-feishu/node_modules/typescript/lib/typescript.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function harness(file, dependencies) {
  const slots = []; let cursor = 0;
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useCallback: fn => fn, useEffect() {},
  };
  const key = `__conversationState${Math.random().toString(36).slice(2)}`;
  globalThis[key] = { ...hooks, goalCompletionKey: goal => JSON.stringify([goal.createdAt, goal.updatedAt, goal.objective]), ...dependencies };
  const source = ts.transpileModule(await fs.readFile(new URL(`../../ui-feishu/shared/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/import \{([^}]+)\} from "[^"]+";/g, (_, names) => `const {${names}} = globalThis.${key};`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  delete globalThis[key];
  globalThis.window = { setTimeout, clearTimeout };
  const store = new ConversationStore({ cachedSessions: [], partialSessionIds: [] });
  const render = (name, id) => { cursor = 0; return module[name](id, store); };
  render.store = store;
  return render;
}

test('committing server history retains matching local send time across later reads', () => {
  const store = new ConversationStore({ cachedSessions: [], partialSessionIds: [] });
  const local = { id: 'optimistic-send', role: 'user', text: 'same', submissionId: 'send', createdAt: '2026-11-01T15:43:23.000Z' };
  const official = { id: 'native', role: 'user', text: 'same', submissionId: 'send' };
  store.addMessage('t', local);
  store.commit('t', { ...store.empty('t'), session: { threadId: 't', messages: [] } }, 0);
  assert.equal(store.committed.get('t').session.messages.length, 0);
  assert.equal(store.get('t').session.messages.length, 1);
  store.commit('t', { ...store.empty('t'), session: { threadId: 't', messages: [official] } }, 0);
  assert.equal(store.get('t').session.messages.length, 1);
  assert.equal(store.get('t').session.messages[0].createdAt, local.createdAt);
  assert.equal(store.localPending.has('t'), false);
  store.commit('t', { ...store.empty('t'), session: { threadId: 't', messages: [official] } }, 0);
  assert.equal(store.get('t').session.messages[0].createdAt, local.createdAt);
});

test('closing a completed goal ignores a delayed completion event', async () => {
  const gate = deferred();
  const render = await harness('features/goals/hooks/useThreadGoal.ts', {
    currentConversationId: () => '', goalApi: { clear: () => gate.promise },
  });
  const goal = { threadId: 't', status: 'complete', objective: 'done', createdAt: 1, updatedAt: 2 };
  let hook = render('useThreadGoal', 't');
  hook.handleEvent({ type: 'goal_status', threadId: 't', goal });
  hook = render('useThreadGoal', 't');
  const clearing = hook.clear();
  hook.handleEvent({ type: 'goal_status', threadId: 't', goal: null });
  gate.resolve({ goal: null });
  assert.equal(await clearing, true);
  hook.handleEvent({ type: 'goal_status', threadId: 't', goal });
  assert.equal(render('useThreadGoal', 't').goal, null);
  render.store.commit('t', { ...render.store.empty('t'), goal }, 0);
  assert.equal(render('useThreadGoal', 't').goal, null, 'a late batch cannot restore a dismissed completion');
  hook.handleEvent({ type: 'goal_status', threadId: 't', goal: { ...goal, objective: 'new' } });
  assert.equal(render('useThreadGoal', 't').goal.objective, 'new');
});

test('queue acceptance recovers a dispatching item when its submitted event was missed', async () => {
  const render = await harness('features/conversations/hooks/useFollowUpQueue.ts', {
    currentConversationId: () => '', followUpQueueApi: {}, createSubmissionId: () => 'unused',
  });
  const queue = render('useFollowUpQueue', 't');
  const item = {id:'queue',threadId:'t',submissionId:'queued',dispatchSubmissionId:'dispatch',state:'dispatching',text:'with image',sentAt:'2026-10-29T03:42:42Z',attachments:[{id:'image'}]};
  queue.handleEvent({type:'queue_changed',threadId:'t',items:[item]});
  assert.deepEqual(queue.handleEvent({type:'user_message_accepted',threadId:'other',turnId:'turn',submissionId:'dispatch'}),undefined);
  assert.deepEqual(queue.handleEvent({type:'user_message_accepted',threadId:'t',turnId:'turn',submissionId:'dispatch'}),item);
  assert.deepEqual(render('useFollowUpQueue', 't').items,[]);
});

test('enqueue immediately uses the queue and stays after existing items across confirmation', async () => {
  const gate = deferred();
  const render = await harness('features/conversations/hooks/useFollowUpQueue.ts', {
    currentConversationId: () => '', createSubmissionId: () => 'new',
    followUpQueueApi: { enqueue: () => gate.promise },
  });
  const old = { id: 'old', threadId: 't', submissionId: 'old', state: 'pending', text: 'old', attachments: [] };
  render.store.update('t', { queueItems: [old] });
  const sending = render('useFollowUpQueue', 't').enqueue('new');
  let queue = render('useFollowUpQueue', 't');
  assert.deepEqual(queue.items.map(item => item.text), ['old', 'new']);
  assert.equal(render.store.get('t').session?.messages.length || 0, 0, 'waiting messages never enter the timed transcript');
  const local = queue.items[1];
  const confirmed = { ...local, id: 'server-id', createdAt: '2026-11-03T00:00:00Z' };
  queue.handleEvent({ type: 'queue_changed', threadId: 't', items: [old, confirmed] });
  assert.deepEqual(render('useFollowUpQueue', 't').items.map(item => item.text), ['old', 'new']);
  assert.equal(render('useFollowUpQueue', 'other').items.length, 0);
  gate.resolve({ items: [old, confirmed] });
  assert.equal(await sending, true);
  queue = render('useFollowUpQueue', 't');
  assert.deepEqual(queue.items.map(item => item.id), ['old', 'server-id']);
});

test('failed enqueue removes only its local waiting bubble and reports the error', async () => {
  const render = await harness('features/conversations/hooks/useFollowUpQueue.ts', {
    currentConversationId: () => '', createSubmissionId: () => 'new',
    followUpQueueApi: { enqueue: async () => { throw new Error('offline'); } },
  });
  assert.equal(await render('useFollowUpQueue', 't').enqueue('new'), false);
  const queue = render('useFollowUpQueue', 't');
  assert.deepEqual(queue.items, []);
  assert.equal(queue.error, 'offline');
});

test('switching conversations keeps both sends alive and independent', async () => {
  const calls = [];
  const render = await harness('features/execution/hooks/useCodexExecution.ts', {
    createClientId: () => 'submission',
    executionApi: { sendMessage(...args) { const gate = deferred(); calls.push({ args, gate }); return gate.promise; } },
  });
  const a = render('useCodexExecution', 'a');
  const first = a.sendMessage('first', [], 'a-send', 'a', 'scope-a');
  const b = render('useCodexExecution', 'b');
  const second = b.sendMessage('second', [], 'b-send', 'b', 'scope-b');
  assert.deepEqual(calls.map(call => [call.args[0], call.args[5]]), [['a', 'scope-a'], ['b', 'scope-b']]);
  assert.equal(await render('useCodexExecution', 'b').sendMessage('duplicate'), null);
  calls[0].gate.resolve({ threadId: 'a', turnId: 'turn-a', status: 'accepted' });
  assert.equal((await first).outcome, 'accepted');
  assert.equal(render('useCodexExecution', 'b').sending, true);
  calls[1].gate.resolve({ threadId: 'b', turnId: 'turn-b', status: 'accepted' });
  await second;
  assert.equal(render('useCodexExecution', 'b').sending, false);
});

test('last successful settings survive runtime events and local model choice wins a late batch', async () => {
  const render = await harness('features/context-management/hooks/useContextManagement.ts', { contextApi: {} });
  const store = render.store;
  const saved = { ...store.empty('a').contextStatus, model: 'group::saved', reasoningEffort: 'high' };
  let hook = render('useContextManagement', 'a');
  hook.handleEvent({ ...saved, model: 'wrong', reasoningEffort: 'low' });
  store.commit('a', { ...store.empty('a'), contextStatus: saved }, 0);
  assert.equal(render('useContextManagement', 'a').status.model, 'group::saved');
  hook.handleEvent({ ...saved, reasoningEffort: 'low' });
  assert.equal(render('useContextManagement', 'a').status.reasoningEffort, 'high');
  hook.applyModelSettings('a', { model: 'group::chosen', reasoningEffort: 'medium' });
  store.commit('a', { ...store.empty('a'), contextStatus: saved }, 0);
  assert.equal(render('useContextManagement', 'a').status.model, 'group::chosen');
});

test('first send creates one draft with final settings and survives navigating away during model application', async () => {
  let selectedId = 'a';
  const selectedIdRef = { current: selectedId };
  const sessions = new Map([['a', { threadId: 'a', model: 'default', messages: [] }]]);
  const select = id => { selectedId = id; selectedIdRef.current = id; };
  const calls = []; const gate = deferred(); let receiveEvent;
  const noop = () => {};
  const testStore = new ConversationStore({ cachedSessions: [], partialSessionIds: [] });
  const context = { status: { threadId: 'a', model: 'default', reasoningEffort: 'high' }, applyModelSettings: noop, markSubmitted: noop };
  const render = await harness('features/conversations/hooks/useProjectConversations.ts', {
    currentConversationId: () => 'scope-a', HttpError: Error,
    modelApi: { update: async (...args) => { calls.push(['model', ...args]); await gate.promise; return { threadId: args[0] }; }, updateReasoningEffort: async () => ({}) },
    useContextManagement: () => context,
    useConversationSession: () => ({ store: testStore, selectedId, selectedIdRef, session: sessions.get(selectedId), loadingSession: false,
      setCreatedSession(detail) { sessions.set(detail.threadId, detail); select(detail.threadId); },
      updateCurrentSession(id, update) { sessions.set(id, update(sessions.get(id))); },
      addOptimisticMessage(id, message) { if (!sessions.get(id).messages.some(item => item.id === message.id)) sessions.get(id).messages.push(message); },
      removeOptimisticMessage(id, messageId) { const session = sessions.get(id); if (session) session.messages = session.messages.filter(message => message.id !== messageId); },
      updateOptimisticMessage(id, messageId, patch) { const message = sessions.get(id).messages.find(message => message.id === messageId); if (message) Object.assign(message, patch); },
      loadSession: async () => true, selectSession: select,
    }),
    useConversationCatalog: () => ({ sessions: [], refreshSessions: noop,
      createSession: async (_root, model, _pending, provider) => {
        calls.push(['create', model, provider]); sessions.set('real', { threadId: 'real', model, messages: [] }); return 'real';
      },
    }),
    useCodexExecution: () => ({ status: { active: false }, handleEvent: noop, sendMessage: async (...args) => {
      calls.push(['send', ...args]); return { outcome: 'failed', result: null };
    } }),
    useFollowUpQueue: () => ({handleEvent: event => event.type === 'user_message_accepted' && event.submissionId === 'queued-dispatch'
      ? {text:'queued image',attachments:[{id:'image'}],sentAt:'2026-10-29T03:42:43Z'} : undefined}), useThreadGoal: () => ({handleEvent: noop}),
    useConversationEvents: (_changed, handler) => { receiveEvent = handler; return {}; },
    useModels: () => ({ models: [{ model: 'chosen', modelProviderId: 'provider-chosen' }], clearPending: noop }),
    readInitialConversationState: () => ({}), readModelCatalog: () => [{ model: 'chosen', modelProviderId: 'provider-chosen' }],
    readModelDefaults: () => ({}), useModelDefaults: () => ({}), readLocalCache: () => null,
    resolveVisibleModel: (_models, _defaults, recorded, session) => recorded || session || 'default',
    resolveVisibleEffort: (_models, _defaults, _model, effort) => effort || 'high', providerIdOf: entry => entry.modelProviderId,
    createClientId: () => 'draft', createSubmissionId: () => 'receipt',
    createOptimisticMessage: (text, files, submissionId, createdAt) => ({ id: `optimistic-${submissionId}`, role: 'user', text, submissionId, createdAt, blocks:files }),
    isPendingThread: id => id.startsWith('pending:'),
  });
  window.location = { search: '' };
  let hook = render('useProjectConversations');
  hook.openNewSession('', '', '', { deferred: true });
  assert.equal(calls.length, 0);
  hook = render('useProjectConversations');
  await hook.changeModel('chosen', 'high');
  hook = render('useProjectConversations');
  const sending = hook.sendMessage('hello', [{ id: 'attachment' }]);
  await new Promise(setImmediate);
  receiveEvent({type:'user_message_submitted',threadId:'real',messageId:'optimistic-receipt',submissionId:'receipt',text:'hello',attachments:[],createdAt:'2026-10-29T03:42:42Z'});
  assert.equal(sessions.get('real').messages[0].createdAt,'2026-10-29T03:42:42Z');
  assert.equal(sessions.get('real').messages[0].serverTimestamp,true);
  assert.equal(sessions.get('real').messages.length,1);
  receiveEvent({type:'user_message_accepted',threadId:'real',turnId:'turn',submissionId:'queued-dispatch'});
  assert.equal(sessions.get('real').messages[1].text,'queued image');
  assert.equal(sessions.get('real').messages[1].blocks[0].id,'image');
  assert.equal(sessions.get('real').messages[1].serverTimestamp,true);
  select('b'); sessions.set('b', { threadId: 'b', model: 'another', messages: [] });
  render('useProjectConversations');
  gate.resolve();
  assert.equal(await sending, true);
  assert.deepEqual(calls[0], ['create', 'chosen', 'provider-chosen']);
  assert.equal(calls.filter(call => call[0] === 'create').length, 1);
  const sent = calls.find(call => call[0] === 'send');
  assert.deepEqual(sent.slice(1), ['hello', ['attachment'], 'receipt', 'real', 'scope-a']);
  assert.equal(selectedId, 'b');
  assert.equal(sessions.get('real').messages[0].deliveryState, 'failed');
});

test('realtime recovery rechecks the selected session once and applies backend terminal state', async () => {
  let recover; const calls = []; let sessionRefreshes = 0;
  const store = new ConversationStore({ cachedSessions: [], partialSessionIds: [] });
  const selectedIdRef = { current: 'task' };
  const noop = () => {};
  const deferredA = deferred(), deferredB = deferred();
  let gates = [deferredA, deferredB];
  let backendStatus = {
    type: 'execution_status', threadId: 'task', turnId: 'turn-recovered', phase: 'completed',
    label: 'Codex 已完成', detail: '', commentary: '', streamingItemId: '', streamingText: '',
    activities: [], active: false, hasFinalAnswer: true, startedAt: null, updatedAt: '2026-11-09T15:10:10Z',
  };
  store.update('task', { executionStatus: {
    ...backendStatus, phase: 'working', label: 'Codex 正在处理任务', active: true,
    streamingText: '断线前残留', hasFinalAnswer: false,
  } }, true);
  const loadSession = (id, options) => {
    calls.push([id, options]);
    return gates.shift().promise.then(() => {
      const empty = store.empty(id);
      store.commit(id, { ...empty, session: { threadId: id, title: '恢复任务', messages: [
        { id: 'final', role: 'assistant', text: '最终答复', createdAt: '2026-11-09T15:10:10Z' },
      ] }, executionStatus: backendStatus }, store.revisions.get(id) || 0);
      return true;
    });
  };
  const selection = {
    store, selectedId: 'task', selectedIdRef, loadingSession: false,
    get session() { return store.get('task', false).session; },
    cachedSessions: new Map(),
    loadSession, loadOlder: noop, selectSession: noop, setSessionError: noop,
    addOptimisticMessage: noop, updateOptimisticMessage: noop, removeOptimisticMessage: noop,
  };
  const execution = {
    get status() { return store.get('task').executionStatus; },
    get streamingText() { return store.get('task').executionStatus.streamingText || ''; },
    commentaryText: '', sending: false, sendingSlow: false,
    handleEvent: noop, sendMessage: async () => null, interrupt: async () => false,
    refreshStatus: async () => store.get('task').executionStatus,
  };
  const render = await harness('features/conversations/hooks/useProjectConversations.ts', {
    currentConversationId: () => 'scope-task', HttpError: Error,
    conversationApi: {}, executionApi: {}, modelApi: {},
    useContextManagement: () => ({ status: { threadId: 'task', model: 'model', reasoningEffort: 'high', phase: 'idle', updatedAt: null },
      applyModelSettings: noop, handleEvent: noop, markSubmitted: noop, completeSettings: noop }),
    useConversationSession: () => selection,
    useConversationCatalog: () => ({ sessions: [], archivedView: false, initialSyncReady: true,
      refreshSessions: async () => { sessionRefreshes += 1; return []; }, setArchiveViewMode: noop,
      createSession: async () => '', archiveSession: noop, unarchiveSession: noop,
      archivedByThread: {}, archivedBusyIds: new Set() }),
    useCodexExecution: () => execution,
    useFollowUpQueue: () => ({ items: [], loading: false, busy: false, error: '', handleEvent: noop }),
    useThreadGoal: () => ({ goal: null, busy: false, handleEvent: noop }),
    useConversationEvents: (_changed, _handler, recovery) => { recover = recovery; return true; },
    useModels: () => ({ models: [{ model: 'model', modelProviderId: 'provider' }], loading: false, changing: false, error: '',
      clearPending: noop, change: async () => true, changeReasoningEffort: async () => true, applyPending: async () => true }),
    readInitialConversationState: () => ({}), readModelCatalog: () => [],
    readModelDefaults: () => ({}), useModelDefaults: () => ({}),
    resolveVisibleModel: (_models, _defaults, recorded, session) => recorded || session || 'model',
    resolveVisibleEffort: (_models, _defaults, _model, effort) => effort || 'high',
    providerIdOf: entry => entry.modelProviderId, readLocalCache: () => null,
    createClientId: () => 'id', createSubmissionId: () => 'submission',
    createOptimisticMessage: () => ({}), isPendingThread: id => id.startsWith('pending:'),
  });
  globalThis.window = {
    ...globalThis.window, location: { search: '?thread=task', pathname: '/' },
    history: { replaceState() {} }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
  };

  let hook = render('useProjectConversations');
  assert.equal(hook.executionStatus.active, true);
  const first = recover('resumed');
  const second = recover('reconnected');
  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.equal(sessionRefreshes, 1);
  deferredA.resolve(); assert.equal(await first, true);
  hook = render('useProjectConversations');
  assert.equal(hook.executionStatus.active, false);
  assert.equal(hook.executionStatus.phase, 'completed');
  assert.equal(hook.executionStatus.hasFinalAnswer, true);
  assert.equal(hook.executionStatus.streamingText, '');

  backendStatus = { ...backendStatus, phase: 'working', label: 'Codex 正在处理任务', active: true,
    hasFinalAnswer: false, updatedAt: '2026-11-09T15:11:00Z' };
  const working = recover('resumed');
  deferredB.resolve(); assert.equal(await working, true);
  hook = render('useProjectConversations');
  assert.equal(hook.executionStatus.active, true);
  assert.equal(calls.filter(call => call[1]?.recovery).length, 2);
});

for (const phase of ['completed', 'failed']) test(`late send response cannot replace ${phase} received in real time`, async () => {
  const gate = deferred();
  const render = await harness('features/execution/hooks/useCodexExecution.ts', {
    createClientId: () => 'submission',
    executionApi: { sendMessage: () => gate.promise },
  });
  const h = render('useCodexExecution', 'a');
  const sent = h.sendMessage('message', [], `late-${phase}`);
  h.handleEvent({ type: 'execution_status', threadId: 'a', turnId: 'new-turn', phase,
    active: false, activities: [], label: phase, detail: phase === 'failed' ? 'quota exceeded' : '',
    notices: phase === 'failed' ? ['quota exceeded'] : [], startedAt: new Date().toISOString() });
  gate.resolve({ threadId: 'a', turnId: 'new-turn', status: 'inProgress' });
  assert.equal((await sent).outcome, 'accepted');
  const status = render('useCodexExecution', 'a').status;
  assert.equal(status.phase, phase);
  assert.equal(status.active, false);
});

test('accepted new turn drops old failure notices without erasing steering progress', async () => {
  const render = await harness('features/execution/hooks/useCodexExecution.ts', {
    createClientId: () => 'new-send', executionApi: { sendMessage: async () => ({threadId:'retry-error',turnId:'new-turn',status:'accepted'}) },
  });
  let h = render('useCodexExecution','retry-error');
  h.handleEvent({type:'execution_status',threadId:'retry-error',turnId:'old-turn',phase:'failed',active:false,notices:['403 quota'],detail:'403 quota',label:'failed',activities:[]});
  h = render('useCodexExecution','retry-error');
  await h.sendMessage('继续',[],'new-send');
  h = render('useCodexExecution','retry-error');
  assert.equal(h.status.phase,'working');
  assert.equal(h.status.detail,'');
  assert.equal(h.status.notices?.length || 0,0);
  h.handleEvent({type:'execution_status',threadId:'retry-error',turnId:'new-turn',phase:'tool',active:true,notices:['current warning'],detail:'current tool',label:'tool',activities:[]});
  h = render('useCodexExecution','retry-error');
  await h.sendMessage('补充',[],'steer-send');
  h = render('useCodexExecution','retry-error');
  assert.deepEqual(h.status.notices,['current warning']);
  assert.equal(h.status.phase,'tool');
});
