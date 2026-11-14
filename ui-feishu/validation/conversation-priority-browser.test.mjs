import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH
  || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
page.setDefaultTimeout(8000);
const stamp = '2026-11-13T00:00:00Z';
const summaries = Array.from({ length: 12 }, (_, index) => ({
  threadId: `t${index}`, sourceRevision: 'r1', source: 'codex', title: `对话${index}`,
  updatedAt: new Date(Date.parse(stamp) - index * 1000).toISOString(), messageCount: 1,
  latestMessage: `摘要${index}`, latestUser: '', latestAssistant: '',
}));
const calls = [], errors = [];
let active = 0, peak = 0, releaseFirst;
const firstBatch = new Promise(resolve => { releaseFirst = resolve; });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), path = url.pathname;
  if (!path.startsWith('/api/')) return route.continue();
  const id = url.searchParams.get('threadId') || 't0';
  let data = {};
  if (path === '/api/project') data = { name: '项目', root: '/fixture', mode: 'interactive' };
  else if (path === '/api/project-directory') data = { projects: [] };
  else if (path === '/api/sessions') data = summaries;
  else if (path === '/api/session') {
    calls.push(id);
    peak = Math.max(peak, ++active);
    if (id === 't9') await firstBatch;
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
    const summary = summaries[Number(id.slice(1))];
    data = {
      session: { ...summary, messages: [{ id: `m-${id}`, role: 'assistant', text: `正文${id}`, createdAt: stamp }] },
      sourceRevision: summary.sourceRevision,
      context: { type: 'context_status', threadId: id, model: '', reasoningEffort: '', phase: 'idle' },
      status: { type: 'execution_status', threadId: id, phase: 'idle', active: false, turnId: '', activities: [] },
      goal: null, queue: [], input: null,
    };
  } else if (path === '/api/models') data = [];
  else if (path === '/api/model-channels') data = { channels: [] };
  else if (path === '/api/group/rooms') data = { rooms: [] };
  await route.fulfill({ json: data });
});

try {
  await page.goto('http://127.0.0.1:5201/?thread=t0');
  await page.waitForFunction(() => true);
  for (let attempt = 0; attempt < 80 && !calls.includes('t9'); attempt++) await page.waitForTimeout(25);
  assert.ok(calls.includes('t9'));
  await page.waitForTimeout(300);
  assert.deepEqual([...new Set(calls)].sort(), summaries.slice(0, 10).map(item => item.threadId).sort());
  assert.ok(peak <= 4, `peak concurrency ${peak}`);
  releaseFirst();
  await page.waitForFunction(() => document.querySelector('button[aria-label="刷新会话"]')?.getAttribute('aria-busy') === 'false');
  assert.deepEqual([...new Set(calls)].sort(), summaries.map(item => item.threadId).sort());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', peak, calls }));
} finally {
  releaseFirst?.();
  console.log(JSON.stringify({ errors, calls, body: (await page.locator('body').innerText()).slice(0, 1200) }));
  await browser.close();
}
