import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../../web-ui/node_modules/typescript/lib/typescript.js';

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
  globalThis[key] = { ...hooks, ...dependencies };
  const source = ts.transpileModule(await fs.readFile(new URL(`../../web-ui/src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/import \{([^}]+)\} from "[^"]+";/g, (_, names) => `const {${names}} = globalThis.${key};`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  delete globalThis[key];
  globalThis.window = { setTimeout, clearTimeout };
  return (name, id) => { cursor = 0; return module[name](id); };
}

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

test('last successful settings survive an early runtime event and deliberate choice wins late reads', async () => {
  let gate = deferred();
  const render = await harness('features/context-management/hooks/useContextManagement.ts', {
    readLocalCache: () => null, writeLocalCache() {}, readModelCatalog: () => [], readModelDefaults: () => ({}),
    resolveVisibleModel: (_models, _defaults, model) => model,
    resolveVisibleEffort: (_models, _defaults, _model, effort) => effort,
    contextApi: { status: () => gate.promise },
  });
  const saved = { type: 'context_status', threadId: 'a', model: 'wrong', reasoningEffort: 'low', lastSuccessfulSettings: { model: 'group::saved', reasoningEffort: 'high' } };
  let hook = render('useContextManagement', 'a');
  const first = hook.refresh();
  hook.handleEvent({ ...saved, lastSuccessfulSettings: undefined });
  gate.resolve(saved); await first;
  hook = render('useContextManagement', 'a');
  assert.equal(hook.status.model, 'group::saved');
  hook.handleEvent({ ...saved, reasoningEffort: 'low' });
  assert.equal(render('useContextManagement', 'a').status.reasoningEffort, 'high');
  gate = deferred();
  const late = hook.refresh();
  hook.applyModelSettings('a', { model: 'group::chosen', reasoningEffort: 'medium' });
  gate.resolve(saved); await late;
  assert.equal(render('useContextManagement', 'a').status.model, 'group::chosen');
});

test('first send creates one draft with final settings and survives navigating away during model application', async () => {
  let selectedId = 'a';
  const selectedIdRef = { current: selectedId };
  const sessions = new Map([['a', { threadId: 'a', model: 'default', messages: [] }]]);
  const select = id => { selectedId = id; selectedIdRef.current = id; };
  const calls = []; const gate = deferred();
  const noop = () => {};
  const context = { status: { threadId: 'a', model: 'default', reasoningEffort: 'high' }, applyModelSettings: noop, markSubmitted: noop };
  const render = await harness('features/conversations/hooks/useProjectConversations.ts', {
    currentConversationId: () => 'scope-a', HttpError: Error,
    modelApi: { update: async (...args) => { calls.push(['model', ...args]); await gate.promise; return { threadId: args[0] }; }, updateReasoningEffort: async () => ({}) },
    useContextManagement: () => context,
    useConversationSession: () => ({ selectedId, selectedIdRef, session: sessions.get(selectedId), loadingSession: false,
      setCreatedSession(detail) { sessions.set(detail.threadId, detail); select(detail.threadId); },
      updateCurrentSession(id, update) { sessions.set(id, update(sessions.get(id))); },
      addOptimisticMessage(id, message) { sessions.get(id).messages.push(message); },
      removeOptimisticMessage(id, messageId) { const session = sessions.get(id); if (session) session.messages = session.messages.filter(message => message.id !== messageId); },
      updateOptimisticMessage(id, messageId, patch) { const message = sessions.get(id).messages.find(message => message.id === messageId); if (message) Object.assign(message, patch); },
      loadSession: async () => true, selectSession: select,
    }),
    useConversationCatalog: () => ({ sessions: [], refreshSessions: noop,
      createSession: async (_root, model, _pending, provider) => {
        calls.push(['create', model, provider]); sessions.set('real', { threadId: 'real', model, messages: [] }); return 'real';
      },
    }),
    useCodexExecution: () => ({ status: { active: false }, sendMessage: async (...args) => {
      calls.push(['send', ...args]); return { outcome: 'failed', result: null };
    } }),
    useFollowUpQueue: () => ({}), useThreadGoal: () => ({}), useConversationEvents: () => ({}),
    useModels: () => ({ models: [{ model: 'chosen', modelProviderId: 'provider-chosen' }], clearPending: noop }),
    readInitialConversationState: () => ({}), readModelCatalog: () => [{ model: 'chosen', modelProviderId: 'provider-chosen' }],
    readModelDefaults: () => ({}), useModelDefaults: () => ({}), readLocalCache: () => null,
    resolveVisibleModel: (_models, _defaults, recorded, session) => recorded || session || 'default',
    resolveVisibleEffort: (_models, _defaults, _model, effort) => effort || 'high', providerIdOf: entry => entry.modelProviderId,
    createClientId: () => 'draft', createSubmissionId: () => 'receipt',
    createOptimisticMessage: (text, _files, submissionId) => ({ id: `optimistic-${submissionId}`, role: 'user', text, submissionId }),
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
