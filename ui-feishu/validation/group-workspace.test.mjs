import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const stamp = '2026-11-04T12:00:00Z';
const agents = [{ id: 'manager', name: '运营管理', shortName: '运营', responsibility: '协调', phase: 'idle', active: false, threadId: null }];
try {
  for (const existing of [null, { id: 'legacy-id', name: '旧名称' }]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => console.error('PAGE ERROR', error.stack));
    const sent = []; const seen = [];
    await page.addInitScript(member => {
      if (member) localStorage.setItem('negus-group-member', JSON.stringify(member));
      window.EventSource = class { static CLOSED = 2; readyState = 1; close() {} };
    }, existing);
    await page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const body = request.postDataJSON();
      seen.push({ path: url.pathname, room: url.searchParams.get('roomId') || body?.roomId });
      if (url.pathname === '/api/group/rooms') return route.fulfill({ json: { rooms: [] } });
      if (url.pathname === '/api/group/snapshot') {
        const id = url.searchParams.get('roomId') || 'current-project';
        return route.fulfill({ json: { project: '测试项目', projectId: 'p', room: { id, name: id, projectId: 'p' }, agents, members: [], messages: [], activeWorks: [] } });
      }
      if (url.pathname === '/api/group/presence') return route.fulfill({ json: { id: body.memberId, name: body.name } });
      if (url.pathname === '/api/group/message') {
        sent.push(body);
        return route.fulfill({ json: { message: { id: `message-${sent.length}`, type: 'human', authorId: body.memberId, authorName: body.authorName,
          clientMessageId: body.clientMessageId, text: body.text, sequence: sent.length, createdAt: stamp, attachments: [] }, execution: null } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto('http://127.0.0.1:4320/validation/group-workspace.html');
    try { await page.locator('textarea').waitFor(); } catch (error) { console.error('BODY', await page.locator('body').innerText(), 'REQUESTS', seen); throw error; }
    assert.equal(await page.getByRole('dialog').count(), 0);
    const member = await page.evaluate(() => JSON.parse(localStorage.getItem('negus-group-member')));
    assert.equal(member.name, existing?.name || '我');
    if (existing) assert.equal(member.id, existing.id);
    await page.locator('textarea').fill('隔离测试消息');
    assert.deepEqual(seen.filter(call => call.path === '/api/group/snapshot').map(call => call.room), ['room-a']);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('隔离测试消息'));
    assert.equal(sent[0].memberId, member.id);
    assert.equal(sent[0].agentIds, undefined);
    const switched = page.waitForResponse(response => new URL(response.url()).pathname === '/api/group/snapshot' && new URL(response.url()).searchParams.get('roomId') === 'room-b');
    await page.getByRole('button', { name: '切换测试群' }).click();
    await page.getByText('room-b', { exact: true }).first().waitFor();
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('negus-group-member')))).id, member.id);
    await switched;
    assert.equal(seen.some(call => call.path === '/api/group/snapshot' && call.room === 'room-b'), true);
    await page.reload();
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('negus-group-member')))).id, member.id);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const snapshot = (id, text) => ({ project: '测试项目', projectId: 'p', room: { id, name: id, projectId: 'p' }, agents, members: [], activeWorks: [],
    messages: [{ id: `${id}-message`, type: 'agent', agentId: 'manager', authorId: 'manager', authorName: '运营管理', text, sequence: 1, createdAt: stamp, attachments: [] }] });
  await page.addInitScript(cached => {
    localStorage.setItem('negus-group-snapshot-v1:room-a', JSON.stringify(cached));
    window.EventSource = class { static CLOSED = 2; readyState = 1; close() {} };
  }, snapshot('room-a', '缓存先显示'));
  let release; const requested = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/group/snapshot') {
      const id = url.searchParams.get('roomId'); requested.push(id);
      if (id === 'room-a') await new Promise(resolve => { release = resolve; });
      try { await route.fulfill({ json: snapshot(id, id === 'room-a' ? '旧群晚响应' : '新群内容') }); } catch {}
      return;
    }
    return route.fulfill({ json: url.pathname === '/api/group/rooms' ? { rooms: [] } : {} });
  });
  await page.goto('http://127.0.0.1:4320/validation/group-workspace.html');
  await page.getByText('缓存先显示').waitFor();
  await page.getByRole('button', { name: '切换测试群' }).click();
  await page.getByText('新群内容').waitFor();
  release?.();
  await page.waitForTimeout(200);
  assert.equal(await page.getByText('旧群晚响应').count(), 0);
  assert.deepEqual(requested, ['room-a', 'room-b']);
  await page.close();
} finally { await browser.close(); }
