import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const stamp = '2026-11-01T00:00:00Z', calls = [], errors = [];
const summaries = ['ordinary', 'employee'].map(threadId => ({ threadId, source: 'codex', sourceRevision: 'r1', title: threadId,
  cwd: threadId === 'employee' ? '/employee-private' : '/business', updatedAt: stamp, messageCount: null,
  latestMessage: `old ${threadId}`, latestUser: '', latestAssistant: `old ${threadId}`, model: 'model-a' }));
const details = id => ({ ...summaries.find(s => s.threadId === id), messages: [{ id: `m-${id}`, role: 'assistant', text: `old ${id}`, createdAt: stamp }] });
const idle = id => ({ type: 'execution_status', threadId: id, phase: 'idle', active: false, turnId: '', activities: [], updatedAt: stamp });
const contexts = new Map(summaries.map(s => [s.threadId, { type: 'context_status', threadId: s.threadId, model: 'model-a', reasoningEffort: 'high',
  usedTokens: s.threadId === 'employee' ? 230 : 120, contextWindow: 1000, percentage: s.threadId === 'employee' ? 23 : 12, phase: 'idle', updatedAt: stamp, autoCompactThreshold: 80, message: '' }]));
let employeeTime = stamp, employeePreview = 'old employee', directoryFailures = 0, directoryReads = 0, releaseCompact, slowContext = false;
const projects = () => [{ id: 'personal', kind: 'personal', root: '/personal', name: '个人项目', conversations: [] },
  { id: 'employee-project', kind: 'employee', employeeId: 'developer', root: '/employee-private', name: '开发员工', mainThreadId: 'employee', mainConversationId: 'employee-direct',
    lastActivityAt: employeeTime, conversations: [{ id: 'employee', threadId: 'employee', conversationId: 'employee-direct', main: true, title: '开发员工', latestMessage: employeePreview, latestMessageAt: employeeTime, status: idle('employee') }] }];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(({ summaries, details, stamp }) => {
  const sources = [];
  window.EventSource = class { constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); } close() {} };
  window.emitFixture = event => sources.forEach(s => s.onmessage?.({ data: JSON.stringify(event) }));
  localStorage.setItem('negus-conversation-snapshot-v1', JSON.stringify({ version: 1, savedAt: stamp, selectedId: 'ordinary', sessions: summaries,
    session: details[0], recentSessions: [{ savedAt: stamp, session: details[1] }] }));
}, { summaries, details: summaries.map(s => details(s.threadId)), stamp });
// Test-only access to the real store lets us remove context while keeping warmed body/signatures.
await page.route('**/useProjectConversations.ts*', async route => {
  const response = await route.fetch();
  const body = (await response.text()).replace('store: selection.store,', 'store: (window.fixtureStore = selection.store),');
  await route.fulfill({ response, body });
});
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname;
  if (!path.startsWith('/api/')) return route.continue();
  const body = request.method() === 'POST' ? request.postDataJSON() : null;
  const id = url.searchParams.get('threadId') || body?.threadId || 'ordinary';
  calls.push({ path, method: request.method(), id, query: url.search, body });
  let data = {};
  if (path === '/api/project') data = { name: '个人项目', root: '/personal', mode: 'interactive' };
  else if (path === '/api/project-directory') {
    directoryReads++;
    if (directoryFailures-- > 0) return route.abort('timedout');
    data = { projects: projects() };
  } else if (path === '/api/sessions') data = summaries;
  else if (path === '/api/models') data = [{ id: 'model-a', model: 'model-a', displayName: '模型A', available: true, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }];
  else if (path === '/api/model-defaults') data = { providerId: 'current', model: 'model-a', effort: 'high', archivedProviderIds: [] };
  else if (path === '/api/model-channels') data = { channels: [] };
  else if (path === '/api/group/rooms') data = { rooms: [] };
  else if (path === '/api/session/context/compact') { data = await new Promise(resolve => { releaseCompact = resolve; }); }
  else if (path === '/api/session' && request.method() === 'POST') {
    data = { ...summaries[0], threadId: 'created', title: '新对话', cwd: body.projectRoot, messageCount: 0 };
    summaries.push(data); contexts.set('created', { ...contexts.get('ordinary'), threadId: 'created' });
  } else if (path === '/api/session/message') data = { threadId: id, turnId: 'fixture-turn', status: 'accepted' };
  else if (path === '/api/session') data = { session: url.searchParams.get('sourceRevision') === details(id).sourceRevision ? null : details(id), sourceRevision: details(id).sourceRevision, historyFormatVersion: 4,
    context: contexts.get(id), status: idle(id), goal: null, queue: [], input: null };
  if (path === '/api/session' && request.method() === 'GET' && slowContext) {
    // Hold the aggregate while a same-thread live event reaches the actual Store.
    await page.evaluate(id => {
      const store = window.fixtureStore;
      store.update(id, { contextStatus: { ...store.get(id).contextStatus, message: 'during slow read' } }, true);
    }, id);
    await page.waitForTimeout(250);
  }
  await route.fulfill({ json: data });
});
const bodyReads = () => calls.filter(c => c.path === '/api/session' && c.method === 'GET').length;
const row = name => page.getByRole('button', { name, exact: true });
const settle = () => page.waitForTimeout(500);
try {
  await page.goto('http://127.0.0.1:5201/?thread=ordinary');
  await page.getByRole('button', { name: '上下文 0.1k / 1k（12%）', exact: true }).waitFor();
  await page.waitForFunction(() => window.fixtureStore?.synced.has('employee'));
  await settle();
  assert.equal(calls.some(c => c.method === 'POST'), false);
  for (const [id, name, usage] of [['employee', '打开开发员工单聊', '上下文 0.2k / 1k（23%）'], ['ordinary', '打开ordinary', '上下文 0.1k / 1k（12%）']]) {
    await page.evaluate(id => {
      const store = window.fixtureStore, view = store.committed.get(id);
      store.update(id, { contextStatus: { ...view.contextStatus, usageSourceRevision: undefined, usedTokens: null, percentage: null, updatedAt: id === 'ordinary' ? view.contextStatus.updatedAt : null } });
    }, id);
    const before = bodyReads();
    await row(name).click();
    await page.getByRole('button', { name: usage, exact: true }).waitFor();
    await settle();
    assert.equal(bodyReads(), before + 1, 'missing context gets one selection calibration');
    assert.match(calls.filter(c => c.path === '/api/session').at(-1).query, /sourceRevision=r1/);
    assert.equal(calls.some(c => c.method === 'POST'), false, 'usage appears before any send');
  }
  const warmed = bodyReads();
  await row('打开开发员工单聊').click(); await settle();
  await row('打开ordinary').click(); await settle();
  assert.equal(bodyReads(), warmed, 'complete context and body caches need no selection reads');
  console.log('PASS ordinary + employee missing context with cached body: one calibration each; complete cache A/B: zero reads');

  const savedContexts = new Map(contexts);
  slowContext = true;
  for (const [id, name] of [['employee', '打开开发员工单聊'], ['ordinary', '打开ordinary']]) {
    contexts.set(id, { ...contexts.get(id), usedTokens: null, percentage: null });
    await page.evaluate(id => {
      const store = window.fixtureStore, view = store.committed.get(id);
      if (view.session.messageCount !== null || !view.session.messages.length) throw Error('must exercise paginated cached body');
      store.update(id, { contextStatus: { ...view.contextStatus, usedTokens: null, percentage: null, usageSourceRevision: undefined } });
    }, id);
    const before = bodyReads(); await row(name).click(); await settle();
    assert.equal(bodyReads(), before + 1, 'server without usage is calibrated once');
    assert.equal(await page.evaluate(id => window.fixtureStore.get(id).contextStatus.usageSourceRevision, id), 'r1');
    assert.match(calls.filter(c => c.path === '/api/session').at(-1).query, /sourceRevision=r1/);
  }
  slowContext = false;
  for (const [id, value] of contexts) await page.evaluate(event => window.emitFixture(event), { ...value, message: 'later status' });
  await settle();
  for (const id of ['ordinary', 'employee']) assert.equal(await page.evaluate(id => window.fixtureStore.get(id).contextStatus.usageSourceRevision, id), 'r1');
  const noUsageReads = bodyReads();
  for (let n = 0; n < 2; n++) {
    await row('打开开发员工单聊').click(); await settle();
    await row('打开ordinary').click(); await settle();
  }
  assert.equal(bodyReads(), noUsageReads, 'confirmed absence of usage must survive repeated A/B switching');
  // The same selection path must permit one new calibration after model/body change.
  for (const change of ['model', 'body']) {
    await row('打开开发员工单聊').click(); await settle();
    await page.evaluate(change => {
      const store = window.fixtureStore, view = store.committed.get('ordinary');
      store.update('ordinary', change === 'model'
        ? { contextStatus: { ...view.contextStatus, model: 'model-b', usageSourceRevision: undefined } }
        : { contextStatus: { ...view.contextStatus, usageSourceRevision: 'r0' } });
    }, change);
    const before = bodyReads();
    await row('打开ordinary').click(); await settle();
    assert.equal(bodyReads(), before + 1, `${change} permits one calibration`);
    assert.equal(await page.evaluate(() => window.fixtureStore.get('ordinary').contextStatus.usageSourceRevision), 'r1');
    await row('打开开发员工单聊').click(); await settle();
    await row('打开ordinary').click(); await settle();
    assert.equal(bodyReads(), before + 1, `${change} calibration does not repeat`);
  }
  console.log('PASS slow live merge retains marker; later event and two A/B rounds zero reads; model/body change calibrate once');
  for (const [id, value] of savedContexts) { contexts.set(id, value); await page.evaluate(event => window.emitFixture(event), value); }
  await settle();
  console.log('PASS messageCount:null cached ordinary/employee body; usage absent -> exactly one calibration each, repeated A/B zero reads');

  await page.getByRole('button', { name: '上下文 0.1k / 1k（12%）', exact: true }).click();
  const clickedAt = Date.now(), beforeCompact = bodyReads();
  await page.getByRole('button', { name: '立即压缩', exact: true }).click();
  await page.getByRole('button', { name: '正在压缩', exact: true }).waitFor();
  const started = await page.evaluate(() => window.fixtureStore.get('ordinary').contextStatus);
  assert.ok(Date.parse(started.compactionUpdatedAt) >= clickedAt);
  assert.equal(started.updatedAt, stamp, 'client start must not impersonate a server timestamp');
  const localClock = await page.evaluate(value => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)), started.compactionUpdatedAt);
  assert.equal(await row('打开ordinary').locator('time').textContent(), localClock);
  const serverStart = { ...contexts.get('ordinary'), phase: 'compacting', compactionRevision: 1, updatedAt: '2026-11-05T08:00:00Z', compactionUpdatedAt: '2026-11-05T08:00:00Z' };
  await page.evaluate(event => window.emitFixture(event), serverStart); await settle();
  assert.equal(await page.evaluate(() => window.fixtureStore.get('ordinary').contextStatus.compactionUpdatedAt), serverStart.updatedAt);
  assert.equal(await row('打开ordinary').locator('time').textContent(), '11/5');
  assert.equal(bodyReads(), beforeCompact, 'click and server start do not read body');
  const completed = { ...serverStart, phase: 'completed', compactionRevision: 2, usedTokens: 40, percentage: 4 };
  contexts.set('ordinary', completed);
  await page.evaluate(event => window.emitFixture(event), completed);
  await settle();
  releaseCompact(serverStart); // deliberately late POST response must not roll back completion
  await settle();
  assert.equal(await page.evaluate(() => window.fixtureStore.get('ordinary').contextStatus.phase), 'completed');
  assert.equal(await row('打开ordinary').locator('time').textContent(), '11/5');
  assert.equal(bodyReads(), beforeCompact + 1, 'completion retains exactly one existing body calibration');
  for (const revision of [undefined, 2, 1]) {
    await page.evaluate(event => window.emitFixture(event), { ...serverStart, compactionRevision: revision }); await settle();
    assert.equal(await page.evaluate(() => window.fixtureStore.get('ordinary').contextStatus.phase), 'completed');
  }
  assert.equal(bodyReads(), beforeCompact + 1, 'same/lower/missing revision starts cannot add reads or roll back terminal');
  await page.evaluate(event => window.emitFixture(event), { ...serverStart, compactionRevision: 3 }); await settle();
  assert.equal(await page.evaluate(() => window.fixtureStore.get('ordinary').contextStatus.phase), 'compacting');
  assert.equal(bodyReads(), beforeCompact + 1, 'higher revision new start still adds no body read');
  contexts.set('ordinary', { ...completed, compactionRevision: 4 });
  await page.evaluate(event => window.emitFixture(event), contexts.get('ordinary')); await settle();
  assert.equal(bodyReads(), beforeCompact + 2, 'second completion adds only its one calibration');
  await page.evaluate(event => window.emitFixture(event), { ...serverStart, compactionRevision: 5 }); await settle();
  const failed = { ...serverStart, phase: 'failed', message: 'fixture compaction failed', compactionRevision: 6 };
  contexts.set('ordinary', failed); await page.evaluate(event => window.emitFixture(event), failed); await settle();
  for (const revision of [undefined, 5, 6]) {
    await page.evaluate(event => window.emitFixture(event), { ...serverStart, compactionRevision: revision }); await settle();
    assert.equal(await page.evaluate(() => window.fixtureStore.get('ordinary').contextStatus.phase), 'failed');
  }
  assert.equal(bodyReads(), beforeCompact + 2, 'failure and rejected starts add no body reads');
  await page.evaluate(event => window.emitFixture(event), { ...serverStart, compactionRevision: 7 }); await settle();
  assert.equal(await page.evaluate(() => window.fixtureStore.get('ordinary').contextStatus.phase), 'compacting');
  contexts.set('ordinary', { ...completed, compactionRevision: 8 });
  await page.evaluate(event => window.emitFixture(event), contexts.get('ordinary')); await settle();
  assert.equal(bodyReads(), beforeCompact + 3, 'higher revision after failure completes with one calibration');
  await page.keyboard.press('Escape');
  console.log('PASS same-millisecond completion beats delayed POST and equal/missing revision; higher revision starts next compaction');
  console.log('PASS immediate client start -> server clock -> completed; delayed POST cannot roll back; zero start reads, one terminal read');

  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByText('新建对话', { exact: true }).click();
  await page.waitForFunction(() => [...window.fixtureStore.committed.keys()].some(id => id.startsWith('pending:')));
  assert.equal(await page.evaluate(() => [...window.fixtureStore.committed].find(([id]) => id.startsWith('pending:'))[1].session.cwd), '/business');
  assert.equal(calls.filter(c => c.path === '/api/session' && c.method === 'POST').length, 0);
  await row('打开ordinary').click(); await settle();
  console.log('PASS ordinary business conversation -> new draft retains its business root without creating a thread');

  const beforeDirectory = directoryReads;
  directoryFailures = 1; employeeTime = '2026-11-09T00:00:00Z'; employeePreview = '设备A保存的新回答';
  await page.evaluate(() => window.emitFixture({ type: 'employee_turn_completed', employeeId: 'developer', threadId: 'employee', turnId: 'done', status: 'completed' }));
  await row('打开开发员工单聊').getByText('设备A保存的新回答', { exact: true }).waitFor();
  assert.equal(await row('打开开发员工单聊').locator('time').textContent(), '11/9');
  await settle();
  assert.equal(directoryReads, beforeDirectory + 2, 'one failed refresh + one recovery');
  await page.waitForTimeout(1200);
  assert.equal(directoryReads, beforeDirectory + 2, 'no continuing polling');
  // Repeated total failure stops; a later completion recovers through the same shared resource.
  directoryFailures = 2;
  await page.evaluate(() => window.emitFixture({ type: 'employee_turn_completed', employeeId: 'developer', threadId: 'employee', turnId: 'failure', status: 'completed' }));
  await settle(); const stopped = directoryReads;
  await settle(); assert.equal(directoryReads, stopped);
  assert.equal(await row('打开开发员工单聊').getByText('设备A保存的新回答', { exact: true }).count(), 1);
  employeePreview = '恢复后回答'; employeeTime = '2026-11-10T00:00:00Z';
  await page.evaluate(() => window.emitFixture({ type: 'employee_turn_completed', employeeId: 'developer', threadId: 'employee', turnId: 'recovered', status: 'completed' }));
  await row('打开开发员工单聊').getByText('恢复后回答', { exact: true }).waitFor();
  console.log('PASS device B completion + timeout recovery: latest preview/time; total failure bounded, cache retained, later completion recovers');

  await row('打开开发员工单聊').click();
  await page.locator('.chat-workspace h1').getByText('开发员工', { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByText('新建对话', { exact: true }).click();
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('agent'));
  await page.locator('.chat-workspace').getByText('新对话', { exact: true }).waitFor();
  const params = new URL(page.url()).searchParams;
  for (const key of ['agent', 'employee', 'employeeId', 'conversation']) assert.equal(params.has(key), false);
  assert.equal(await page.locator('.chat-workspace').getByText('开发员工', { exact: true }).count(), 0);
  assert.equal(calls.filter(c => c.path === '/api/session' && c.method === 'POST').length, 0, 'new conversation remains deferred');
  const composer = page.locator('.chat-composer > div:visible textarea');
  await composer.fill('isolated fixture send'); await composer.press('Enter');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('thread') === 'created');
  await settle();
  const creation = calls.find(c => c.path === '/api/session' && c.method === 'POST');
  assert.equal(creation.body.projectRoot, '/personal');
  assert.equal(creation.body.conversationId, undefined);
  const sent = calls.find(c => c.path === '/api/session/message');
  assert.equal(sent?.body.threadId, 'created'); assert.equal(sent?.body.conversationId, undefined);
  assert.equal(calls.some(c => c.path.includes('/employees/') && c.method === 'POST'), false);
  assert.deepEqual(errors, []);
  console.log('PASS employee -> new ordinary conversation: clean URL/header, personal root, deferred create, ordinary send without employee scope');
} catch (error) { console.log(JSON.stringify({ calls, errors, text: await page.locator('body').innerText(), context: await page.evaluate(() => window.fixtureStore?.get('ordinary').contextStatus) })); throw error; } finally { await browser.close(); }
