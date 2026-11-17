import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const stamp = '2026-11-18T01:30:00Z';
const roomId = 'room-a';
const workId = 'work-stability';
const agents = [
  { id: 'manager', name: '运营管理', shortName: '运营', responsibility: '协调', phase: 'idle', active: false, threadId: 'manager-thread' },
  { id: 'developer', name: '技术研发', shortName: '研发', responsibility: '开发', phase: 'idle', active: false, threadId: 'developer-thread' },
];
const history = Array.from({ length: 24 }, (_, index) => ({
  id: `history-${index + 1}`,
  type: index % 2 ? 'agent' : 'human',
  authorId: index % 2 ? 'manager' : 'user',
  authorName: index % 2 ? '运营管理' : '我',
  agentId: index % 2 ? 'manager' : null,
  text: `历史消息 ${index + 1}\n用于验证消息更新时已有节点不会闪空。`,
  sequence: index + 1,
  createdAt: `2026-11-18T01:${String(index).padStart(2, '0')}:00Z`,
  attachments: [],
}));

try {
  for (const viewport of [{ width: 1280, height: 844 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(7000);
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const snapshot = { project: 'fixture', projectId: 'p', room: { id: roomId, name: '更新稳定性', projectId: 'p' },
      agents, members: [], messages: history, activeWorks: [] };
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/group/snapshot') return route.fulfill({ json: snapshot });
      if (url.pathname === '/api/group/rooms') return route.fulfill({ json: { rooms: [{ id: roomId, name: '更新稳定性', projectId: 'p' }] } });
      return route.fulfill({ json: {} });
    });
    await page.goto('http://127.0.0.1:5197/validation/group-workspace.html');
    await page.addStyleTag({ content: 'main.show-chat{height:100dvh;display:flex;flex-direction:column}.show-chat>.group-workspace{flex:1;min-height:0}' });
    await page.getByRole('region', { name: '群聊工作区' }).waitFor();
    await page.evaluate(async () => {
      const { publishProjectStream } = await import('/src/projectEvents.ts');
      window.emit = event => publishProjectStream('message', new MessageEvent('message', { data: JSON.stringify(event) }));
      publishProjectStream('open', new Event('open'));
      const scroll = [...document.querySelectorAll('*')].find(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 300 && rect.height > 100 && getComputedStyle(element).overflowY === 'auto'
          && element.querySelector('[data-message-id]');
      });
      const nodes = Object.fromEntries([...document.querySelectorAll('[data-message-id]')]
        .map(node => [node.getAttribute('data-message-id'), node]));
      const ids = Object.keys(nodes);
      window.__stability = { scroll, nodes, ids, order: ids, blanks: [], frames: 0 };
      const sample = () => {
        window.__stability.frames += 1;
        for (const id of window.__stability.ids) {
          if (!document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)) window.__stability.blanks.push({ id, frame: window.__stability.frames });
        }
        if (window.__stability.frames < 240) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    await page.evaluate(event => window.emit(event), {
      type: 'group_agent_started', roomId, workId, agentId: 'developer', agentName: '技术研发', startedAt: stamp,
    });
    await page.getByText('正在回复', { exact: true }).last().waitFor();
    const before = await page.evaluate(workId => {
      const scroll = window.__stability.scroll;
      const pending = document.querySelector(`[data-message-id="pending-${CSS.escape(workId)}"]`);
      const header = document.querySelector('.chat-header').getBoundingClientRect();
      const composer = document.querySelector('.chat-composer').getBoundingClientRect();
      window.__stability.pending = pending;
      return { scrollTop: scroll.scrollTop, order: [...document.querySelectorAll('[data-message-id]')].map(node => node.getAttribute('data-message-id')),
        header: [header.x, header.y, header.width, header.height], composer: [composer.x, composer.y, composer.width, composer.height] };
    }, workId);

    for (let index = 0; index < 12; index += 1) {
      await page.evaluate(event => window.emit(event), {
        type: 'group_agent_delta', roomId, workId, agentId: 'developer', itemId: 'item-stability', delta: `片段${index}`,
      });
    }
    await page.waitForTimeout(80);
    const commentary = {
      id: 'commentary-stability', itemId: 'item-stability', phase: 'commentary', workId,
      type: 'agent', agentId: 'developer', authorId: 'developer', authorName: '技术研发',
      text: '中间回复', sequence: 25, createdAt: '2026-11-18T01:31:00Z', attachments: [],
    };
    const commentaryWithFinalItemId = {
      ...commentary, id: 'commentary-final-item-id', itemId: 'final',
      text: '中间回复（itemId=final）', sequence: 26, createdAt: '2026-11-18T01:31:30Z',
    };
    const final = {
      id: 'final-stability', workId, type: 'agent', agentId: 'developer', authorId: 'developer',
      authorName: '技术研发', text: '最终回复', sequence: 27, createdAt: '2026-11-18T01:32:00Z', attachments: [],
    };
    for (const message of [commentary, commentaryWithFinalItemId, final]) {
      await page.evaluate(({ roomId, message }) => window.emit({ type: 'group_message_created', roomId, message }), { roomId, message });
    }
    await page.getByText('最终回复', { exact: true }).waitFor();
    await page.waitForTimeout(80);

    const after = await page.evaluate(() => {
      const scroll = window.__stability.scroll;
      const current = Object.fromEntries([...document.querySelectorAll('[data-message-id]')]
        .map(node => [node.getAttribute('data-message-id'), node]));
      const header = document.querySelector('.chat-header').getBoundingClientRect();
      const composer = document.querySelector('.chat-composer').getBoundingClientRect();
      return {
        samePendingNode: current['final-stability'] === window.__stability.pending,
        stable: window.__stability.ids.every(id => current[id] === window.__stability.nodes[id]),
        order: [...document.querySelectorAll('[data-message-id]')].map(node => node.getAttribute('data-message-id')),
        scrollTop: scroll.scrollTop,
        blanks: window.__stability.blanks,
        header: [header.x, header.y, header.width, header.height],
        composer: [composer.x, composer.y, composer.width, composer.height],
      };
    });

    await page.evaluate(({ roomId, agent }) => window.emit({ type: 'group_agent_updated', roomId, agent }), {
      roomId, agent: { ...agents[1], active: false, phase: 'completed' },
    });
    await page.waitForTimeout(80);
    const idle = await page.evaluate(() => {
      const scroll = window.__stability.scroll;
      const header = document.querySelector('.chat-header').getBoundingClientRect();
      const composer = document.querySelector('.chat-composer').getBoundingClientRect();
      return { scrollTop: scroll.scrollTop, header: [header.x, header.y, header.width, header.height], composer: [composer.x, composer.y, composer.width, composer.height] };
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(after.blanks, []);
    assert.equal(after.stable, true, 'existing message nodes must be reused');
    assert.equal(after.samePendingNode, true, 'the pending bubble must become the final bubble without remounting');
    assert.deepEqual(after.order.slice(-3), ['commentary-stability', 'commentary-final-item-id', 'final-stability']);
    assert.ok(after.order.indexOf('commentary-stability') < after.order.indexOf('final-stability'));
    assert.deepEqual(after.header, before.header);
    assert.deepEqual(after.composer, before.composer);
    assert.deepEqual(idle.header, before.header);
    assert.deepEqual(idle.composer, before.composer);
    assert.ok(Math.abs(idle.scrollTop - after.scrollTop) <= 1, 'a non-content agent status update must not move the timeline');
    console.log(JSON.stringify({ viewport, existingNodesStable: after.stable, pendingNodeReused: after.samePendingNode,
      blankFrames: after.blanks.length, order: after.order.slice(-3), consoleErrors: consoleErrors.length,
      statusScrollDelta: idle.scrollTop - after.scrollTop }));
    await page.close();
  }
} finally {
  await browser.close();
}
