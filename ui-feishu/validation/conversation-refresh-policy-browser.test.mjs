import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH
  || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
page.setDefaultTimeout(8000);

const stamp = '2026-11-13T00:00:00Z';
const summaries = Array.from({ length: 6 }, (_, index) => ({
  threadId: `t${index}`, sourceRevision: 'r1', source: 'codex', title: `对话${index}`,
  updatedAt: new Date(Date.parse(stamp) - index * 1000).toISOString(), messageCount: 1,
  latestMessage: `摘要${index}`, latestUser: '', latestAssistant: '',
}));
const detail = id => ({
  ...summaries[Number(id.slice(1))],
  messages: [{ id: `m-${id}`, role: 'assistant', text: `正文${id}`, createdAt: stamp }],
});
const calls = [], errors = [], statuses = new Map();
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
  await route.fulfill({ json: data });
});

const sessionReads = () => calls.filter(call => call.id === 't1').length;
try {
  await page.goto('http://127.0.0.1:5201/?thread=t0');
  await page.waitForFunction(() => document.querySelector('button[aria-label="刷新会话"]')?.getAttribute('aria-busy') === 'false');
  assert.equal(sessionReads(), 1);

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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', sessionReads: calls }));
} finally {
  console.log(JSON.stringify({ errors, calls, body: (await page.locator('body').innerText()).slice(0, 1500) }));
  await browser.close();
}
