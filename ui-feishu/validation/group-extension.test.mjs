import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extendGroupRooms } from '../server/group-extension.mjs';
import { createGroupRoomDirectory } from '../../windows/server/group-room-directory.mjs';

test('group creation makes name and members optional, retries once, and restores history', async () => {
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
    const recordsFile = path.join(stateRoot, 'rooms.json');
    const records = JSON.parse(await fs.readFile(recordsFile, 'utf8'));
    records[0].agentIds = ['researcher'];
    await fs.writeFile(recordsFile, JSON.stringify(records));
    const restored = await extendGroupRooms({ ...context, roomDirectory: createGroupRoomDirectory() });
    directory = restored;
    assert.equal(restored.list()[0].name, '调研群');
    assert.equal(restored.require(first.id).snapshot().messages.at(-1).text, '仅记录，无模型执行');
    assert.equal((await restored.create(input)).id, first.id);
    assert.equal(restored.listForAgent('researcher').length, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(recordsFile, 'utf8'))[0].agentIds, ['researcher']);
    const empty = await restored.create({ name: '', projectId: 'p', agentIds: [], requestId: 'empty' });
    assert.equal(empty.name, '未命名群聊');
    assert.deepEqual(restored.require(empty.id).snapshot().agents, []);
    const updated = await restored.update(empty.id, { name: '空群改名', archived: true });
    assert.equal(updated.name, '空群改名');
    assert.equal(updated.archived, true);
  } finally {
    await Promise.allSettled([...services.values()].map(service => service.close()));
    await Promise.allSettled((directory?.list() || []).map(room => directory.require(room.id).close()));
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});
