import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });

try {
  const page = await browser.newPage();
  let roomRequests = 0;
  await page.route('**/api/group/rooms', route => {
    roomRequests += 1;
    return route.fulfill({ json: { rooms: [
      { id: 'room-a', name: '群聊 A', projectId: 'p', lastActivityAt: '2026-11-18T01:00:00Z', latestMessage: { id: 'stored', sequence: 0, text: '已保存消息' } },
      { id: 'room-b', name: '群聊 B', projectId: 'p', lastActivityAt: '2026-11-18T01:00:00Z' },
    ] } });
  });
  await page.goto('http://127.0.0.1:5197/validation/group-room-list.html');
  await page.waitForFunction(() => document.querySelector('[data-room-list]')?.textContent.includes('room-a'));
  assert.equal(roomRequests, 1);
  assert.match(await page.locator('[data-room-list]').textContent(), /已保存消息/);
  await page.evaluate(async () => {
    const { publishProjectStream } = await import('/src/projectEvents.ts');
    window.emit = event => publishProjectStream('message', new MessageEvent('message', { data: JSON.stringify(event) }));
  });
  for (let second = 1; second <= 5; second += 1) {
    await page.evaluate(({ second }) => {
      window.emit({
        type: 'group_message_created',
        roomId: 'room-a',
        message: { id: `message-${second}`, type: 'agent', authorId: 'manager', authorName: '运营管理',
          agentId: 'manager', text: `消息 ${second}`, sequence: second, createdAt: `2026-11-18T01:0${second}:00Z`, attachments: [] },
      });
      // Employee messages are followed by this transport-level session event.
      window.emit({ type: 'sessions_changed', source: 'group', roomId: 'room-a', threadId: `thread-${second}`,
        conversationId: 'room-a', employeeId: 'manager' });
    }, { second });
  }
  await page.waitForTimeout(20);
  await page.evaluate(() => {
    window.emit({ type: 'group_message_created', roomId: 'room-b', message: {
      id: 'message-b', type: 'agent', authorId: 'manager', authorName: '运营管理',
      agentId: 'manager', text: '另一个群的消息', sequence: 1, createdAt: '2026-11-18T01:06:00Z', attachments: [],
    } });
    window.emit({ type: 'sessions_changed', source: 'group', roomId: 'room-b', threadId: 'thread-b',
      conversationId: 'room-b', employeeId: 'manager' });
  });
  await page.waitForTimeout(260);
  const state = await page.locator('[data-room-list]').evaluate(node => JSON.parse(node.textContent || '{}'));
  const activityA = state.rooms.find(room => room.id === 'room-a').lastActivityAt;
  const activityB = state.rooms.find(room => room.id === 'room-b').lastActivityAt;
  const activityRequestCount = roomRequests;
  assert.equal(roomRequests, 1, 'new group messages must not refetch the room list');
  assert.equal(activityA, '2026-11-18T01:05:00Z');
  assert.equal(activityB, '2026-11-18T01:06:00Z');
  assert.equal(state.rooms.find(room => room.id === 'room-a').latestMessage.text, '消息 5');
  assert.equal(state.rooms.find(room => room.id === 'room-b').latestMessage.text, '另一个群的消息');
  await page.evaluate(() => {
    window.emit({ type: 'group_message_updated', roomId: 'room-a', message: {
      id: 'message-5', sequence: 5, text: '最新消息原位更新', createdAt: '2026-11-18T01:05:00Z',
    } });
    window.emit({ type: 'group_message_updated', roomId: 'room-a', message: {
      id: 'message-4', sequence: 4, text: '旧消息原位更新', createdAt: '2026-11-18T01:04:00Z',
    } });
  });
  await page.waitForFunction(() => document.querySelector('[data-room-list]')?.textContent.includes('最新消息原位更新'));
  assert.equal(roomRequests, 1);

  await page.evaluate(() => window.emit({ type: 'sessions_changed', roomId: 'room-a' }));
  await page.waitForTimeout(260);
  assert.equal(roomRequests, 2, 'room metadata changes must still refresh the room list');
  console.log(JSON.stringify({ activityRequestCount, activityA, activityB, metadataRequestCount: roomRequests }));

  const racePage = await browser.newPage();
  let raceRequests = 0;
  let releaseStale;
  let markStaleStarted;
  const staleGate = new Promise(resolve => { releaseStale = resolve; });
  const staleStarted = new Promise(resolve => { markStaleStarted = resolve; });
  await racePage.route('**/api/group/rooms', async route => {
    raceRequests += 1;
    if (raceRequests === 1) return route.fulfill({ json: { rooms: [
      { id: 'room-a', name: '群聊 A', projectId: 'p', lastActivityAt: '2026-11-18T01:00:00Z' },
      { id: 'room-b', name: '群聊 B', projectId: 'p', lastActivityAt: '2026-11-18T01:00:00Z' },
    ] } });
    if (raceRequests === 2) {
      markStaleStarted();
      await staleGate;
      return route.fulfill({ json: { rooms: [
        { id: 'room-a', name: '群聊 A', projectId: 'p', lastActivityAt: '2026-11-18T01:00:00Z' },
        { id: 'room-b', name: '群聊 B（已刷新）', projectId: 'p', lastActivityAt: '2026-11-18T01:01:00Z' },
      ] } });
    }
    return route.fulfill({ json: { rooms: [
      { id: 'room-a', name: '群聊 A', projectId: 'p', lastActivityAt: '2026-11-18T01:06:00Z' },
      { id: 'room-b', name: '群聊 B', projectId: 'p', lastActivityAt: '2026-11-18T01:07:00Z' },
    ] } });
  });
  await racePage.goto('http://127.0.0.1:5197/validation/group-room-list.html');
  await racePage.waitForFunction(() => document.querySelector('[data-room-list]')?.textContent.includes('room-b'));
  await racePage.evaluate(async () => {
    const { publishProjectStream } = await import('/src/projectEvents.ts');
    window.emit = event => publishProjectStream('message', new MessageEvent('message', { data: JSON.stringify(event) }));
  });
  await racePage.evaluate(() => window.emit({ type: 'sessions_changed', roomId: 'room-b' }));
  await staleStarted;
  await racePage.evaluate(() => window.emit({ type: 'group_message_created', roomId: 'room-a', message: {
    id: 'race-message-a', type: 'agent', authorId: 'manager', authorName: '运营管理', agentId: 'manager',
    text: '竞态期间的新消息', sequence: 10, createdAt: '2026-11-18T01:05:00Z', attachments: [],
  } }));
  await racePage.waitForTimeout(240);
  const beforeStale = await racePage.locator('[data-room-list]').evaluate(node => JSON.parse(node.textContent || '{}'));
  assert.equal(beforeStale.rooms.find(room => room.id === 'room-a').lastActivityAt, '2026-11-18T01:05:00Z');
  releaseStale();
  await racePage.waitForTimeout(120);
  const afterStale = await racePage.locator('[data-room-list]').evaluate(node => JSON.parse(node.textContent || '{}'));
  assert.equal(afterStale.rooms.find(room => room.id === 'room-a').lastActivityAt, '2026-11-18T01:05:00Z');
  assert.equal(afterStale.rooms.find(room => room.id === 'room-a').latestMessage.text, '竞态期间的新消息');
  assert.equal(afterStale.rooms.find(room => room.id === 'room-b').name, '群聊 B（已刷新）');
  await racePage.evaluate(() => window.emit({ type: 'sessions_changed', roomId: 'room-a' }));
  await racePage.waitForTimeout(300);
  const afterNewer = await racePage.locator('[data-room-list]').evaluate(node => JSON.parse(node.textContent || '{}'));
  assert.equal(afterNewer.rooms.find(room => room.id === 'room-a').lastActivityAt, '2026-11-18T01:06:00Z');
  console.log(JSON.stringify({ raceRequests, preservedAt: afterStale.rooms.find(room => room.id === 'room-a').lastActivityAt,
    refreshedPeerName: afterStale.rooms.find(room => room.id === 'room-b').name,
    newerServerTime: afterNewer.rooms.find(room => room.id === 'room-a').lastActivityAt }));
  await racePage.close();
} finally {
  await browser.close();
}
