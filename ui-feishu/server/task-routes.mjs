import { randomUUID } from 'node:crypto';
import { readJson, sendJson } from '../../windows/server/http/request-utils.mjs';

// Inserted behind the host's existing authentication and maintenance gate.
export function createTaskRoutes({ roomDirectory, multiAgentDirectory, groupRoom, media, agentTasks }) {
  return async (request, response, url) => {
    if (url.pathname === '/api/tasks' && request.method === 'GET') {
      const selected = url.searchParams.get('roomId');
      const tasks = [];
      for (const room of roomDirectory.list()) {
        if (selected && room.id !== selected) continue;
        const service = multiAgentDirectory.get(room.id);
        for (const task of service?.tasks?.() || []) tasks.push({ ...task, roomId: room.id, roomName: room.name,
          agentName: roomDirectory.require(room.id).getAgent(task.agentId)?.name || task.agentId,
          delivery: service.deliveries().find(item => item.taskId === task.id) });
      }
      if (!selected) for (const task of agentTasks?.tasks?.() || []) tasks.push({ ...task,
        delivery: agentTasks.deliveries().find(item => item.taskId === task.id) });
      sendJson(response, { tasks }); return true;
    }
    if (url.pathname === '/api/tasks/action' && request.method === 'POST') {
      const body = await readJson(request);
      const service = body.roomId ? multiAgentDirectory.get(roomDirectory.require(body.roomId).snapshot().room.id) : agentTasks;
      if (!service?.tasks?.().some(task => task.id === body.taskId)) throw Object.assign(Error('任务不存在'), { statusCode: 404 });
      if (body.action === 'stop') sendJson(response, await service.cancelTask(body.taskId), 202);
      else if (body.action === 'reconcile') { await service.reconcileTask(body.taskId); sendJson(response, { accepted: true }, 202); }
      else if (body.action === 'retry-delivery') { await service.retryDelivery(`result:${body.taskId}`); sendJson(response, { accepted: true }, 202); }
      else throw Object.assign(Error('不支持的任务操作'), { statusCode: 400 });
      return true;
    }
    if (url.pathname !== '/api/group/message' || request.method !== 'POST') return false;
    const body = await readJson(request);
    const room = roomDirectory.require(body.roomId || url.searchParams.get('roomId') || groupRoom.snapshot().room.id);
    const service = multiAgentDirectory.get(room.snapshot().room.id);
    const member = room.touchMember(body.memberId, body.authorName);
    const text = String(body.text || '').trim();
    const attachments = media.resolveMany(body.attachmentIds);
    if (!text && !attachments.length) throw Object.assign(Error('消息不能为空'), { statusCode: 400 });
    if (!room.snapshot().agents.length) throw Object.assign(Error('当前群聊没有可接待的员工'), { statusCode: 409 });
    const requestId = String(body.clientMessageId || randomUUID());
    if (requestId.length > 80) throw Object.assign(Error('消息重试标识过长'), { statusCode: 400 });
    const result = await service.receive({ requestId, agentIds: Array.isArray(body.agentIds) ? body.agentIds : [body.agentId],
      message: { type: 'human', authorId: member.id, authorName: member.name, text, replyTo: body.replyTo,
        attachments: attachments.map(({ id, name, mimeType, url }) => ({ id, name, mimeType, url })) } });
    sendJson(response, result, 202); return true;
  };
}
