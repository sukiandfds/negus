import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extendGroupRooms } from '../server/group-extension.mjs';
import { createGroupRoomDirectory } from '../../windows/server/group-room-directory.mjs';

test('group creation keeps the requested members, retries once, and restores history', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-ui-groups-'));
  const services = new Map();
  const context = { stateRoot, services, projects: () => [{ projectId: 'p', name: '项目', kind: 'personal', root: stateRoot }],
    employees: () => [{ id: 'researcher', name: '产品分析', shortName: '产品', instructions: '只读调研' }, { id: 'manager', name: '运营管理', shortName: '运营', instructions: '运营' }],
    createServiceOptions: () => ({ projectRoot: stateRoot, broadcast: () => {} }), broadcast: () => {} };
  let directory;
  try {
    directory = await extendGroupRooms({ ...context, roomDirectory: createGroupRoomDirectory() });
    await assert.rejects(directory.create({ name: '群聊', projectId: 'missing', agentIds: [], requestId: 'missing' }), /项目不存在/);
    await assert.rejects(directory.create({ name: '群聊', projectId: 'p', agentIds: ['missing'], requestId: 'bad-member' }), /员工不存在/);
    const input = { name: '调研群', projectId: 'p', agentIds: ['researcher'], requestId: 'same-request' };
    const [first, repeated] = await Promise.all([directory.create(input), directory.create(input)]);
    assert.equal(first.id, repeated.id);
    assert.equal(directory.list().length, 1);
    assert.deepEqual(directory.require(first.id).snapshot().agents.map(agent => agent.id), ['researcher']);
    await directory.require(first.id).addMessage({ type: 'human', authorId: 'u', authorName: '用户', text: '仅记录，无模型执行' });
    await services.get(first.id).close();
    services.clear();
    const restored = await extendGroupRooms({ ...context, roomDirectory: createGroupRoomDirectory() });
    directory = restored;
    assert.equal(restored.list()[0].name, '调研群');
    assert.equal(restored.require(first.id).snapshot().messages.at(-1).text, '仅记录，无模型执行');
    assert.equal((await restored.create(input)).id, first.id);
    assert.equal(restored.listForAgent('manager').length, 0);
    assert.equal(restored.listForAgent('researcher').length, 1);
  } finally {
    await Promise.allSettled([...services.values()].map(service => service.close()));
    await Promise.allSettled((directory?.list() || []).map(room => directory.require(room.id).close()));
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});
