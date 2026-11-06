import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const stamp = '2026-10-30T00:00:00Z';
const summaries = Array.from({ length: 25 }, (_, i) => ({ threadId: `t${i}`, sourceRevision: 'r1', source: 'codex', title: `对话${i}`, updatedAt: new Date(Date.parse(stamp) - i * 1000).toISOString(), messageCount: 2, latestMessage: `摘要${i}`, latestUser: '', latestAssistant: '' }));
const detail = id => ({ ...summaries[Number(id.slice(1))], historyFormatVersion: 3, hasMore: true, nextBefore: 1, messages: [{ id: `old-${id}`, role: 'user', text: `历史${id}`, createdAt: stamp }, { id: `m-${id}`, role: 'assistant', text: `正文${id}${summaries[Number(id.slice(1))].sourceRevision === 'r2' ? '-更新' : ''}`, createdAt: stamp }] });
const calls = [], errors = [];
let active = 0, peak = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()} ${request.failure()?.errorText}`));
await page.addInitScript(({ summaries, details, stamp }) => {
  localStorage.setItem('negus-conversation-snapshot-v1', JSON.stringify({ version: 1, savedAt: stamp, selectedId: 't0', sessions: summaries, session: details[0], recentSessions: details.slice(1).map(session => ({ savedAt: stamp, session })) }));
  const sources = []; window.EventSource = class { constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); } close() {} };
  window.emitFixture = event => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(event) }));
}, { summaries, details: summaries.map(s => detail(s.threadId)), stamp });
await page.route('**/api/**', async route => {
  const u = new URL(route.request().url()), p = u.pathname, id = u.searchParams.get('threadId') || 't0';
  if (!p.startsWith('/api/')) return route.continue();
  let data = {};
  if (p === '/api/project') data = { name: '项目', root: '/fixture', mode: 'interactive' };
  else if (p === '/api/project-directory') data = { projects: [] };
  else if (p === '/api/sessions') data = summaries;
  else if (p === '/api/session') {
    calls.push({ id, revision: u.searchParams.get('sourceRevision') });
    peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 30)); --active;
    const index = Number(id.slice(1));
    data = { session: u.searchParams.get('sourceRevision') === summaries[index].sourceRevision ? null : detail(id), sourceRevision: summaries[index].sourceRevision, historyFormatVersion: 3,
      context: { type: 'context_status', threadId: id, model: '', reasoningEffort: '', phase: 'idle' }, status: { type: 'execution_status', threadId: id, phase: 'idle', active: false, activities: [] }, goal: null, queue: [], input: null };
  } else if (p === '/api/models') data = [];
  else if (p === '/api/model-channels') data = { channels: [] };
  else if (p === '/api/group/rooms') data = { rooms: [] };
  await route.fulfill({ json: data });
});
try {
  await page.goto('http://127.0.0.1:5297/?thread=t0');
  await page.waitForFunction(() => document.querySelector('button[aria-label="刷新会话"]')?.getAttribute('aria-busy') === 'false');
  assert.deepEqual([...new Set(calls.map(call => call.id))].sort(), summaries.slice(0, 20).map(s => s.threadId).sort());
  assert.ok(peak <= 4, `peak concurrency ${peak}`);
  const settled = calls.length; await page.waitForTimeout(1200); assert.equal(calls.length, settled);
  summaries[22].sourceRevision = 'r2'; summaries[22].latestMessage = '旧对话新摘要';
  await page.evaluate(() => window.emitFixture({ type: 'sessions_changed', threadId: 't22' }));
  await page.getByText('旧对话新摘要', { exact: false }).first().waitFor();
  assert.equal(calls.slice(settled).some(call => call.id === 't22'), false);
  await page.getByRole('button', { name: '打开对话22', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('正文t22'));
  await page.waitForTimeout(300);
  assert.ok(calls.some(call => call.id === 't22'));
  assert.ok(await page.getByText('历史t22', { exact: true }).count());
  summaries[2].sourceRevision = 'r2'; summaries[2].latestMessage = '最近对话新摘要';
  await page.evaluate(() => window.emitFixture({ type: 'sessions_changed', threadId: 't2' }));
  await page.waitForFunction(() => document.body.textContent.includes('最近对话新摘要'));
  await page.waitForTimeout(500);
  assert.ok(calls.some(call => call.id === 't2' && call.revision === 'r1') && calls.filter(call => call.id === 't2').length >= 2);
  await page.getByRole('button', { name: '打开对话2', exact: true }).click();
  await page.getByText('正文t2-更新', { exact: true }).waitFor();
  await page.getByRole('button', { name: '打开对话22', exact: true }).click();
  await page.getByText('正文t22-更新', { exact: true }).waitFor();
  await page.waitForTimeout(300);
  const saved22 = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('negus-conversations', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const get = request.result.transaction('threads').objectStore('threads').get('t22'); get.onsuccess = () => resolve(get.result?.entry.session); get.onerror = () => reject(get.error); };
  }));
  assert.ok(saved22?.messages.some(message => message.id === 'old-t22'));
  await page.reload();
  await page.getByText('正文t22-更新', { exact: true }).waitFor();
  await page.getByText('历史t22', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', initialUnique: 20, peak, initialRequests: settled, totalRequests: calls.length, calls }));
} finally { console.log(JSON.stringify({ errors, calls, body: (await page.locator('body').innerText()).slice(0, 2000) })); await browser.close(); }
