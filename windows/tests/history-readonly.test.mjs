import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHistoryFixture } from './history-readonly.fixture.mjs';

test('normal HTTP history entry: cold removed-provider, every page, compressed/fork/legacy, errors and no sender', async t => {
  const f = await createHistoryFixture(); t.after(f.close);
  const times = [];
  for (let i = 0; i < 9; i++) {
    const start = performance.now();
    const { status, value } = await f.request(`/api/session?threadId=${f.id}&limit=30&view=1`);
    times.push(Math.round((performance.now() - start) * 100) / 100);
    assert.equal(status, 200); assert.equal(value.details, undefined);
    assert.equal(value.session.messages.length, 30); assert.equal(value.context.usedTokens, 123);
    assert.equal(value.context.lastSuccessfulSettings.providerName, '已删除配置A'); assert.equal(value.goal.objective, 'fixture goal');
  }
  const latest = (await f.request(`/api/session?threadId=${f.id}&limit=30&view=1`)).value;
  const bodies = f.calls.body;
  const cached = await f.request(`/api/session?threadId=${f.id}&limit=30&view=1&sourceRevision=${encodeURIComponent(latest.sourceRevision)}`);
  assert.equal(cached.value.session, null); assert.equal(f.calls.body, bodies);
  let page = latest.session, messages = page.messages, pages = 1;
  while (page.hasMore) {
    page = (await f.request(`/api/session?threadId=${f.id}&limit=30&before=${page.nextBefore}`)).value;
    messages = [...page.messages, ...messages]; pages++;
  }
  assert.equal(pages, 4); assert.equal(new Set(messages.map(m => m.id)).size, 96);
  assert.deepEqual(messages.map(({ id, text, role, createdAt, itemId }) => ({ id, text, role, createdAt, itemId })), f.expected);
  assert.ok(messages.at(-2).blocks.some(b => b.type === 'image')); assert.equal(messages.at(-1).authorName, '原助手');
  const packed = await f.request('/api/session?threadId=packed&limit=30'); assert.equal(packed.value.messages.length, 30);
  const fork = await f.request('/api/session?threadId=fork&limit=30'); assert.equal(fork.value.forkedFromId, f.id); assert.equal(fork.value.messages.length, 4);
  assert.equal((await f.request('/api/session?threadId=empty&limit=30')).value.messages.length, 0);
  assert.equal((await f.request('/api/session?threadId=missing&limit=30')).status, 404);
  assert.equal((await f.request('/api/session?threadId=broken&limit=30')).status, 500);
  assert.equal((await f.request('/api/session?threadId=forbidden&limit=30')).status, 403);
  assert.deepEqual({ ...f.calls, body: 0 }, { client: 0, credentials: 0, refresh: 0, sends: 0, resumes: 0, body: 0 });
  console.log('DETAIL_TIMES_MS', JSON.stringify(times), 'PAGES', pages, 'MESSAGES', messages.length);
});

test('slow details release ready body at 120ms, complete same work, preserve errors and recover changed revision', async t => {
  const f = await createHistoryFixture(); t.after(f.close);
  f.controls.goalDelay = 250;
  const start = performance.now();
  const first = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  const elapsed = performance.now() - start;
  assert.ok(elapsed >= 110 && elapsed < 240); assert.ok(first.details); assert.equal(first.session.messages.length, 30);
  assert.equal(Object.hasOwn(first, 'goal'), false);
  const bodies = f.calls.body;
  const late = (await f.request(`/api/session?threadId=${f.id}&view=1&details=${first.details}`)).value;
  assert.equal(late.goal.objective, 'fixture goal'); assert.equal(f.calls.body, bodies);
  f.controls.goalFail = true;
  const partial = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  const failure = (await f.request(`/api/session?threadId=${f.id}&view=1&details=${partial.details}`)).value;
  assert.match(failure.detailErrors.goal.message, /disk failure/); assert.equal(Object.hasOwn(failure, 'goal'), false);
  f.controls.goalFail = false;
  const changed = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  await fs.appendFile(f.file, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count' } }) + '\n');
  const changedResult = await f.request(`/api/session?threadId=${f.id}&view=1&details=${changed.details}`);
  assert.equal(changedResult.status, 200); assert.equal(changedResult.value.refreshBody, true);
  assert.equal(changedResult.value.goal.objective, 'fixture goal');
  assert.equal(Object.hasOwn(changedResult.value, 'session'), false);
  f.controls.goalDelay = 0;
  assert.equal((await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value.goal.objective, 'fixture goal');
  console.log('PARTIAL_MS', Math.round(elapsed));
});

test('invalid selected credentials reject before sender; A succeeds B fails and restart preserves A display', async t => {
  const f = await createHistoryFixture(); t.after(f.close);
  const failed = await f.request('/api/session/message', { threadId: f.id, text: 'retry me', attachmentIds: ['photo'] });
  assert.equal(failed.status, 503); assert.equal(f.calls.client, 0); assert.equal(f.calls.sends, 0); assert.equal(f.calls.resumes, 0);
  f.controls.configured = true;
  assert.equal((await f.request('/api/session/message', { threadId: f.id, text: 'A succeeds' })).status, 202);
  await f.primary.handleProtocolMessage({ method: 'turn/completed', params: { threadId: f.id, turn: { id: 'successful-turn', status: 'completed' } } });
  const success = (await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings;
  assert.equal(success.providerName, '配置A');
  assert.equal((await f.request('/api/session/model', { threadId: f.id, model: 'ccswitch_removed::model-b', reasoningEffort: 'high' })).status, 200);
  f.controls.sendFail = true;
  assert.equal((await f.request('/api/session/message', { threadId: f.id, text: 'B fails' })).status, 500);
  assert.deepEqual((await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings, success);
  const persisted = JSON.parse(await fs.readFile(`${f.root}/routes.json`, 'utf8'))[f.id];
  assert.deepEqual(persisted.lastSuccessfulSettings, success);
});

test('running and terminal messages join disk history without acquiring a reader client', async t => {
  const f = await createHistoryFixture(); t.after(f.close);
  const cachedRevision = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value.sourceRevision;
  f.execution.handleProtocolMessage({ method: 'turn/started', params: { threadId: f.id, turn: { id: 'live-turn' } } });
  f.execution.handleProtocolMessage({ method: 'item/agentMessage/delta', params: { threadId: f.id, turnId: 'live-turn', itemId: 'live-item', delta: 'live reply' } });
  let view = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  assert.equal(view.status.active, true); assert.equal(view.session.messages.length, 30);
  f.execution.handleProtocolMessage({ method: 'item/completed', params: { threadId: f.id, turnId: 'live-turn', item: { type: 'agentMessage', id: 'live-item', text: 'live reply', phase: 'final_answer' } } });
  f.execution.handleProtocolMessage({ method: 'turn/completed', params: { threadId: f.id, turn: { id: 'live-turn', status: 'completed' } } });
  view = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30&sourceRevision=${encodeURIComponent(cachedRevision)}`)).value;
  assert.equal(view.status.active, false); assert.equal(view.session.messages.filter(m => m.text === 'live reply').length, 1);
  const lastRevision = view.sourceRevision;
  await fs.appendFile(f.file, [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'live-turn' } },
    { type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'message', role: 'assistant', id: 'live-item', phase: 'final_answer', content: [{ type: 'output_text', text: 'live reply' }] } },
  ].map(JSON.stringify).join('\n') + '\n');
  view = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30&sourceRevision=${encodeURIComponent(lastRevision)}`)).value;
  assert.equal(view.session.messages.filter(m => m.text === 'live reply').length, 1);
  assert.equal(f.calls.client, 0);
});


test('short combined window includes 90ms state; slow body releases ready state then fills body', async t => {
  const f = await createHistoryFixture(); t.after(f.close);
  f.controls.goalDelay = 90;
  const start = performance.now();
  let result = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  assert.equal(result.details, undefined); assert.equal(result.goal.objective, 'fixture goal');
  console.log('COMBINED_90MS', Math.round(performance.now() - start));
  f.controls.goalDelay = 0; f.controls.bodyDelay = 280;
  result = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  assert.equal(Object.hasOwn(result, 'session'), false); assert.ok(result.context); assert.ok(result.details);
  const final = (await f.request(`/api/session?threadId=${f.id}&view=1&details=${result.details}`)).value;
  assert.equal(final.session.messages.length, 30); assert.equal(final.goal.objective, 'fixture goal');
});


test('deleted configuration name is read from saved display metadata without resolving its auth command', async t => {
  const { createProviderConversationStore } = await import('../server/provider-conversation-store.mjs');
  const { default: path } = await import('node:path');
  const f = await createHistoryFixture(); t.after(f.close);
  const directory = path.join(f.root, 'model-providers', 'ccswitch_removed', 'codex-home');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'config.toml'), '[model_providers.ccswitch_removed]\nname = "历史配置名称"\n[model_providers.ccswitch_removed.auth]\ncommand = "never-execute"\n');
  const stateFile = path.join(f.root, 'routes.json');
  const routes = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  delete routes[f.id].lastSuccessfulSettings.providerName;
  await fs.writeFile(stateFile, JSON.stringify(routes));
  const primary = createProviderConversationStore({ stateFile, current: {}, providers: {
    providers: () => [], getClient: () => assert.fail('no client'), refreshShared: () => assert.fail('no refresh'),
  }, historyFor: () => ({ getSessionResumeInfo: async () => ({ path: f.file, cwd: f.root }) }) });
  assert.equal((await primary.getRuntimeContext(f.id)).lastSuccessfulSettings.providerName, '历史配置名称');
});

test('copied history retains the successful source provider, including the unqualified current model', async t => {
  const { createProviderConversationStore } = await import('../server/provider-conversation-store.mjs');
  const f = await createHistoryFixture(); t.after(f.close);
  const stateFile = `${f.root}/copy-routes.json`;
  await fs.writeFile(stateFile, JSON.stringify({ original: { providerId: 'current',
    lastSuccessfulSettings: { model: 'source-model', reasoningEffort: 'high' } } }));
  const options = { stateFile, current: {}, providers: {}, historyFor: () => ({ getSessionResumeInfo: async () => null }) };
  const source = createProviderConversationStore(options);
  const success = (await source.getRuntimeContext('original')).lastSuccessfulSettings;
  assert.equal(success.modelProviderId, 'current');
  await fs.writeFile(stateFile, JSON.stringify({ copy: { providerId: 'target', model: 'target::next-model', lastSuccessfulSettings: success } }));
  const copied = createProviderConversationStore(options);
  assert.deepEqual((await copied.getRuntimeContext('copy')).lastSuccessfulSettings, success);
});

test('whole authorized detail budget includes slow version reads and preserves compatible late states', async t => {
  const f = await createHistoryFixture(); t.after(f.close);
  f.controls.revisionDelay = 160; f.controls.goalDelay = 280;
  const start = performance.now();
  const first = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  const elapsed = performance.now() - start;
  assert.ok(elapsed >= 110 && elapsed < 220, `first packet took ${elapsed}ms`);
  assert.equal(first.session.messages.at(-1).text, 'assistant history 47'); assert.ok(first.details);
  const frozen = JSON.stringify(first);
  await fs.appendFile(f.file, [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'after-snapshot' } },
    { type: 'response_item', timestamp: '2026-11-20T01:00:00Z', payload: { type: 'message', role: 'assistant', id: 'new-record', content: [{ type: 'output_text', text: 'newer disk reply' }] } },
  ].map(JSON.stringify).join('\n') + '\n');
  const late = await f.request(`/api/session?threadId=${f.id}&view=1&details=${first.details}`);
  assert.equal(late.status, 200); assert.equal(late.value.goal.objective, 'fixture goal');
  assert.equal(late.value.refreshBody, true); assert.equal(Object.hasOwn(late.value, 'session'), false);
  assert.equal(Object.hasOwn(late.value, 'context'), false); assert.equal(JSON.stringify(first), frozen);
  f.controls.revisionDelay = 0; f.controls.goalDelay = 0;
  const refreshed = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  assert.equal(refreshed.session.messages.at(-1).text, 'newer disk reply');
  console.log('SLOW_VERSION_FIRST_PACKET_MS', Math.round(elapsed));
});

test('mtime changes cannot reorder complete volumes, metadata or any page', async t => {
  const { latestRolloutFile } = await import('../server/rollout-file.mjs');
  const { default: path } = await import('node:path');
  const f = await createHistoryFixture(); t.after(f.close);
  const originalCopy = path.join(path.dirname(f.file), path.basename(f.original));
  await fs.copyFile(f.original, originalCopy);
  await fs.utimes(f.original, new Date('2030-01-01'), new Date('2030-01-01'));
  await fs.utimes(originalCopy, new Date('2031-01-01'), new Date('2031-01-01'));
  assert.equal(await latestRolloutFile(originalCopy), f.file);
  assert.equal((await f.history.findSession(f.id, 'all', { metadataOnly: true })).path, f.file);
  let page = (await f.request(`/api/session?threadId=${f.id}&limit=30`)).value;
  assert.equal(page.messages.at(-1).text, 'assistant history 47');
  let all = page.messages;
  while (page.hasMore) {
    page = (await f.request(`/api/session?threadId=${f.id}&limit=30&beforeMessageId=${encodeURIComponent(page.messages[0].id)}`)).value;
    all = [...page.messages, ...all];
  }
  assert.deepEqual(all.map(({ id, text, role, createdAt, itemId }) => ({ id, text, role, createdAt, itemId })), f.expected);
});

test('legacy successful A survives failed B in a new volume and a cold reader', async t => {
  const { createProviderConversationStore } = await import('../server/provider-conversation-store.mjs');
  const { createJsonlConversationStore } = await import('../server/jsonl-conversation-store.mjs');
  const { default: path } = await import('node:path');
  const f = await createHistoryFixture({ legacySuccess: true }); t.after(f.close);
  const reader = createJsonlConversationStore({ sessionRoot: path.dirname(f.file), fallbackSessionRoots: [path.dirname(f.original)], projectRoot: f.root });
  t.after(() => reader.close());
  const store = createProviderConversationStore({ stateFile: `${f.root}/routes.json`, current: {}, providers: {},
    historyFor: () => ({ ...reader, getSessionResumeInfo: id => reader.findSession(id, 'all', { metadataOnly: true }) }) });
  assert.equal((await store.findSession(f.id, 'all', { limit: 30 })).messages.at(-1).text, 'assistant history 47');
  assert.equal((await store.getRuntimeContext(f.id)).lastSuccessfulSettings.model, 'ccswitch_removed::model-a');
  assert.equal((await store.getRuntimeContext(f.id)).lastSuccessfulSettings.providerName, '已删除配置A');
});

test('pending input reads skip a sender still initializing and read it after readiness', async t => {
  const { createProviderConversationStore } = await import('../server/provider-conversation-store.mjs');
  const f = await createHistoryFixture(); t.after(f.close);
  let release, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const readyInput = { id: 'pending-input' };
  const store = createProviderConversationStore({ stateFile: `${f.root}/routes.json`, current: {},
    providers: { getClient: async ({ modelProviderId }) => { if (modelProviderId === 'current') return {}; started(); return waiting; } },
    createStore: () => ({ findSession: async () => ({}), getPendingUserInput: () => readyInput }),
    historyFor: () => ({ getSessionResumeInfo: async () => null }) });
  const creating = store.findSessionForProvider('ccswitch_removed', f.id);
  await startedPromise;
  const timeout = Symbol('still waiting');
  assert.equal(await Promise.race([store.getPendingUserInput(f.id), new Promise(resolve => setTimeout(() => resolve(timeout), 80))]), null);
  release({}); await creating;
  assert.deepEqual(await store.getPendingUserInput(f.id), readyInput);
});

test('explicit model catalog entry exercises actual provider and native stores at mock RPC boundaries', async t => {
  const f = await createHistoryFixture(); t.after(f.close);
  await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`);
  assert.deepEqual(f.modelCalls, { credentials: 0, currentConfig: 0, rpc: 0, initialization: 0, wake: 0 });
  f.controls.configured = true;
  const catalog = await f.request('/api/models');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.value.some(model => model.model === 'ccswitch_removed::model-b'));
  assert.ok(f.modelCalls.rpc > 0 && f.modelCalls.credentials > 0);
  assert.equal(f.modelCalls.initialization, 1); assert.equal(f.modelCalls.wake, 1);
});

test('empty persisted defaults use the real defaults route without resolving any sending configuration', async t => {
  const f = await createHistoryFixture(); t.after(f.close);
  const response = await f.request('/api/model-defaults');
  assert.equal(response.status, 200);
  assert.deepEqual(response.value, { providerId: '', model: '', effort: '', archivedProviderIds: [] });
  assert.deepEqual(f.modelCalls, { credentials: 0, currentConfig: 0, rpc: 0, initialization: 0, wake: 0 });
  await fs.mkdir(`${f.root}/runtime`, { recursive: true });
  await fs.writeFile(`${f.root}/runtime/model-defaults.json`, JSON.stringify({ providerId: '', model: '', effort: '', archivedProviderIds: ['deleted'] }));
  assert.deepEqual((await f.request('/api/model-defaults')).value, { providerId: '', model: '', effort: '', archivedProviderIds: ['deleted'] });
});

test('a final answer followed by the same turn abort is not the last successful setting', async t => {
  const f = await createHistoryFixture({ legacySuccess: true, failedFinal: true }); t.after(f.close);
  const result = (await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`)).value;
  assert.equal(result.session.messages.at(-1).text, 'B final before aborted', 'failed output remains readable');
  assert.equal(result.context.lastSuccessfulSettings.model, 'ccswitch_removed::model-a');
  assert.equal(result.context.lastSuccessfulSettings.reasoningEffort, 'high');
  assert.equal(result.context.lastSuccessfulSettings.providerName, '已删除配置A');
});

test('successful history settings use the same turn terminal, retaining old format and completed B', async t => {
  const { latestAssistantReplyAtFromRollout } = await import('../server/app-server-conversation-store.mjs');
  const f = await createHistoryFixture(); t.after(f.close);
  const context = (model, turn_id) => ({ type: 'turn_context', payload: { model, turn_id, effort: model === 'model-a' ? 'high' : 'low' } });
  const reply = turn_id => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', internal_chat_message_metadata_passthrough: { turn_id } } });
  const event = (type, turn_id, extra = {}) => ({ type: 'event_msg', payload: { type, turn_id, ...extra } });
  const legacyA = [context('model-a', 'a'), reply('a')];
  const a = [event('task_started', 'a'), ...legacyA, event('task_complete', 'a')];
  const b = [event('task_started', 'b'), context('model-b', 'b'), reply('b')];
  const cases = [
    [legacyA, 'model-a', 'high'],
    [[...legacyA, ...b, event('turn_aborted', 'b')], 'model-a', 'high'],
    [[...a, ...b, event('turn_aborted', 'b')], 'model-a', 'high'],
    [[...a, ...b, event('task_complete', 'b', { status: 'failed' })], 'model-a', 'high'],
    [[...a, ...b, event('task_complete', 'b')], 'model-b', 'low'],
    [[...a, ...b, event('task_complete', 'b'), event('turn_aborted', 'b')], 'model-a', 'high'],
    [[...a, ...b, event('turn_aborted', 'b'), event('task_complete', 'b')], 'model-b', 'low'],
    [[...a, ...b, context('model-b', 'b'), reply('b')], 'model-a', 'high'],
    [[...a, ...b, event('task_complete', 'b'), event('turn_aborted', 'a')], 'model-b', 'low'],
    [[...a, event('task_started', 'b'), context('model-b'), reply('b'), event('turn_aborted', 'b'), event('task_complete', 'a')], 'model-a', 'high'],
    [[...a, event('task_started', 'b'), context('model-b'), reply('b'), event('task_complete', 'b'), event('turn_aborted', 'a')], 'model-b', 'low'],
    [[context('model-a'), reply()], 'model-a', 'high'],
  ];
  for (const [rows, model, reasoningEffort] of cases) {
    const file = `${f.root}/terminal-case.jsonl`;
    await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
    assert.deepEqual(await latestAssistantReplyAtFromRollout(file, true, false, true), { model, reasoningEffort });
  }
});


test('legacy success migration shares complete volume lookup across send, model and effort writes', async t => {
  for (const action of ['send', 'model', 'effort']) await t.test(action, async t => {
    const f = await createHistoryFixture({ legacySuccess: true, failedFinal: true }); t.after(f.close);
    const success = (await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings;
    assert.equal(success.model, 'ccswitch_removed::model-a');
    const message = { threadId: f.id, text: 'retry with photo', attachmentIds: ['photo'] };
    assert.equal((await f.request('/api/session/message', message)).status, 503);
    assert.deepEqual((await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings, success);
    f.controls.configured = true; f.controls.sendFail = true;
    if (action === 'model') await f.primary.updateModel(f.id, 'ccswitch_removed::model-b', { reasoningEffort: 'low' });
    if (action === 'effort') await f.primary.updateReasoningEffort(f.id, 'low');
    assert.equal((await f.request('/api/session/message', message)).status, 500);
    assert.deepEqual((await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings, success);
    assert.deepEqual(JSON.parse(await fs.readFile(`${f.root}/routes.json`, 'utf8'))[f.id].lastSuccessfulSettings, success);
    await f.primary.updateModel(f.id, 'ccswitch_removed::model-b', { reasoningEffort: 'low' });
    f.controls.sendFail = false;
    assert.equal((await f.request('/api/session/message', message)).status, 202);
    await f.primary.handleProtocolMessage({ method: 'turn/completed', params: { threadId: f.id, turn: { id: 'other-turn', status: 'completed' } } });
    assert.deepEqual((await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings, success);
    await f.primary.handleProtocolMessage({ method: 'turn/completed', params: { threadId: f.id, turn: { id: 'successful-turn', status: 'completed' } } });
    const completed = (await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings;
    assert.equal(completed.model, 'ccswitch_removed::model-b'); assert.equal(completed.providerName, '配置A');
  });
});


test('whole conversation success is invariant under volume boundaries through HTTP and send migration', async t => {
  const event = (type, turn_id) => ({ type: 'event_msg', payload: { type, turn_id } });
  const context = model => ({ type: 'turn_context', payload: { model, effort: model === 'model-a' ? 'high' : 'low' } });
  const reply = (turn_id, text) => ({ type: 'response_item', timestamp: '2026-11-20T00:00:01Z', payload: {
    type: 'message', role: 'assistant', phase: 'final_answer', id: `reply-${turn_id || 'legacy'}`,
    internal_chat_message_metadata_passthrough: { turn_id }, content: [{ type: 'output_text', text }] } });
  const a = [event('task_started', 'a'), context('model-a'), reply('a', 'A success'), event('task_complete', 'a')];
  const b = [event('task_started', 'b'), context('model-b'), reply('b', 'B reply spanning volumes')];
  const cases = [
    ['completion only in successor volume', [...a, ...b, event('task_complete', 'b')], 'model-b', 'low'],
    ['later same-id abort in successor volume', [...a, ...b, event('task_complete', 'b'), event('turn_aborted', 'b')], 'model-a', 'high'],
    ['other-turn late completion and aborted B', [...a, ...b, event('turn_aborted', 'b'), event('task_complete', 'a')], 'model-a', 'high'],
    ['legacy without lifecycle or IDs', [context('model-a'), reply(undefined, 'Legacy A reply')], 'model-a', 'high'],
  ];
  for (const [name, rows, model, reasoningEffort] of cases) await t.test(name, async () => {
    // Unsplit, the exact Sol terminal boundary, every other boundary, then one record per volume.
    const layouts = [[], [rows.length - 1], ...Array.from({ length: rows.length - 2 }, (_, n) => [n + 1]),
      Array.from({ length: rows.length - 1 }, (_, n) => n + 1)];
    let unpartitioned;
    for (const cuts of new Map(layouts.map(cuts => [JSON.stringify(cuts), cuts])).values()) {
      const f = await createHistoryFixture({ legacySuccess: true });
      try {
        const directory = path.dirname(f.file);
        for (const file of await fs.readdir(directory)) if (file.includes(f.id)) await fs.rm(path.join(directory, file));
        await fs.rm(f.original);
        let start = 0;
        for (const [index, end] of [...cuts, rows.length].entries()) {
          const file = path.join(directory, `rollout-${f.id}_part-${index}.jsonl`);
          const meta = { type: 'session_meta', timestamp: new Date(Date.UTC(2026, 10, 20, 0, 0, index)).toISOString(), payload: { id: f.id, cwd: f.root } };
          await fs.writeFile(file, [meta, ...rows.slice(start, end)].map(JSON.stringify).join('\n') + '\n'); start = end;
        }
        const response = await f.request(`/api/session?threadId=${f.id}&view=1&limit=30`);
        assert.equal(response.status, 200);
        const settings = response.value.context.lastSuccessfulSettings;
        assert.equal(response.value.session.messages.at(-1).text, rows.filter(row => row.type === 'response_item').at(-1).payload.content[0].text);
        assert.equal(settings.model, `ccswitch_removed::${model}`, `${name} cuts=${cuts}`);
        assert.equal(settings.reasoningEffort, reasoningEffort);
        unpartitioned ||= settings; assert.deepEqual(settings, unpartitioned);
        assert.equal(f.calls.credentials, 0); assert.equal(f.calls.client, 0);
        assert.deepEqual(f.modelCalls, { credentials: 0, currentConfig: 0, rpc: 0, initialization: 0, wake: 0 });
        f.controls.configured = true; f.controls.sendFail = true;
        assert.equal((await f.request('/api/session/message', { threadId: f.id, text: 'isolated retry' })).status, 500);
        const persisted = JSON.parse(await fs.readFile(`${f.root}/routes.json`, 'utf8'))[f.id].lastSuccessfulSettings;
        assert.deepEqual(persisted, unpartitioned);
        assert.deepEqual((await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings, unpartitioned);
        console.log('VOLUME_INVARIANCE', JSON.stringify({ name, cuts, volumes: cuts.length + 1, status: response.status, model: settings.model, reasoningEffort, migration: 'preserved', credentialsOnRead: 0, wakeOnRead: 0 }));
      } finally { await f.close(); }
    }
  });
});
