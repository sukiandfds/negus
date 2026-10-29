import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(4000);
const calls = [];
const failures = [];
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.stack));
const stamp = '2026-10-29T01:00:00.000Z';
const summary = id => ({ threadId: id, source: 'codex', title: id, updatedAt: stamp, messageCount: 1, latestUser: '原消息', latestAssistant: '' });
const messages = [{ id: 'old', role: 'user', text: '原消息', turnId: 'old-turn', createdAt: stamp }];
const sessions = Array.from({ length: 12 }, (_, i) => ({ ...summary(`thread-${String(i).padStart(2, '0')}`), ...(i === 1 ? { createdBy: 'assistant' } : {}) }));
const cached = { ...sessions[0], messages: [{ ...messages[0], text: '缓存先显示' }] };
let releaseSession;
let releaseSend;
let latestExecution;
let queue = [{ id: 'q1', threadId: 'thread-00', submissionId: 'queued', dispatchSubmissionId: 'dispatch', text: '排队消息', attachments: [], state: 'pending', createdAt: stamp }];
await page.addInitScript(({ cached, sessions, stamp }) => {
  localStorage.setItem('negus-conversation-snapshot-v1', JSON.stringify({ version: 1, savedAt: stamp, selectedId: 'thread-00', session: cached, sessions }));
  const sources = [];
  window.EventSource = class {
    static CLOSED = 2;
    readyState = 1;
    constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); }
    close() { this.readyState = 2; }
  };
  window.fixtureEvent = event => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(event), lastEventId: '' }));
}, { cached, sessions, stamp });
await page.route('**/*', async route => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin !== 'http://127.0.0.1:5201') return route.abort();
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const body = req.postDataJSON();
  calls.push({ path: url.pathname, query: url.search, method: req.method(), body });
  const id = url.searchParams.get('threadId') || body?.threadId || 'thread-00';
  let data = {};
  if (url.pathname === '/api/project') data = { name: '项目', root: '/fixture', mode: 'interactive' };
  else if (url.pathname === '/api/sessions') data = sessions;
  else if (url.pathname === '/api/project-directory') data = { projects: [{ id: 'developer', name: '技术研发', kind: 'employee', employeeId: 'developer', mainThreadId: 'thread-00', mainConversationId: 'employee-conversation', conversations: [{ id: 'employee-conversation', threadId: 'thread-00', conversationId: 'employee-conversation', title: '技术研发', main: true }] }] };
  else if (url.pathname === '/api/session' && req.method() === 'GET') {
    if (id === 'thread-00' && !releaseSession) await new Promise(resolve => { releaseSession = resolve; });
    data = { ...summary(id), messages: id === 'thread-00' ? messages : [] };
  } else if (url.pathname === '/api/execution-status') data = latestExecution || { type: 'execution_status', threadId: id, turnId: '', phase: 'idle', active: false, activities: [], startedAt: null, label: '', detail: '', commentary: '', updatedAt: stamp };
  else if (url.pathname === '/api/session/context') data = { type: 'context_status', threadId: id, model: '', reasoningEffort: '', phase: 'idle', message: '', updatedAt: stamp, autoCompactThreshold: 80 };
  else if (url.pathname === '/api/session/context/compact') data = { type: 'context_status', threadId: id, model: '', reasoningEffort: '', phase: 'compacting', message: '正在压缩上下文', updatedAt: stamp };
  else if (url.pathname === '/api/session/queue') data = { threadId: id, items: queue };
  else if (url.pathname === '/api/session/user-input') data = { request: null };
  else if (url.pathname === '/api/session/goal') data = { goal: null };
  else if (url.pathname === '/api/models') data = [];
  else if (url.pathname === '/api/model-channels') data = { channels: [] };
  else if (url.pathname === '/api/model-defaults') data = { model: '', effort: '', providerId: '' };
  else if (url.pathname === '/api/session/message') { await new Promise(resolve => { releaseSend = resolve; }); data = { threadId: id, turnId: 'new-turn', status: 'inProgress' }; }
  else if (url.pathname === '/api/session/revert') { messages.splice(0); data = { threadId: id }; }
  else if (url.pathname === '/api/conversation-forward/targets') data = [];
  else if (url.pathname.includes('rooms')) data = { rooms: [] };
  try { await route.fulfill({ json: data }); } catch {}
});
const check = async (name, fn) => { try { await fn(); checks.push(name); console.log('PASS', name); } catch (error) { failures.push({ name, error: String(error) }); console.error('FAIL', name, String(error)); } };
try {
  await page.goto('http://127.0.0.1:5201/?thread=thread-00');
  await check('cached message visible while session API waits', async () => { await page.getByText('缓存先显示').first().waitFor(); for (let i = 0; i < 40 && !releaseSession; i++) await page.waitForTimeout(50); assert.ok(releaseSession); });
  releaseSession?.();
  await check('old link employee identity', async () => { await page.getByText('技术研发', { exact: true }).first().waitFor(); });
  await check('prefetch recent batch then remaining conversations', async () => {
    await page.waitForFunction(() => document.body.innerText.includes('原消息'));
    await page.waitForTimeout(1200);
    const ids = new Set(calls.filter(c => c.path === '/api/session' && c.method === 'GET').map(c => new URLSearchParams(c.query).get('threadId')));
    assert.deepEqual([...ids].sort(), sessions.map(s => s.threadId).sort());
  });
  await check('background menu without session summary', async () => {
    await page.getByRole('button', { name: '后台', exact: true }).click();
    await page.getByRole('button', { name: '更多操作：thread-01' }).click();
    for (const name of ['重命名', '转发', '复制', '归档', '复制对话 ID']) await page.getByRole('menuitem', { name, exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '全部', exact: true }).click();
  });
  await check('queue accepted event removes clock', async () => {
    await page.getByLabel('等待助手完成后发送').waitFor();
    await page.evaluate(() => window.fixtureEvent({ type: 'user_message_accepted', threadId: 'thread-00', turnId: 'new-turn', submissionId: 'dispatch' }));
    await page.getByLabel('等待助手完成后发送').waitFor({ state: 'detached' });
    queue = [];
  });
  await check('edit original thread and receipt before HTTP response', async () => {
    await page.locator('[data-message-id="old"]').getByRole('button', { name: '重新编辑' }).click();
    const input = page.locator('.chat-composer textarea:visible');
    await input.fill('修改后消息');
    await page.getByRole('button', { name: '重新发送', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('修改后消息'));
    await page.waitForTimeout(300);
    const revert = calls.find(c => c.path === '/api/session/revert');
    assert.equal(revert?.body.threadId, 'thread-00');
    assert.equal(revert?.body.beforeTurnId, 'old-turn');
    assert.equal(calls.some(c => c.path === '/api/session/fork' || (c.path === '/api/session' && c.method === 'POST')), false);
    await page.waitForTimeout(300);
    const sent = calls.find(c => c.path === '/api/session/message');
    assert.equal(sent?.body.threadId, 'thread-00');
    assert.equal(sent?.body.conversationId, 'employee-conversation');
    await page.evaluate(submissionId => window.fixtureEvent({ type: 'user_message_accepted', threadId: 'thread-00', turnId: 'new-turn', submissionId }), sent.body.submissionId);
    await page.waitForTimeout(3300);
    assert.equal(await page.getByLabel('发送中', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('正在确认指令是否已送达').count(), 0);
    releaseSend?.();
  });
  await check('compaction quota error appears inline', async () => {
    latestExecution = { type: 'execution_status', threadId: 'thread-00', turnId: 'new-turn', phase: 'failed', active: false, activities: [], startedAt: '2026-10-29T01:00:00.000Z', label: '执行失败', detail: '额度不足，无法压缩', notices: ['额度不足，无法压缩'], commentary: '', updatedAt: new Date().toISOString() };
    await page.evaluate(status => {
      window.fixtureEvent(status);
      window.fixtureEvent({ type: 'context_status', threadId: 'thread-00', model: '', reasoningEffort: '', phase: 'failed', message: '额度不足，无法压缩', updatedAt: new Date().toISOString() });
    }, latestExecution);
    await page.getByText('额度不足，无法压缩', { exact: true }).first().waitFor();
    const timeline = page.getByLabel('Codex 工作过程');
    await timeline.getByText('额度不足，无法压缩').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('助手正在运行...',{exact:true}).count(), 0);
    assert.equal(await page.locator('[data-message-id=old]').count(), 0);
  });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.screenshot({ path: '/tmp/negus-workspace-browser.png' });
} finally {
  releaseSession?.(); releaseSend?.();
  console.log('REQUESTS', JSON.stringify(calls));
  console.log('RESULT', JSON.stringify({ checks, failures, errors, body: (await page.locator('body').innerText()).slice(0, 2500) }));
  await browser.close();
}
if (failures.length) process.exitCode = 1;
