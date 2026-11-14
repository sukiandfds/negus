import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.setDefaultTimeout(7000);
const stamp = '2026-11-01T00:00:00Z', errors = [], calls = [], sends = [];
const summaries = ['a', 'b'].map(id => ({ threadId: id, source: 'codex', sourceRevision: 'r0', title: `对话${id}`, updatedAt: stamp,
  messageCount: 1, latestUser: '', latestAssistant: '', latestMessage: `历史${id}`, model: 'model-a' }));
const messages = new Map(summaries.map(s => [s.threadId, [{ id: `history-${s.threadId}`, role: 'assistant', text: `历史${s.threadId}`, createdAt: stamp }]]));
const queues = new Map(), statuses = new Map(), settings = new Map(), goals = new Map(), inputs = new Map();
const idle = id => ({ type: 'execution_status', threadId: id, phase: 'idle', active: false, turnId: '', activities: [], startedAt: null, updatedAt: stamp, label: '', detail: '', commentary: '' });
const context = id => ({ type: 'context_status', threadId: id, model: 'model-a', reasoningEffort: 'high', phase: 'idle', percentage: 10, usedTokens: 10, contextWindow: 100, autoCompactThreshold: 80, updatedAt: stamp, message: '', ...settings.get(id) });
const detail = id => ({ ...summaries.find(s => s.threadId === id), messages: messages.get(id) || [] });
const photo = { id: 'photo', name: 'photo.png', mimeType: 'image/png', url: '/api/media/photo', size: 68 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let sendMode = 'accepted', holdSend = false, releaseSend, releaseCreate, holdCreate = false, pageRequest;
let holdRead = false, releaseRead, heldId = '', readGate, failRead = false, failedReads = 0;
const receipt = new Map();
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(({ summaries, details, stamp }) => {
  if (!localStorage.getItem('negus-conversation-snapshot-v1')) localStorage.setItem('negus-conversation-snapshot-v1', JSON.stringify({ version: 1, savedAt: stamp,
    selectedId: 'a', sessions: summaries, session: details[0], recentSessions: [{ savedAt: stamp, isPartial: true,
      session: { ...details[1], sourceSignature: JSON.stringify(summaries[1]), messages: [{ ...details[1].messages[0], text: '缓存截断b' }] } }] }));
  const sources = []; window.sources = sources;
  window.EventSource = class { constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); } close() {} };
  window.emit = event => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(event) }));
}, { summaries, details: summaries.map(s => detail(s.threadId)), stamp });
const acceptedMessage = body => ({ id: `native-${body.submissionId}`, submissionId: body.submissionId, role: 'user', text: body.text,
  turnId: `turn-${body.submissionId}`, createdAt: new Date().toISOString(), blocks: body.attachmentIds?.length ? [{ id: `text-${body.submissionId}`, type: 'markdown', text: body.text }, { id: `image-${body.submissionId}`, type: 'image', source: photo.url, file: photo }] : undefined });
const record = body => {
  const list = messages.get(body.threadId) || [];
  if (!list.some(message => message.submissionId === body.submissionId)) list.push(acceptedMessage(body));
  messages.set(body.threadId, list);
  const summary = summaries.find(s => s.threadId === body.threadId);
  summary.sourceRevision = `r${list.length}`;
};
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
  if (!path.startsWith('/api/')) return route.continue();
  const body = ['POST', 'DELETE'].includes(method) && path !== '/api/uploads' ? request.postDataJSON() : {};
  const id = url.searchParams.get('threadId') || body?.threadId || 'a';
  calls.push({ path, method, id, view: url.searchParams.get('view'), sourceRevision: url.searchParams.get('sourceRevision'), body });
  let data = {};
  if (path === '/api/project') data = { name: '项目', root: '/fixture', mode: 'interactive' };
  else if (path === '/api/project-directory') data = { projects: [] };
  else if (path === '/api/sessions') data = summaries;
  else if (path === '/api/models') data = [{ id: 'model-a', model: 'model-a', displayName: '模型A', available: true, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }, { id: 'model-b', model: 'model-b', displayName: '模型B', available: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }];
  else if (path === '/api/model-defaults') data = { providerId: 'current', model: 'model-a', effort: 'high', archivedProviderIds: [] };
  else if (path === '/api/model-channels') data = { channels: [] };
  else if (path === '/api/group/rooms') data = { rooms: [] };
  else if (path === '/api/uploads') data = photo;
  else if (path === '/api/media/photo') return route.fulfill({ contentType: 'image/png', body: png });
  else if (path === '/api/session/model') { data = { threadId: id, model: body.model, reasoningEffort: body.reasoningEffort || 'high' }; settings.set(id, data); }
  else if (path === '/api/session/reasoning-effort') data = { threadId: id, model: settings.get(id)?.model || 'model-a', reasoningEffort: body.reasoningEffort };
  else if (path === '/api/session/interrupt') { statuses.set(id, idle(id)); data = { threadId: id, status: 'interrupted' }; await page.evaluate(event => window.emit(event), idle(id)); }
  else if (path === '/api/session/goal' && method === 'POST') { const goal = { ...goals.get(id), ...body, updatedAt: Date.now() / 1000 }; goals.set(id, goal); data = { goal }; }
  else if (path === '/api/session/goal' && method === 'DELETE') { goals.delete(id); data = { goal: null }; }
  else if (path === '/api/session/user-input' && method === 'POST') { inputs.delete(id); data = { threadId: id, status: 'answered' }; }
  else if (path === '/api/session/submission') data = receipt.get(url.searchParams.get('submissionId')) || { threadId: id, status: 'unknown' };
  else if (path === '/api/session/message') {
    sends.push(body);
    const mode = sendMode;
    if (holdSend) await new Promise(resolve => releaseSend = resolve);
    if (mode !== 'accepted') {
      const error = mode === 'occupied' ? 'already has an active writer' : '模拟图片发送失败';
      receipt.set(body.submissionId, { threadId: id, submissionId: body.submissionId, status: 'failed', error });
      return route.fulfill({ status: 503, json: { error } });
    }
    record(body);
    receipt.set(body.submissionId, { threadId: id, submissionId: body.submissionId, status: 'accepted', turnId: `turn-${body.submissionId}` });
    data = { threadId: id, turnId: `turn-${body.submissionId}`, status: 'accepted' };
  } else if (path === '/api/session/queue' && method === 'POST') {
    const items = queues.get(id) || [];
    if (body.action === 'remove') queues.set(id, items.filter(item => item.id !== body.itemId));
    else if (body.action === 'sendNow') {
      const item = items.find(entry => entry.id === body.itemId);
      record({ ...item, threadId: id });
      queues.set(id, items.filter(entry => entry.id !== body.itemId));
      await page.evaluate(event => window.emit(event), { type: 'user_message_accepted', threadId: id, submissionId: item.submissionId, turnId: `turn-${item.submissionId}` });
    }
    else { items.push({ id: body.submissionId, ...body, attachments: [], state: 'pending', createdAt: new Date().toISOString() }); queues.set(id, items); }
    data = { items: queues.get(id) };
  } else if (path === '/api/session' && method === 'POST') {
    if (holdCreate) await new Promise(resolve => releaseCreate = resolve);
    data = { ...summaries[0], threadId: 'created', title: '新建的对话', sourceRevision: 'r0', messageCount: 0, model: body.model };
    summaries.push(data); messages.set('created', []);
  } else if (path === '/api/session') {
    if (holdRead && id === heldId) await readGate;
    if (failRead && id === heldId) { failedReads++; return route.fulfill({ status: 503, json: { error: 'fixture read failure' } }); }
    if (url.searchParams.has('cursor')) {
      pageRequest = id;
      data = { ...detail(id), hasMore: false, messages: [{ id: 'older-page', role: 'assistant', text: '翻页读取的更早历史', createdAt: '2026-10-01T00:00:00Z' }] };
    } else {
      const session = { ...detail(id), hasMore: id === 'a', nextCursor: id === 'a' ? 'older' : null };
      data = url.searchParams.get('view') === '1' ? { session: url.searchParams.get('sourceRevision') === session.sourceRevision ? null : session,
        sourceRevision: session.sourceRevision, context: context(id), status: statuses.get(id) || idle(id), goal: goals.get(id) || null, queue: queues.get(id) || [], input: inputs.get(id) || null } : session;
    }
  }
  await route.fulfill({ json: data });
});
const composer = () => page.locator('.chat-composer > div:visible textarea');
const send = async text => { await composer().fill(text); await composer().press('Enter'); };
const open = id => page.getByRole('button', { name: `打开对话${id}`, exact: true }).click();
const bubble = text => page.locator('.chat-messages').getByText(text, { exact: true });
const wait = async predicate => { const deadline = Date.now() + 6500; while (!predicate()) { if (Date.now() > deadline) throw Error('fixture condition timed out'); await page.waitForTimeout(25); } };
const readCache = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('negus-conversations', 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction(['threads', 'metadata'], 'readonly');
    const threads = tx.objectStore('threads').getAll(), metadata = tx.objectStore('metadata').get('snapshot');
    tx.oncomplete = () => { db.close(); resolve({ threads: threads.result, metadata: metadata.result }); };
    tx.onerror = tx.onabort = () => reject(tx.error);
  };
}));
try {
  if (process.env.NEGUS_TEST_INITIAL_STATUS === '1') {
    heldId = 'a'; holdRead = true; readGate = new Promise(resolve => releaseRead = resolve);
  }
  await page.goto('http://127.0.0.1:5201/?thread=a');
  await bubble('历史a').waitFor();
  if (process.env.NEGUS_TEST_INITIAL_STATUS === '1') {
    await wait(() => calls.some(call => call.path === '/api/session' && call.id === 'a'));
    await page.evaluate(event => window.emit(event), { ...idle('a'), phase: 'working', active: true, turnId: 'initial-turn', label: '运行' });
    await page.waitForTimeout(200);
    assert.equal(await page.getByRole('button', { name: '打开对话a' }).getByText('助手正在运行...').count(), 0, 'uncommitted initial status must not cross batch');
    holdRead = false; releaseRead();
    await page.waitForFunction(() => document.querySelector('button[aria-label="刷新会话"]')?.getAttribute('aria-busy') === 'false');
    assert.deepEqual(errors, []);
    console.log('PASS initial uncommitted status remains behind batch');
    await browser.close(); process.exit(0);
  }
  await page.waitForFunction(() => document.querySelector('button[aria-label="刷新会话"]')?.getAttribute('aria-busy') === 'false');
  if (process.env.NEGUS_TEST_LIST_TERMINAL === '1') {
    const running = { ...idle('a'), phase: 'working', active: true, turnId: 'compact-turn', startedAt: stamp, label: '运行' };
    statuses.set('a', running);
    settings.set('a', { phase: 'compacting', message: '正在压缩上下文' });
    await page.evaluate(event => window.emit(event), { ...context('a'), updatedAt: new Date().toISOString() });
    await page.evaluate(event => window.emit(event), running);
    await page.getByRole('button', { name: '打开对话a' }).getByText('正在压缩对话...').waitFor();
    await wait(() => calls.filter(call => call.path === '/api/session' && call.id === 'a').length >= 2);
    await page.waitForTimeout(300);
    heldId = 'a'; holdRead = true; readGate = new Promise(resolve => releaseRead = resolve);
    const completed = { ...running, phase: 'completed', active: false, durationMs: 1000, label: '已完成' };
    statuses.set('a', completed);
    await page.evaluate(event => window.emit(event), completed);
    settings.set('a', { phase: 'completed', message: '上下文压缩完成' });
    await page.evaluate(event => window.emit(event), { ...context('a'), updatedAt: new Date().toISOString() });
    await page.getByText('已完成', { exact: true }).waitFor();
    await page.waitForFunction(() => !/助手正在运行|正在压缩对话/.test(document.querySelector('button[aria-label="打开对话a"]')?.textContent || ''));
    assert.equal(await page.getByRole('button', { name: '打开对话b' }).getByText('助手正在运行...').count(), 0);
    failRead = true; releaseRead();
    await wait(() => failedReads > 0);
    assert.equal(await page.getByRole('button', { name: '打开对话a' }).getByText('助手正在运行...').count(), 0, 'failed snapshot must not restore stale running state');
    assert.equal(await page.getByRole('button', { name: '打开对话a' }).getByText('正在压缩对话...').count(), 0, 'failed snapshot must not restore stale compaction state');
    assert.deepEqual(errors, []);
    console.log('PASS selected terminal status remains consistent during slow and failed snapshot');
    await browser.close(); process.exit(0);
  }
  assert.equal(await page.evaluate(() => window.sources.length), 1, 'directory must not open a second event entrance');
  assert.ok(calls.some(call => call.path === '/api/session' && call.id === 'b' && call.view === '1' && !call.sourceRevision), 'a partial cache must load its body even with a matching source signature');
  const beforeClick = calls.length;
  await open('b'); await bubble('历史b').waitFor(); await open('a'); await bubble('历史a').waitFor();
  assert.equal(calls.slice(beforeClick).filter(call => call.method === 'GET' && ['/api/session', '/api/session/context', '/api/execution-status', '/api/session/queue', '/api/session/goal', '/api/session/user-input'].includes(call.path)).length, 0);

  holdSend = true;
  await page.locator('.chat-composer > div:visible input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await send('切换时确认的图片');
  await wait(() => sends.length === 1);
  await bubble('切换时确认的图片').waitFor();
  await open('b'); await bubble('历史b').waitFor();
  const submitted = sends[0];
  const accepted = { type: 'user_message_accepted', threadId: 'a', submissionId: submitted.submissionId, turnId: `turn-${submitted.submissionId}` };
  await page.evaluate(event => { window.emit(event); window.emit(event); }, accepted);
  releaseSend(); holdSend = false;
  await wait(() => messages.get('a').length === 2);
  await open('a'); await bubble('切换时确认的图片').waitFor();
  await wait(() => calls.some(call => call.path === '/api/session' && call.id === 'a' && call.view === '1' && calls.indexOf(call) > beforeClick));
  await page.waitForTimeout(250);
  assert.equal(await bubble('切换时确认的图片').count(), 1);
  await page.evaluate(body => { const event = { type: 'user_message_submitted', threadId: 'a', text: body.text, submissionId: body.submissionId, messageId: `optimistic-${body.submissionId}`, createdAt: new Date().toISOString(), attachments: [] }; window.emit(event); window.emit(event); }, submitted);
  assert.equal(await bubble('切换时确认的图片').count(), 1, 'late duplicate submission must not restore an accepted bubble');

  for (let n = 0; n < 2; n++) { await send('连续同文'); await wait(() => sends.length === n + 2); await page.waitForTimeout(350); }
  assert.equal(await bubble('连续同文').count(), 2);
  assert.notEqual(sends[1].submissionId, sends[2].submissionId);
  console.log('PASS cached clicks; one event entrance; switching during acknowledgement; duplicate event replay; identical consecutive messages');

  for (const mode of ['failed', 'occupied']) {
    sendMode = mode;
    await page.locator('.chat-composer > div:visible input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await send(`图片失败-${mode}`);
    const reason = mode === 'failed' ? '模拟图片发送失败' : 'already has an active writer';
    const shownReason = mode === 'occupied' ? 'Codex 占用中，未发送' : reason;
    await page.getByText(shownReason, { exact: true }).waitFor();
    await open('b'); await page.reload(); await bubble('历史b').waitFor(); await open('a');
    await bubble(`图片失败-${mode}`).waitFor(); await page.getByText(shownReason, { exact: true }).waitFor();
    const saved = await readCache();
    const restored = saved.threads.find(record => record.threadId === 'a').entry.session;
    const message = restored.messages.find(message => message.text === `图片失败-${mode}`);
    assert.equal(message.deliveryState, mode);
    assert.equal(message.blocks.find(block => block.type === 'image').file.id, 'photo');
    assert.equal(message.deliveryError, reason);
    assert.equal(await page.locator('.chat-messages img[src*="/api/media/photo"]').count(), mode === 'failed' ? 2 : 3);
  }
  console.log('PASS failed and occupied text, images and reasons persist across switching and browser reload');

  sendMode = 'accepted'; holdCreate = true;
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建对话', exact: true }).click();
  await send('创建中发送的消息');
  await wait(() => Boolean(releaseCreate)); await bubble('创建中发送的消息').waitFor();
  await composer().fill('创建时继续输入的草稿');
  releaseCreate(); holdCreate = false;
  await page.waitForURL('**thread=created');
  await page.getByRole('button', { name: '打开新建的对话', exact: true }).waitFor();
  await bubble('创建中发送的消息').waitFor();
  assert.equal(await composer().inputValue(), '创建时继续输入的草稿');
  await wait(() => sends.some(body => body.threadId === 'created'));
  await page.waitForTimeout(250);
  assert.equal(await bubble('创建中发送的消息').count(), 1);
  const cached = await readCache();
  assert.equal(JSON.stringify(cached).includes('pending:'), false, 'created conversation must leave no temporary cache ID');
  console.log('PASS pending ID migrates messages, list and URL while preserving the composer draft');

  await composer().fill('');
  const running = { ...idle('created'), phase: 'working', active: true, turnId: 'active-created', eventEpoch: 'runtime', eventSeq: 1 };
  statuses.set('created', running);
  await page.evaluate(event => { window.emit(event); window.emit(event); }, running);
  await page.getByRole('button', { name: '停止当前任务', exact: true }).filter({ visible: true }).waitFor();
  await send('运行时排队的消息');
  await page.getByRole('region', { name: '指令等候中' }).getByText('运行时排队的消息', { exact: true }).waitFor();
  assert.equal(queues.get('created').length, 1);
  await page.getByRole('button', { name: '直接发送', exact: true }).click();
  await wait(() => messages.get('created').some(message => message.text === '运行时排队的消息'));
  await open('a'); await open('b');
  await page.getByRole('button', { name: '打开新建的对话', exact: true }).click();
  await bubble('运行时排队的消息').waitFor();
  assert.equal(await bubble('运行时排队的消息').count(), 1);
  await page.getByRole('button', { name: '停止当前任务', exact: true }).filter({ visible: true }).click();
  await wait(() => calls.some(call => call.path === '/api/session/interrupt' && call.id === 'created'));
  assert.equal(calls.some(call => call.method === 'GET' && ['/api/session/context', '/api/execution-status', '/api/session/queue', '/api/session/goal', '/api/session/user-input'].includes(call.path)), false);
  console.log('PASS running append survives direct send and rapid switching; queue and stop use unified state');

  await open('a'); await bubble('历史a').waitFor();
  await page.locator('.chat-messages').hover();
  await page.mouse.wheel(0, -10000);
  await page.getByText('翻页读取的更早历史', { exact: true }).waitFor();
  assert.equal(pageRequest, 'a');
  const reads = calls.length;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await wait(() => calls.slice(reads).some(call => call.path === '/api/session' && call.view === '1'));
  await bubble('翻页读取的更早历史').waitFor();
  await page.locator('.chat-composer > div:visible').getByRole('button', { name: /Model-A/ }).click();
  await page.getByLabel('切换模型').selectOption('model-b');
  await page.getByRole('dialog', { name: '模型设置' }).getByRole('button', { name: '确认', exact: true }).click();
  await open('b'); await open('a');
  await page.locator('.chat-composer > div:visible').getByRole('button', { name: /Model-B/ }).waitFor();
  await send('使用切换后的模型');
  await wait(() => sends.some(body => body.text === '使用切换后的模型'));
  assert.equal(calls.filter(call => call.path === '/api/session/model').at(-1).body.model, 'model-b');
  await page.waitForTimeout(250);
  const goal = { threadId: 'a', objective: '验收缓存目标', status: 'paused', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 };
  goals.set('a', goal);
  await page.evaluate(goal => window.emit({ type: 'goal_status', threadId: 'a', goal }), goal);
  await page.getByRole('button', { name: '恢复目标', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: '暂停目标', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: '清除目标', exact: true }).filter({ visible: true }).click();
  await wait(() => !goals.has('a'));
  const question = { requestId: 'question-b', threadId: 'b', turnId: 'question-turn', itemId: 'question-item', isBlocking: true,
    questions: [{ id: 'choice', header: '确认', question: '缓存中的问题', isOther: false, isSecret: false, options: null }] };
  inputs.set('b', question);
  const beforeQuestion = calls.length;
  await page.evaluate(request => window.emit({ type: 'user_input_requested', threadId: 'b', request }), question);
  await wait(() => calls.slice(beforeQuestion).some(call => call.path === '/api/session' && call.id === 'b'));
  await page.waitForTimeout(200);
  const beforeQuestionClick = calls.length;
  await open('b');
  await page.getByRole('dialog', { name: 'Codex 需要您的选择' }).getByPlaceholder('请输入您的回答').fill('继续');
  await page.getByRole('button', { name: '提交并继续' }).click();
  await wait(() => calls.some(call => call.path === '/api/session/user-input' && call.method === 'POST' && call.id === 'b'));
  assert.equal(calls.slice(beforeQuestionClick).filter(call => call.method === 'GET' && call.path === '/api/session' && call.id === 'b').length, 0);
  console.log('PASS model choices survive switches; Goal controls and cached questions use the same state');

  const unloaded = { ...summaries[0], threadId: 'unloaded', title: '未加载对话', sourceRevision: 'r0' };
  summaries.push(unloaded); messages.set('unloaded', []);
  heldId = 'unloaded'; holdRead = true; readGate = new Promise(resolve => releaseRead = resolve);
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set('thread', 'unloaded'); history.pushState({}, '', url); window.dispatchEvent(new Event('negus:navigate')); });
  await send('正文读取期间发送');
  await wait(() => sends.some(body => body.text === '正文读取期间发送'));
  await bubble('正文读取期间发送').waitFor();
  await composer().fill('读取期间继续输入');
  releaseRead(); holdRead = false;
  await page.getByRole('button', { name: '打开未加载对话', exact: true }).waitFor();
  assert.equal(await composer().inputValue(), '读取期间继续输入');
  assert.equal(await bubble('正文读取期间发送').count(), 1);
  assert.ok(calls.some(call => call.path === '/api/session' && call.id === 'unloaded' && call.view === '1'));
  assert.equal(calls.some(call => call.method === 'GET' && ['/api/session/context', '/api/execution-status', '/api/session/queue', '/api/session/goal', '/api/session/user-input'].includes(call.path)), false);
  console.log('PASS unloaded conversation uses aggregate reads and accepts input and sends before history arrives');

  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/negus-unified-browser.png' });
  console.log('PASS older history and reconnect keep history and failed attachments; no browser exceptions');
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-3500), calls.slice(-15));
  await page.screenshot({ path: '/tmp/negus-unified-browser-failure.png' });
  throw error;
} finally {
  releaseSend?.(); releaseCreate?.(); releaseRead?.();
  if (errors.length) console.error(errors);
  await browser.close();
}
