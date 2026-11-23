import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from '../node_modules/vite/dist/node/index.js';
import { createHistoryFixture } from '../../windows/tests/history-readonly.fixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const failedFinal = process.env.NEGUS_HISTORY_FAILED_FINAL === '1';
const f = await createHistoryFixture({ legacySuccess: true, failedFinal });
const artifactRoot = path.resolve('work/history-readonly-20261120/sol-fix3', failedFinal ? 'failed-final' : 'normal');
await fs.mkdir(artifactRoot, { recursive: true });
const vite = await createServer({ configFile: false, root: path.resolve('ui-feishu'),
  define: { __APP_BUILD_ID__: JSON.stringify('isolated-history-readonly') }, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react/jsx-runtime', 'react/jsx-dev-runtime', 'react', 'react-dom/client'] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd()] } } });
await vite.listen();
const origin = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 480, height: 950 }, isMobile: true, hasTouch: true });
page.setDefaultTimeout(10000);
const errors = [], calls = [], timings = [];
let coldModelCounters;
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const sources = [];
  window.EventSource = class { constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); } close() {} };
  window.emitHistory = event => sources.at(-1)?.onmessage?.({ data: JSON.stringify(event) });
  window.historyConnectionCount = () => sources.length;
  window.disconnectHistory = () => sources.at(-1)?.onerror?.();
});
// Observe the actual store without replacing its readers, commit or pagination behavior.
await page.route('**/useProjectConversations.ts*', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()).replace('store: selection.store,', 'store: (window.historyTestStore = selection.store),') });
});
const summary = { threadId: f.id, source: 'codex', title: '隔离历史对话', cwd: f.root, updatedAt: new Date().toISOString(),
  modelProviderId: 'ccswitch_removed', model: 'ccswitch_removed::model-a', messageCount: 96, latestMessage: 'assistant history 47', latestUser: '', latestAssistant: 'assistant history 47' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
await page.route('**/api/**', async route => {
  const req = route.request(), url = new URL(req.url()), pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return route.continue();
  const body = req.method() === 'POST' && pathname !== '/api/uploads' ? req.postDataJSON() : null;
  calls.push({ pathname, method: req.method(), query: url.search });
  if (pathname === '/api/model-defaults' || pathname === '/api/model-channels' || pathname === '/api/models' || pathname === '/api/session' || pathname.startsWith('/api/session/')) {
    const start = performance.now();
    const response = await fetch(f.base + pathname + url.search, { method: req.method(), ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const content = await response.text();
    timings.push({ pathname, query: url.search, status: response.status, ms: Math.round(performance.now() - start), fields: Object.keys(JSON.parse(content)) });
    return route.fulfill({ status: response.status, contentType: 'application/json', body: content });
  }
  let data = {};
  if (pathname === '/api/project') data = { name: '隔离项目', root: f.root, mode: 'interactive' };
  else if (pathname === '/api/project-directory') data = { projects: [] };
  else if (pathname === '/api/sessions') data = [summary];
  else if (pathname === '/api/group/rooms') data = { rooms: [] };
  else if (pathname === '/api/uploads') data = { id: 'photo', name: 'fixture.png', mimeType: 'image/png', url: '/api/media/photo', size: png.length };
  else if (pathname.startsWith('/api/media/')) return route.fulfill({ contentType: 'image/png', body: png });
  return route.fulfill({ json: data });
});
const bubble = text => page.locator('.chat-messages').getByText(text, { exact: true });
const composer = () => page.locator('.chat-composer > div:visible textarea');
const wait = async fn => { const until = Date.now() + 9000; while (!await fn()) { if (Date.now() > until) throw new Error('condition timed out'); await page.waitForTimeout(30); } };
const read = () => page.evaluate(id => window.historyTestStore.get(id), f.id);
const refresh = async () => { const close = page.getByRole('button', { name: '关闭对话详情', exact: true }); if (await close.isVisible()) await close.click(); await page.getByRole('button', {name:'返回消息列表',exact:true}).click(); await page.getByRole('button',{name:'刷新会话',exact:true}).click(); await page.getByText('隔离历史对话',{exact:true}).first().click(); };
try {
  await page.goto(`${origin}?thread=${f.id}`);
  await bubble(failedFinal ? 'B final before aborted' : 'assistant history 47').waitFor();
  assert.equal((await read()).session.messages.length, 30);
  assert.equal(f.calls.client, 0); assert.equal(f.calls.credentials, 0);
  await page.getByRole('button', { name: '对话详情', exact: true }).click();
  await page.getByText('已删除配置A · model-a', { exact: true }).waitFor();
  await page.screenshot({ path: `${artifactRoot}/cold-history.png` });
  await wait(() => calls.some(call => call.pathname === '/api/model-defaults'));
  await wait(() => page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('negus-model-defaults-shared-v1'))?.value)));
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('negus-model-defaults-shared-v1')).value), { providerId: '', model: '', effort: '', archivedProviderIds: [] });
  assert.equal(calls.filter(call => ['/api/models', '/api/model-channels'].includes(call.pathname)).length, 0);
  assert.deepEqual(f.modelCalls, { credentials: 0, currentConfig: 0, rpc: 0, initialization: 0, wake: 0 });
  coldModelCounters = { ...f.modelCalls };
  console.log('PASS real defaults/channels/models wiring: cold open and details read persisted data with empty defaults, zero credentials and wake');
  if (!failedFinal) {
  await page.reload(); await bubble('assistant history 47').waitFor();
  assert.equal(calls.filter(call => call.pathname === '/api/models').length, 0);
  assert.deepEqual(f.modelCalls, { credentials: 0, currentConfig: 0, rpc: 0, initialization: 0, wake: 0 });
  await fs.utimes(f.original, new Date('2030-01-01'), new Date('2030-01-01'));
  await refresh(); await bubble('assistant history 47').waitFor();
  // Real scroll container, all the way to the first record through the existing handler.
  for (let n = 0; n < 4 && (await read()).session.hasMore; n++) {
    await page.locator('[class*="scrollArea"]').evaluate(element => { element.scrollTop = 1; element.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(300);
    await page.locator('[class*="scrollArea"]').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(300);
  }
  await wait(async () => !(await read()).session.hasMore);
  let state = await read();
  assert.equal(state.session.messages.length, 96); assert.equal(new Set(state.session.messages.map(m => m.id)).size, 96);
  assert.deepEqual(state.session.messages.map(m => m.id), f.expected.map(m => m.id));
  await bubble('user history 0').waitFor();
  await page.screenshot({ path: `${artifactRoot}/oldest-page.png` });
  console.log('PASS cold deleted channel; original 96 records / four pages; names, timestamps and media preserved');
  assert.deepEqual(f.modelCalls, { credentials: 0, currentConfig: 0, rpc: 0, initialization: 0, wake: 0 });
  coldModelCounters = { ...f.modelCalls };
  // Credential rejection from the real model-settings HTTP entry; draft and photo remain retryable.
  await page.locator('.chat-composer > div:visible input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  await composer().fill('失败后重试正文'); await composer().press('Enter');
  await wait(() => f.calls.credentials > 0);
  await wait(async () => await composer().inputValue() === '失败后重试正文');
  assert.equal(f.calls.client, 0); assert.equal(f.calls.sends, 0);
  assert.ok(await page.locator('.chat-composer > div:visible').getByText('fixture.png', { exact: false }).count());
  f.controls.configured = true; f.controls.sendFail = true;
  await composer().press('Enter'); await wait(() => f.calls.sends > 0);
  await wait(async () => await composer().inputValue() === '失败后重试正文');
  assert.ok(await page.locator('.chat-composer > div:visible').getByText('fixture.png', { exact: false }).count());
  await page.screenshot({ path: `${artifactRoot}/failed-retry.png` });
  console.log('PASS missing credentials creates no sender; uploaded photo and text restored after actual send rejection');
  // A completes, next model B fails. Display must stay A, including after reload.
  f.controls.sendFail = false;
  await composer().press('Enter'); await wait(() => f.calls.sends > 1);
  await fs.appendFile(f.file, [ { type: 'event_msg', payload: { type: 'task_started', turn_id: 'successful-turn' } }, { type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'message', role: 'assistant', id: 'fresh-A', phase: 'final_answer', content: [{type:'output_text',text:'A latest persisted reply'}] } } ].map(JSON.stringify).join("\n")+"\n");
  await f.primary.handleProtocolMessage({ method: 'turn/completed', params: { threadId: f.id, turn: { id: 'successful-turn', status: 'completed' } } });
  f.execution.handleProtocolMessage({ method: 'turn/completed', params: { threadId: f.id, turn: { id: 'successful-turn', status: 'completed' } } });
  await page.evaluate(event => window.emitHistory(event), f.execution.getStatus(f.id));
  await refresh();
  if (!(await page.getByText('配置A · model-a', { exact: true }).isVisible())) await page.getByRole('button', { name: '对话详情', exact: true }).click(); await page.getByText('配置A · model-a', { exact: true }).waitFor(); await page.getByRole('button', {name:'关闭对话详情',exact:true}).click();
  await page.getByRole('button', { name: /Model-A.*High/i }).first().click();
  const modelSelect = page.getByRole('dialog', { name: '模型设置' }).locator('select').first();
  await wait(async () => await modelSelect.locator('option[value="ccswitch_removed::model-b"]').count() > 0);
  assert.ok(f.modelCalls.rpc > 0 && f.modelCalls.credentials > 0);
  const writesBeforeSelection = calls.filter(call => call.pathname === '/api/session/model').length;
  const channelSelect = page.getByRole('combobox', { name: '配置', exact: true });
  await channelSelect.selectOption('ccswitch_second');
  await wait(async () => await modelSelect.inputValue() === 'ccswitch_second::model-a');
  await channelSelect.selectOption('ccswitch_removed');
  assert.equal(calls.filter(call => call.pathname === '/api/session/model').length, writesBeforeSelection, 'configuration selection stays a draft');
  await modelSelect.selectOption('ccswitch_removed::model-b'); await page.keyboard.press('Escape');
  f.controls.sendFail = true; const sends = f.calls.sends;
  await composer().fill('B失败不覆盖A'); await composer().press('Enter');
  await wait(() => f.calls.sends > sends); await wait(async () => await composer().inputValue() === 'B失败不覆盖A');
  const catalogReads = calls.filter(call => call.pathname === '/api/models').length;
  await page.reload(); await bubble('A latest persisted reply').waitFor();
  assert.equal(calls.filter(call => call.pathname === '/api/models').length, catalogReads);
  await page.getByRole('button', { name: '对话详情', exact: true }).click();
  await page.getByText('配置A · model-a', { exact: true }).waitFor();
  assert.ok((await read()).session.messages.some(message => message.text === 'A latest persisted reply'));
  console.log('PASS real catalog wiring, configuration/model selection as drafts; A success / B failure / reload preserves A without automatic catalog refresh');
  // Slow goal preserves old value while ready content publishes; same request completes afterwards.
  f.controls.goalDelay = 700;
  const before = timings.length;
  await refresh();
  await wait(() => timings.slice(before).some(t => t.fields.includes('details')));
  assert.equal((await read()).goal.objective, 'fixture goal');
  await wait(() => timings.slice(before).some(t => t.query.includes('details=')));
  assert.equal((await read()).goal.objective, 'fixture goal');
  f.controls.goalFail = true;
  await refresh();
  await page.waitForTimeout(800); assert.equal((await read()).goal.objective, 'fixture goal');
  f.controls.goalDelay = 0; f.controls.goalFail = false;
  await refresh(); await page.waitForTimeout(200);
  assert.equal((await read()).goal.objective, 'fixture goal');
  console.log('PASS 120ms partial delivery, late goal and disk failure preserve previous values; recovery succeeds');
  f.controls.goalDelay = 280; f.controls.revisionDelay = 160;
  const crossVersionStart = timings.length, revisionReads = f.controls.revisionReads;
  await refresh();
  await wait(() => timings.slice(crossVersionStart).some(t => t.fields.includes('details')));
  await wait(() => f.controls.revisionReads > revisionReads);
  await fs.appendFile(f.file, [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'late-version' } },
    { type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'message', role: 'assistant', id: 'late-version-reply', phase: 'final_answer', content: [{ type: 'output_text', text: '跨版本刷新后的正文' }] } },
  ].map(JSON.stringify).join('\n') + '\n');
  await wait(() => timings.slice(crossVersionStart).some(t => t.fields.includes('refreshBody')));
  await bubble('跨版本刷新后的正文').waitFor();
  assert.equal((await read()).goal.objective, 'fixture goal');
  assert.ok(timings.slice(crossVersionStart).find(t => t.fields.includes('details')).ms < 230);
  console.log('PASS slow version checks fit first-packet budget; cross-version continuation keeps goal and existing refresh reloads body');
  const turnId = 'steer-live';
  const text = '运行中同文追加';
  const sentIds = [];
  const write = (...entries) => fs.appendFile(f.file, entries.map(JSON.stringify).join('\n') + '\n');
  await write({ type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } });
  f.execution.handleProtocolMessage({ method: 'turn/started', params: { threadId: f.id, turn: { id: turnId } } });
  await page.evaluate(event => window.emitHistory(event), f.execution.getStatus(f.id));
  await wait(async () => (await read()).executionStatus.active);
  f.controls.steer = async (_thread, turn, message, _attachments, submissionId) => {
    assert.equal(turn, turnId); assert.equal(message, text);
    sentIds.push(submissionId);
    const timestamp = new Date().toISOString();
    await write({ type: 'response_item', timestamp, payload: { type: 'message', role: 'user', id: `msg-${submissionId}`,
      content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: {
        turn_id: turn, content_item_kinds: ['user.text'], content_item_metadata: [{ provenance: { type: 'user' } }],
      } } }, { type: 'event_msg', timestamp, payload: { type: 'item_completed', turn_id: turn, completed_at_ms: Date.parse(timestamp),
        item: { type: 'UserMessage', id: `item-${submissionId}`, client_id: submissionId, content: [{ type: 'text', text }] } } });
    return {};
  };
  const seen = async count => {
    await wait(async () => (await read()).session?.messages.filter(message => message.text === text && !message.id.startsWith('optimistic-')).length === count);
    assert.equal(await bubble(text).count(), count);
    assert.deepEqual((await read()).session.messages.filter(message => message.text === text).map(message => message.submissionId), sentIds);
  };
  for (const count of [1, 2]) {
    await composer().fill(text);
    const sent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/message');
    await page.getByRole('button', { name: '插入发送', exact: true }).click();
    assert.equal((await sent).status(), 202);
    await wait(() => sentIds.length === count);
    await page.evaluate(event => window.emitHistory(event), { type: 'sessions_changed', threadId: f.id });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await seen(count);
  }
  const connections = await page.evaluate(() => window.historyConnectionCount());
  await page.evaluate(() => window.disconnectHistory());
  await page.waitForFunction(previous => window.historyConnectionCount() > previous, connections);
  await page.evaluate(() => window.emitHistory({ type: 'connected', eventId: 1, gap: true }));
  await seen(2);
  await page.reload();
  await seen(2);
  console.log('PASS active turn: one click yields one bubble, two equal sends have distinct IDs, reconnect and reload retain both');

  } else {
    assert.equal((await read()).contextStatus.lastSuccessfulSettings.reasoningEffort, 'high');
    console.log('PASS cold legacy A success / B final_answer then aborted displays A/model-a with A effort');
    await page.getByRole('button', { name: '关闭对话详情', exact: true }).click();
    await page.locator('.chat-composer > div:visible input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
    await composer().fill('旧会话附图失败后重试');
    const draftRemains = async () => {
      assert.equal(await composer().inputValue(), '旧会话附图失败后重试');
      assert.ok(await page.locator('.chat-composer > div:visible').getByText('fixture.png', { exact: false }).count());
    };
    const reloadWithA = async () => {
      await page.reload(); await bubble('B final before aborted').waitFor();
      const failed = (await read()).session.messages.find(m => m.text === '旧会话附图失败后重试');
      assert.ok(failed); assert.ok(failed.blocks.some(b => b.type === 'image'));
      await page.getByRole('button', { name: '对话详情', exact: true }).click();
      await page.getByText('已删除配置A · model-a', { exact: true }).waitFor();
      assert.equal((await read()).contextStatus.lastSuccessfulSettings.reasoningEffort, 'high');
      await page.getByRole('button', { name: '关闭对话详情', exact: true }).click();
    };
    await composer().press('Enter');
    await wait(() => timings.some(t => t.status === 503)); await draftRemains();
    assert.equal(f.calls.client, 0); assert.equal(f.calls.sends, 0);
    await reloadWithA();
    await page.locator('.chat-composer > div:visible input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
    await composer().fill('旧会话附图失败后重试');
    f.controls.configured = true; f.controls.sendFail = true;
    await composer().press('Enter');
    await wait(() => timings.some(t => t.pathname === '/api/session/message' && t.status === 500));
    await wait(async () => await composer().inputValue() === '旧会话附图失败后重试'); await draftRemains();
    await reloadWithA();
    const saved = JSON.parse(await fs.readFile(`${f.root}/routes.json`, 'utf8'))[f.id].lastSuccessfulSettings;
    assert.equal(saved.model, 'ccswitch_removed::model-a'); assert.equal(saved.providerName, '已删除配置A');
    await page.screenshot({ path: `${artifactRoot}/failed-reload-draft.png` });
    console.log('PASS same mobile legacy conversation: 503 and sender 500, failure restores draft; reload retains failed text/photo record and A/model-a');
    await page.getByRole('button', { name: /Model-A.*High/i }).first().click();
    const select = page.getByRole('dialog', { name: '模型设置' }).locator('select').first();
    await wait(async () => await select.locator('option[value="ccswitch_removed::model-b"]').count() > 0);
    await select.selectOption('ccswitch_removed::model-b'); await page.keyboard.press('Escape');
    await page.locator('.chat-composer > div:visible input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
    await composer().fill('旧会话附图失败后重试');
    f.controls.sendFail = false; const sends = f.calls.sends;
    await composer().press('Enter'); await wait(() => f.calls.sends > sends);
    await wait(async () => await composer().inputValue() === '');
    assert.equal((await f.primary.getRuntimeContext(f.id)).lastSuccessfulSettings.model, 'ccswitch_removed::model-a');
    const info = await f.history.findSession(f.id, 'all', { metadataOnly: true });
    await fs.appendFile(info.path, [
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'successful-turn' } },
      { type: 'turn_context', payload: { model: 'model-b', effort: 'high', turn_id: 'successful-turn' } },
      { type: 'response_item', timestamp: '2026-11-21T00:00:02Z', payload: { type: 'message', role: 'assistant', id: 'successful-b-reply', phase: 'final_answer', internal_chat_message_metadata_passthrough: { turn_id: 'successful-turn' }, content: [{ type: 'output_text', text: 'B successful retry reply' }] } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'successful-turn' } },
    ].map(JSON.stringify).join('\n') + '\n');
    await f.primary.handleProtocolMessage({ method: 'turn/completed', params: { threadId: f.id, turn: { id: 'successful-turn', status: 'completed' } } });
    f.execution.handleProtocolMessage({ method: 'turn/completed', params: { threadId: f.id, turn: { id: 'successful-turn', status: 'completed' } } });
    await page.reload(); await bubble('B successful retry reply').waitFor();
    await page.getByRole('button', { name: '对话详情', exact: true }).click();
    await page.getByText('配置A · model-b', { exact: true }).waitFor();
    assert.equal(await composer().inputValue(), '');
    assert.equal(await page.locator('.chat-composer > div:visible').getByText('fixture.png', { exact: false }).count(), 0);
    await page.screenshot({ path: `${artifactRoot}/successful-retry.png` });
    console.log('PASS same mobile retry: accepted send retains A; matching successful completion updates model-b and clears sent draft');

  }
  if (!failedFinal) {
    // Hold upload open: neither the queue nor group can use a server reply to pass this assertion.
    for (const kind of ['queue', 'group']) {
      if (kind === 'group') {
        await page.route('**/api/group/snapshot*', route => route.fulfill({ json: { room: { id: 'room-a', name: '群' },
          messages: [], agents: [], members: [], activeWorks: [] } }));
        await page.goto(new URL('/validation/group-workspace.html',origin).href);
      } else await page.getByRole('button', { name: '等候队列', exact: true }).last().click();
      let release, received;
      const gate = new Promise(r => { release = r; });
      const observed = new Promise(r => { received = r; });
      const file = { id: 'photo-confirmed', name: 'photo.png', mimeType: 'image/png', url: '/api/media/photo' };
      await page.route('**/api/uploads?*', async route => { await gate; await route.fulfill({ json: file }); });
      const endpoint = kind === 'group' ? '/api/group/message' : '/api/session/queue';
      const text = kind + ' 带图发送';
      await page.route('**' + endpoint, async route => {
        const body = route.request().postDataJSON();
        const now = new Date().toISOString();
        const data = kind === 'group' ? { message: { ...body, id:'confirmed', authorId:body.memberId, type:'human', createdAt:now, attachments:[file] } }
          : {items:[{...body, id:body.submissionId, state:'pending', attachments:[file], createdAt:now, updatedAt:now, position:0}]};
        await route.fulfill({json:data}); received(body);
      });
      const input = page.locator('textarea:visible').last();
      await input.fill(text);
      await page.locator('input[type=file]').last().setInputFiles({ name:file.name, mimeType:file.mimeType, buffer:png });
      await page.getByRole('button',{name:kind === 'group' ? '发送' : '加入等候队列', exact:true}).last().click();
      try {
        await bubble(text).waitFor();
        assert.equal(await bubble(text).count(),1);
        assert.ok(await page.locator('.chat-messages img[src^="blob:"]').count());
      } finally { release(); }
      assert.deepEqual((await observed).attachmentIds,[file.id]);
      if (kind === 'group') await page.locator('[data-message-id="confirmed"]').waitFor();
      await bubble(text).waitFor(); assert.equal(await bubble(text).count(),1);
      console.log('PASS',kind,'photo and text in transcript before upload, one row after confirmation');
    }
    const attempts = [];
    await page.route('**/api/group/message', async route => {
      const body = route.request().postDataJSON();
      attempts.push(body);
      if (attempts.length === 1) return route.fulfill({ status: 409, json: { error: '测试拒收' } });
      return route.fulfill({ json: { message: { ...body, id:'retried', type:'human', authorId:body.memberId,
        createdAt:new Date().toISOString(), attachments:[] } } });
    });
    const field = page.locator('textarea:visible').last();
    await field.fill('重新发送');
    await field.press('Shift+Enter');
    assert.equal(attempts.length, 0);
    await field.press('Enter');
    await page.locator('.chat-messages').getByText('测试拒收', {exact:true}).waitFor();
    await page.getByRole('button', { name:'重新确认指令' }).click();
    await page.locator('[data-message-id="retried"]').waitFor();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].clientMessageId, attempts[1].clientMessageId);
    assert.equal(await bubble('重新发送').count(), 1);
    console.log('PASS group Enter sends, Shift+Enter keeps draft; failed send retries with original identity and one confirmed row');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${artifactRoot}/browser-evidence.json`, JSON.stringify({ calls, timings, counters: f.calls, coldModelCounters, modelCounters: f.modelCalls, pages: failedFinal ? 1 : 4, messages: failedFinal ? 97 : 96, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${artifactRoot}/browser-failure.png` });
  console.error(errors, calls.slice(-10), (await page.locator('body').innerText()).slice(-3500));
  throw error;
} finally { await page.goto("about:blank"); await page.unrouteAll({behavior:"wait"}); await browser.close(); await vite.close(); await f.close(); }
