import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGroupTaskService } from '../server/group-task-service.mjs';
import { createGroupRoomStore } from '../../windows/server/group-room-store.mjs';
const until = async check => { const deadline = Date.now() + 4000; while (!check()) { if (Date.now() > deadline) assert.fail('condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

test('group intake keeps sender IDs, routes ordinary messages, @ takes priority, task tool delivers back to source', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-tasks-'));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId: 'room', project: '验证', broadcast: () => {},
    agentDefinitions: [{ id: 'a', name: '助手', responsibility: '接待' }, { id: 'b', name: '研究员', responsibility: '研究' }] });
  const listeners = new Set(); const threads = new Map(); const turns = []; let selectionCalls = 0;
  const emit = (method, threadId, turn, extra = {}) => listeners.forEach(callback => callback({ method, params: { threadId, turnId: turn.id, turn, ...extra } }));
  const complete = (threadId, turn, text) => {
    turn.items = [{ type: 'agentMessage', text }]; turn.status = 'completed';
    emit('item/completed', threadId, turn, { item: turn.items[0] }); emit('turn/completed', threadId, turn);
  };
  const client = {
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    request: async (method, params) => {
      if (method === 'thread/start') { const id = `thread-${threads.size}`; threads.set(id, { id, turns: [], config: params.config }); return { thread: { id } }; }
      const thread = threads.get(params.threadId);
      if (method === 'thread/resume') { thread.config = params.config; return { thread }; }
      if (method === 'thread/read') return { thread };
      if (method === 'turn/start') {
        const turn = { id: `turn-${turns.length}`, status: 'inProgress', items: [] }; thread.turns.push(turn); turns.push({ threadId: thread.id, turn, input: params.input });
        queueMicrotask(() => emit('turn/started', thread.id, turn));
        return { turn };
      }
      if (method === 'turn/interrupt') { const turn = thread.turns.find(item => item.id === params.turnId); turn.status = 'interrupted'; queueMicrotask(() => emit('turn/completed', thread.id, turn)); }
      return {};
    },
  };
  const service = await createGroupTaskService({ stateRoot: root, room, projectRoot: root, appServerClient: client, selectAgent: async () => { selectionCalls++; return 'b'; } });
  t.after(async () => { await service.close(); await room.close(); await fs.rm(root, { recursive: true, force: true }); });
  const send = (requestId, text) => service.receive({ requestId, agentIds: [], message: { type: 'human', authorId: 'u', authorName: '用户', text, attachments: [] } });
  const first = await send('ordinary', '帮我研究一下');
  assert.equal(first.message.clientMessageId, 'ordinary');
  assert.equal((await send('ordinary', '帮我研究一下')).message.id, first.message.id);
  await until(() => turns.length === 1);
  assert.equal(service.tasks()[0].agentId, 'b');
  complete(turns[0].threadId, turns[0].turn, '研究结果');
  await until(() => service.deliveries()[0]?.state === 'delivered');
  await send('mention', '@助手 请委派研究员查资料');
  await until(() => turns.length === 2);
  assert.equal(selectionCalls, 1);
  const source = service.tasks().find(task => task.agentId === 'a');
  const config = threads.get(turns[1].threadId).config['mcp_servers.negus_handoffs'];
  const response = await fetch(config.env.NEGUS_HANDOFF_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${config.env.NEGUS_HANDOFF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delegate', requestId: 'tool-1', agentId: 'b', title: '外派研究', instructions: '核查来源' }) });
  assert.equal(response.status, 200); const child = await response.json(); assert.equal(child.parentTaskId, source.id);
  await until(() => turns.length === 3);
  complete(turns[1].threadId, turns[1].turn, '已交给研究员');
  complete(turns[2].threadId, turns[2].turn, '来源核查完成');
  await until(() => turns.length === 4);
  assert.match(JSON.stringify(turns[3].input), /来源核查完成/);
  complete(turns[3].threadId, turns[3].turn, '根据研究结果汇总');
  await until(() => service.deliveries().length === 4 && service.deliveries().every(item => item.state === 'delivered'));
  assert.equal(room.snapshot().messages.filter(message => message.type === 'human').length, 2);
  assert.equal(room.snapshot().messages.filter(message => message.type === 'agent').length, 4);
  assert.equal(room.snapshot().agents.length, 2);
  assert.equal(service.hasPendingWork(), false);
});
