import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createGroupRoomStore } from '../../windows/server/group-room-store.mjs';
import { createGroupRoomDirectory } from '../../windows/server/group-room-directory.mjs';
import { createGroupTaskService } from './group-task-service.mjs';
import { readJson, sendJson } from '../../windows/server/http/request-utils.mjs';

// Injectable extension: reuse host authentication, room storage, execution and SSE.
export async function extendGroupRooms({ stateRoot, roomDirectory, services, projects, employees, createServiceOptions, broadcast, onMessageCreated }) {
  const file = path.join(stateRoot, 'rooms.json');
  const rooms = roomDirectory.list().map(room => roomDirectory.require(room.id));
  let records = [];
  try { records = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const original = new Set(rooms.map(room => room.snapshot().room.id));
  const decorate = () => {
    Object.assign(roomDirectory, createGroupRoomDirectory({ rooms }));
    roomDirectory.list = () => rooms.map(store => { const snapshot = store.snapshot(); return { ...snapshot.room, lastActivityAt: snapshot.messages.at(-1)?.createdAt || snapshot.room.lastActivityAt }; });
  };
  decorate();
  for (const store of rooms) {
    const snapshot = store.snapshot();
    const identity = projects().find(project => project.projectId === snapshot.room.projectId);
    if (!identity) throw new Error('群聊关联项目不存在');
    await services.get(snapshot.room.id)?.close();
    services.set(snapshot.room.id, await createGroupTaskService({ ...createServiceOptions(identity, store), room: store,
      stateRoot: path.join(stateRoot, 'tasks', snapshot.room.id) }));
  }
  const pending = new Map();
  let writes = Promise.resolve();
  const save = () => {
    const text = JSON.stringify(records, null, 2);
    writes = writes.catch(() => {}).then(async () => { await fs.mkdir(stateRoot, { recursive: true }); await fs.writeFile(`${file}.tmp`, text); await fs.rename(`${file}.tmp`, file); });
    return writes;
  };
  const register = async record => {
    const identity = projects().find(project => project.projectId === record.projectId && project.kind !== 'employee');
    if (!identity) throw Object.assign(new Error('群聊关联项目不存在'), { statusCode: 400 });
    const profiles = employees().filter(employee => record.agentIds.includes(employee.id));
    if (profiles.length !== record.agentIds.length) throw Object.assign(new Error('群聊员工不存在'), { statusCode: 400 });
    const store = await createGroupRoomStore({ stateFile: path.join(stateRoot, `${record.id}.json`), project: identity.name,
      projectId: identity.projectId, roomId: record.id, agentDefinitions: profiles, broadcast, onMessageCreated });
    const snapshot = store.snapshot;
    store.snapshot = () => { const data = snapshot(); return { ...data, room: { ...data.room, name: record.name, lastActivityAt: data.messages.at(-1)?.createdAt || record.createdAt } }; };
    const service = await createGroupTaskService({ ...createServiceOptions(identity, store), room: store,
      stateRoot: path.join(stateRoot, 'tasks', record.id) });
    services.set(record.id, service);
    rooms.push(store);
    decorate();
    return store.snapshot().room;
  };
  for (const record of records) if (!original.has(record.id)) await register(record);
  roomDirectory.create = async input => {
    const requestId = typeof input.requestId === 'string' && /^[\w-]{1,80}$/.test(input.requestId) ? input.requestId : '';
    if (!requestId) throw Object.assign(new Error('创建请求标识无效'), { statusCode: 400 });
    const saved = records.find(record => record.requestId === requestId);
    if (saved) return roomDirectory.require(saved.id).snapshot().room;
    if (pending.has(requestId)) return pending.get(requestId);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw Object.assign(new Error('请填写群聊名称'), { statusCode: 400 });
    const agentIds = [...new Set(Array.isArray(input.agentIds) ? input.agentIds : [])];
    const record = { id: `chat-${randomUUID()}`, name, projectId: String(input.projectId || ''), agentIds, requestId, createdAt: new Date().toISOString() };
    const work = (async () => {
      const room = await register(record);
      records.push(record);
      await save();
      broadcast({ type: 'sessions_changed', roomId: room.id });
      return room;
    })().finally(() => pending.delete(requestId));
    pending.set(requestId, work);
    return work;
  };
  return roomDirectory;
}

export function createGroupCreationRoute({ roomDirectory }) {
  return async (request, response, url) => {
    if (url.pathname !== '/api/group/rooms' || request.method !== 'POST') return false;
    sendJson(response, { room: await roomDirectory.create(await readJson(request)) }, 201);
    return true;
  };
}
