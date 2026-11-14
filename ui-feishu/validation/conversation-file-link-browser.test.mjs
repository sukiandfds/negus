import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH
  || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
page.setDefaultTimeout(8000);
const stamp = '2026-11-13T00:00:00Z';
const summary = {
  threadId: 't0', sourceRevision: 'r1', source: 'codex', title: 'Agent 对话',
  updatedAt: stamp, messageCount: 1, latestMessage: '文件', latestUser: '', latestAssistant: '',
};
const errors = [];
let directoryReady = false;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), path = url.pathname;
  if (!path.startsWith('/api/')) return route.continue();
  const id = url.searchParams.get('threadId') || 't0';
  let data = {};
  if (path === '/api/project') data = { name: '项目', root: '/fixture', mode: 'interactive' };
  else if (path === '/api/project-directory') {
    data = { projects: directoryReady ? [{
        id: 'agent-project', name: 'Agent 项目', kind: 'employee', employeeId: 'agent',
        mainThreadId: 't0', mainConversationId: 'conversation-late-42',
        conversations: [{ id: 'conversation-late-42', threadId: 't0', conversationId: 'conversation-late-42', title: 'Agent 对话', main: true }],
      }] : [] };
  } else if (path === '/api/sessions') data = [summary];
  else if (path === '/api/session') data = {
    session: { ...summary, messages: [{ id: 'm0', role: 'assistant', text: '[文档](guide.md)', createdAt: stamp }] },
    sourceRevision: summary.sourceRevision,
    context: { type: 'context_status', threadId: id, model: '', reasoningEffort: '', phase: 'idle' },
    status: { type: 'execution_status', threadId: id, phase: 'idle', active: false, turnId: '', activities: [] },
    goal: null, queue: [], input: null,
  };
  else if (path === '/api/models') data = [];
  else if (path === '/api/model-channels') data = { channels: [] };
  else if (path === '/api/group/rooms') data = { rooms: [] };
  await route.fulfill({ json: data });
});

try {
  await page.goto('http://127.0.0.1:5201/?thread=t0');
  const link = page.getByRole('link', { name: '文档', exact: true });
  await link.waitFor();
  const before = await link.getAttribute('href');
  assert.match(before || '', /threadId=t0/);
  assert.match(before || '', /messageId=m0/);
  assert.equal(new URL(before || '', 'http://fixture').searchParams.has('conversationId'), false);

  directoryReady = true;
  await page.evaluate(() => window.dispatchEvent(new Event('negus:directory-changed')));
  await page.waitForFunction(() => {
    const anchor = [...document.querySelectorAll('a')].find(item => item.textContent === '文档');
    return new URL(anchor?.getAttribute('href') || '', location.href).searchParams.get('conversationId') === 'conversation-late-42';
  });
  const after = await link.getAttribute('href');
  const parsed = new URL(after || '', 'http://fixture');
  assert.equal(parsed.searchParams.get('threadId'), 't0');
  assert.equal(parsed.searchParams.get('messageId'), 'm0');
  assert.equal(parsed.searchParams.get('href'), 'guide.md');
  assert.equal(parsed.searchParams.get('conversationId'), 'conversation-late-42');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', before, after }));
} finally {
  console.log(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0, 1200) }));
  await browser.close();
}
