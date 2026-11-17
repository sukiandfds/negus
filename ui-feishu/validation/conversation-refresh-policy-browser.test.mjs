import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH
  || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
page.setDefaultTimeout(8000);

const stamp = '2026-11-13T00:00:00Z';
const summaries = Array.from({ length: 20 }, (_, index) => ({
  threadId: `t${index}`, sourceRevision: 'r1', source: 'codex', title: `对话${index}`,
  updatedAt: new Date(Date.parse(stamp) - index * 1000).toISOString(), messageCount: 1,
  latestMessage: `摘要${index}`, latestUser: '', latestAssistant: '',
}));
const detail = id => ({
  ...summaries[Number(id.slice(1))],
  messages: [{ id: `m-${id}`, role: 'assistant', text: `正文${id}`, createdAt: stamp }],
});
const calls = [], errors = [], statuses = new Map();
let heldRead = null, releaseRead, rejectRead = false;
const inFlight = new Map(), peaks = new Map();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => {
  const sources = [];
  window.EventSource = class {
    constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); }
    close() {}
  };
  window.emitFixture = event => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(event) }));
});
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), path = url.pathname;
  if (!path.startsWith('/api/')) return route.continue();
  const id = url.searchParams.get('threadId') || 't0';
  let data = {};
  if (path === '/api/project') data = { name: '项目', root: '/fixture', mode: 'interactive' };
  else if (path === '/api/project-directory') data = { projects: [] };
  else if (path === '/api/sessions') data = summaries;
  else if (path === '/api/session') {
    calls.push({ id, revision: url.searchParams.get('sourceRevision') });
    inFlight.set(id, (inFlight.get(id) || 0) + 1);
    peaks.set(id, Math.max(peaks.get(id) || 0, inFlight.get(id)));
    data = {
      session: url.searchParams.get('sourceRevision') === summaries[Number(id.slice(1))].sourceRevision ? null : detail(id),
      sourceRevision: summaries[Number(id.slice(1))].sourceRevision,
      context: { type: 'context_status', threadId: id, model: '', reasoningEffort: '', phase: 'idle' },
      status: statuses.get(id) || { type: 'execution_status', threadId: id, phase: 'idle', active: false, turnId: '', activities: [] },
      goal: null, queue: [], input: null,
    };
  } else if (path === '/api/models') data = [];
  else if (path === '/api/model-channels') data = { channels: [] };
  else if (path === '/api/group/rooms') data = { rooms: [] };
  if (path === '/api/session' && id === 't1' && rejectRead) {
    rejectRead = false;
    await route.fulfill({ status: 409, json: { error: 'fixture version conflict' } });
    inFlight.set(id, inFlight.get(id) - 1);
    return;
  }
  if (path === "/api/session" && id === "t1" && heldRead) await heldRead;
  await route.fulfill({ json: data });
  if (path === "/api/session") inFlight.set(id, inFlight.get(id) - 1);
});

const sessionReads = () => calls.filter(call => call.id === 't1').length;
try {
  await page.goto('http://127.0.0.1:5201/?thread=t0');
  await page.waitForFunction(() => document.querySelector('button[aria-label="刷新会话"]')?.getAttribute('aria-busy') === 'false');
  assert.equal(sessionReads(), 1);
  await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="打开对话"]').length >= 20);
  await page.waitForTimeout(700);
  const warmReads = calls.length;
  assert.equal(warmReads, 20);
  summaries[0].title = '仅标题更新';
  await page.evaluate(() => window.emitFixture({ type: 'sessions_changed', threadId: 't0' }));
  await page.getByRole('button', { name: '打开仅标题更新', exact: true }).waitFor();
  await page.locator('.chat-workspace').getByText('仅标题更新', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重命名对话', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '对话名称', exact: true }).inputValue(), '仅标题更新');
  await page.getByRole('button', { name: '取消重命名', exact: true }).click();
  await page.waitForTimeout(900);
  assert.equal(calls.length, warmReads, 'title-only metadata must update all surfaces without body reads or follow-up waves');
  console.log('PASS title-only update: header, list, rename input; added session requests=0');
  const composer = page.locator('.chat-composer > div:visible textarea');
  await composer.focus();
  await composer.evaluate(el => { window.fixtureComposer = el; window.inputFrames = []; window.longTasks = [];
    new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' });
    el.addEventListener('input', () => { const start = performance.now(); requestAnimationFrame(() => window.inputFrames.push(performance.now() - start)); });
  });
  for (const count of [100, 1000, 10000]) {
    await page.evaluate(count => {
      let i = 0;
      window.stormDone = false;
      const timer = setInterval(() => {
        const end = Math.min(i + 50, count);
        for (; i < end; i++) window.emitFixture({ type: 'context_status', threadId: `t${i % 20}`,
          model: '', reasoningEffort: '', phase: 'idle', usedTokens: i, updatedAt: new Date(i).toISOString() });
        if (i === count) { clearInterval(timer); window.stormDone = true; }
      }, 10);
    }, count);
    await composer.pressSequentially('abc');
    await composer.press('ArrowLeft'); await composer.press('Backspace');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '中文' });
    await cdp.detach();
    await page.waitForFunction(() => window.stormDone);
    await page.waitForTimeout(400);
    assert.equal(await composer.evaluate(el => el === window.fixtureComposer && document.activeElement === el), true);
    assert.equal(calls.length, warmReads, `${count} usage events must add zero session requests`);
  }
  assert.equal(await composer.inputValue(), 'a中文a中文a中文ccc');
  assert.equal(await page.evaluate(() => window.longTasks.length), 0);
  console.log(JSON.stringify(await page.evaluate(() => ({ inputFrames: window.inputFrames, longTasks: window.longTasks }))));
  console.log(JSON.stringify({ contextStorms: [100, 1000, 10000], warmReads, addedSessionRequests: calls.length - warmReads }));

  const running = { type: 'execution_status', threadId: 't1', phase: 'working', active: true, turnId: 'turn-t1', activities: [] };
  statuses.set('t1', running);
  await page.evaluate(event => window.emitFixture(event), running);
  await page.getByRole('button', { name: '打开对话1', exact: true }).getByText('助手正在运行...').waitFor();
  await page.waitForTimeout(600);
  assert.equal(sessionReads(), 1, 'running state alone must not reread the background body');

  await page.evaluate(() => window.emitFixture({ type: 'sessions_changed', threadId: 't1' }));
  await page.waitForTimeout(500);
  assert.equal(sessionReads(), 1, 'unchanged directory metadata must not reread the background body');

  const completed = { ...running, phase: 'completed', active: false, hasFinalAnswer: true };
  statuses.set('t1', completed);
  await page.evaluate(event => window.emitFixture(event), completed);
  await page.waitForTimeout(400);
  assert.equal(sessionReads(), 2, 'terminal state must calibrate the background body once');
  await page.evaluate(event => window.emitFixture(event), completed);
  await page.waitForTimeout(400);
  assert.equal(sessionReads(), 2, 'duplicate terminal state must not repeat calibration');

  summaries[1].sourceRevision = 'r2';
  summaries[1].latestMessage = '正文已更新';
  await page.evaluate(() => window.emitFixture({ type: 'sessions_changed', threadId: 't1' }));
  await page.waitForTimeout(1200);
  assert.equal(sessionReads(), 3, 'new content revision must reread the body');
  const message = { id: 'fixture-complete', role: 'assistant', text: '完整消息即时到达', createdAt: stamp };
  const beforeMessage = calls.length;
  await page.evaluate(message => { for (let i = 0; i < 2; i++) window.emitFixture({
    type: 'assistant_message_completed', threadId: 't0', message }); }, message);
  await page.locator('[data-message-id="fixture-complete"]').waitFor();
  assert.equal(await page.locator('[data-message-id="fixture-complete"]').count(), 1);
  assert.equal(calls.length, beforeMessage);

  const beforeSlow = sessionReads();
  heldRead = new Promise(resolve => { releaseRead = resolve; });
  for (const version of [3, 4, 5]) {
    summaries[1].sourceRevision = `r${version}`;
    await page.evaluate(() => window.emitFixture({ type: 'sessions_changed', threadId: 't1' }));
    await page.waitForTimeout(700);
  }
  assert.equal(sessionReads(), beforeSlow + 1, 'one in-flight read despite three content changes');
  heldRead = null; releaseRead();
  await page.waitForTimeout(700);
  assert.equal(sessionReads(), beforeSlow + 2, 'exactly one follow-up reads the latest demand');
  assert.equal(peaks.get('t1'), 1);
  assert.equal(calls.at(-1).revision, 'r3');

  const selectedTerminal = { ...completed, threadId: 't0', turnId: 'selected-turn' };
  statuses.set('t0', selectedTerminal);
  await page.evaluate(event => window.emitFixture(event), selectedTerminal);
  await page.waitForTimeout(400);
  const terminalReads = calls.length;
  await page.evaluate(event => window.emitFixture(event), selectedTerminal);
  await page.waitForTimeout(400);
  assert.equal(calls.length, terminalReads, 'selected duplicate terminal does not reread');
  assert.deepEqual(errors, []);
  rejectRead = true;
  summaries[1].sourceRevision = 'r6';
  await page.evaluate(() => window.emitFixture({ type: 'sessions_changed', threadId: 't1' }));
  await page.waitForTimeout(800);
  const conflictReads = calls.length;
  await page.evaluate(() => { for (let i = 0; i < 100; i++) window.emitFixture({ type: 'context_status',
    threadId: 't1', phase: 'idle', usedTokens: i, updatedAt: new Date().toISOString() }); });
  await page.waitForTimeout(400);
  assert.equal(calls.length, conflictReads, '409 followed by usage must not create a retry loop');
  await page.getByRole('button', { name: '刷新会话', exact: true }).click();
  await page.waitForTimeout(900);
  assert.ok(calls.length > conflictReads, 'manual refresh recovers the conflict');
  assert.ok(errors.length > 0 && errors.every(error => /409|fixture version conflict|conversation-sync/.test(error)));
  console.log('PASS 409 stays bounded and manual refresh recovers');
  console.log(JSON.stringify({ result: 'PASS', sessionReads: calls }));
} finally {
  console.log(JSON.stringify({ errors, calls, body: (await page.locator('body').innerText()).slice(0, 1500) }));
  await browser.close();
}
