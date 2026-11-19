import { readJson, sendJson } from "../http/request-utils.mjs";
import { resolveAgentRouting } from "../multi-agent/agent-routing.mjs";

export const createGroupRoutes = ({ groupRoom, roomDirectory, media, multiAgent, multiAgentDirectory, webOutputs }) => async (request, response, url) => {
  const roomIdFrom = (body = {}) => String(body.roomId || url.searchParams.get("roomId") || groupRoom.snapshot().room.id).trim();
  const resolveRoom = (body = {}) => roomDirectory?.require(roomIdFrom(body)) || groupRoom;
  const rooms = () => roomDirectory?.list?.() || [groupRoom.snapshot().room];
  const resolveRoomById = roomId => roomDirectory?.require(String(roomId || "").trim()) || groupRoom;
  const resolveAgentService = (roomId) => multiAgentDirectory?.get(roomId) || multiAgent;

  if (url.pathname === "/api/group/rooms" && request.method === "GET") {
    sendJson(response, { rooms: roomDirectory?.list?.() || [groupRoom.snapshot().room] });
    return true;
  }
  if (url.pathname === "/api/group/snapshot") {
    const room = resolveRoom();
    const page = room.getMessagePage();
    sendJson(response, { ...room.snapshot(), messages: page.messages, history: { ...page, messages: undefined } });
    return true;
  }
  if (url.pathname === "/api/group/messages" && request.method === "GET") {
    const room = resolveRoom();
    sendJson(response, room.getMessagePage({
      beforeSequence: url.searchParams.get("before"),
      afterSequence: url.searchParams.get("after"),
      aroundSequence: url.searchParams.get("around"),
      date: url.searchParams.get("date"),
      limit: url.searchParams.get("limit"),
    }));
    return true;
  }
  if ((url.pathname === "/api/group/join" || url.pathname === "/api/group/presence") && request.method === "POST") {
    const body = await readJson(request);
    sendJson(response, resolveRoom(body).touchMember(body.memberId, body.name));
    return true;
  }
  if (url.pathname === "/api/group/agent-settings" && request.method === "POST") {
    const body = await readJson(request);
    const room = resolveRoom(body);
    const service = resolveAgentService(room.snapshot().room.id);
    const agentId = String(body.agentId || "").trim();
    const modelProviderId = String(body.modelProviderId || "current").trim();
    const model = String(body.model || "").trim();
    const reasoningEffort = String(body.reasoningEffort || "").trim();
    if (!agentId || !modelProviderId || !model) {
      sendJson(response, { error: "Agent、模型供应商和模型不能为空" }, 400);
      return true;
    }
    sendJson(response, await service.updateAgentSettings(agentId, { modelProviderId, model, reasoningEffort }));
    return true;
  }
  if (url.pathname === "/api/group/interrupt" && request.method === "POST") {
    const body = await readJson(request);
    const room = resolveRoom(body);
    const service = resolveAgentService(room.snapshot().room.id);
    sendJson(response, await service.interruptDiscussion(), 202);
    return true;
  }
  if (url.pathname === "/api/group/share-targets" && request.method === "GET") {
    const sourceRoom = roomDirectory?.require(url.searchParams.get("sourceRoomId") || groupRoom.snapshot().room.id) || groupRoom;
    const agentId = String(url.searchParams.get("agentId") || "").trim();
    if (!agentId || !sourceRoom.getAgent(agentId)) {
      sendJson(response, { error: "只有本群员工的回复可以带到其他群" }, 403);
      return true;
    }
    const targets = rooms()
      .map(room => room?.snapshot ? room : roomDirectory?.require?.(room.id))
      .filter(Boolean)
      .filter(room => room.snapshot().room.id !== sourceRoom.snapshot().room.id
        && !room.snapshot().room.archived && room.getAgent(agentId))
      .map(room => ({ id: room.snapshot().room.id, name: room.snapshot().room.name }));
    sendJson(response, { agent: { id: agentId, name: sourceRoom.getAgent(agentId).name }, rooms: targets });
    return true;
  }
  if (url.pathname === "/api/group/share" && request.method === "POST") {
    const body = await readJson(request);
    const sourceRoom = resolveRoomById(body.sourceRoomId);
    const targetRoom = resolveRoomById(body.targetRoomId);
    const sourceId = sourceRoom.snapshot().room.id;
    const targetId = targetRoom.snapshot().room.id;
    const requestId = String(body.requestId || "").trim();
    const message = sourceRoom.getMessage(String(body.messageId || "").trim());
    if (!requestId || requestId.length > 100 || !sourceId || !targetId || sourceId === targetId) {
      sendJson(response, { error: "群消息分享参数不完整" }, 400);
      return true;
    }
    if (targetRoom.snapshot().room.archived) {
      sendJson(response, { error: "目标群聊已归档" }, 409);
      return true;
    }
    if (!message || message.type !== "agent" || !message.agentId) {
      sendJson(response, { error: "只能分享员工回复" }, 403);
      return true;
    }
    if (message.authorId !== message.agentId) {
      sendJson(response, { error: "群消息作者与员工身份不一致" }, 403);
      return true;
    }
    const targetAgent = targetRoom.getAgent(message.agentId);
    if (!sourceRoom.getAgent(message.agentId) || !targetAgent) {
      sendJson(response, { error: "该员工无权在目标群聊发言" }, 403);
      return true;
    }
    if (!message.text.trim()) {
      sendJson(response, { error: "消息没有可分享的文字" }, 400);
      return true;
    }
    if (message.text.length > 12000) {
      sendJson(response, { error: "回复内容过长，无法带到其他群" }, 413);
      return true;
    }
    const clientMessageId = `group-share:${requestId}`;
    const existing = targetRoom.snapshot().messages.find(candidate => candidate.clientMessageId === clientMessageId);
    if (existing) {
      if (existing.authorId !== message.agentId || existing.text !== message.text) {
        sendJson(response, { error: "请求编号已用于其他分享" }, 409);
        return true;
      }
      sendJson(response, { message: existing, deduplicated: true }, 200);
      return true;
    }
    const result = await targetRoom.addMessageWithStatus({
      type: "agent",
      authorId: message.agentId,
      authorName: targetAgent.name,
      agentId: message.agentId,
      targetAgentIds: [],
      text: message.text,
      clientMessageId,
      preserveText: true,
    });
    sendJson(response, { message: result.message, deduplicated: !result.created }, result.created ? 201 : 200);
    return true;
  }
  if (url.pathname === "/api/group/forward" && request.method === "POST") {
    const body = await readJson(request);
    const sourceRoom = resolveRoomById(body.sourceRoomId);
    const targetRoom = resolveRoomById(body.targetRoomId);
    const sourceId = sourceRoom.snapshot().room.id;
    const targetId = targetRoom.snapshot().room.id;
    const requestId = String(body.requestId || "").trim();
    const memberId = String(body.memberId || "").trim();
    const authorName = String(body.authorName || "").trim();
    const sourceMessageIds = [...new Set((Array.isArray(body.messageIds) ? body.messageIds : [])
      .map(value => String(value || "").trim()).filter(Boolean))].slice(0, 50);
    if (!sourceId || !targetId || sourceId === targetId || !requestId || requestId.length > 100 || !memberId || !authorName) {
      sendJson(response, { error: "转发参数不完整" }, 400);
      return true;
    }
    if (targetRoom.snapshot().room.archived) {
      sendJson(response, { error: "目标群聊已归档" }, 409);
      return true;
    }
    const selected = sourceMessageIds.map(id => sourceRoom.getMessage(id));
    if (!sourceMessageIds.length || selected.some(message => !message || message.type === "system" || !message.text.trim())) {
      sendJson(response, { error: "选中的消息已变化或没有可转发文字" }, 409);
      return true;
    }
    const text = [`来源：${sourceRoom.snapshot().room.name}`, ...selected.map(message => [
      [message.authorName || "成员", message.createdAt].filter(Boolean).join(" · "),
      message.text,
    ].join("\n"))].join("\n\n");
    if (text.length > 32000) {
      sendJson(response, { error: "转发内容过长" }, 413);
      return true;
    }
    const clientMessageId = `group-forward:${targetId}:${requestId}`;
    const existing = targetRoom.snapshot().messages.find(candidate => candidate.clientMessageId === clientMessageId);
    if (existing) {
      if (existing.authorId !== memberId || existing.text !== text) {
        sendJson(response, { error: "请求编号已用于其他转发" }, 409);
        return true;
      }
      sendJson(response, { message: existing, execution: null, targetRoomId: targetId, sourceRoomId: sourceId }, 200);
      return true;
    }
    targetRoom.touchMember(memberId, authorName);
    const targetService = resolveAgentService(targetId);
    const result = await targetService.receive({
      requestId: clientMessageId,
      agentIds: [],
      message: { type: "human", authorId: memberId, authorName, text, replyTo: null, attachments: [] },
    });
    sendJson(response, { ...result, targetRoomId: targetId, sourceRoomId: sourceId }, 202);
    return true;
  }
  if (url.pathname !== "/api/group/message" || !["POST", "PATCH"].includes(request.method)) return false;

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const room = resolveRoom(body);
    const member = room.touchMember(body.memberId, body.authorName);
    const messageId = String(body.messageId || "").trim();
    if (!messageId) {
      sendJson(response, { error: "群消息标识不能为空" }, 400);
      return true;
    }
    sendJson(response, {
      message: await room.editMessage(messageId, {
        authorId: member.id,
        clientMessageId: String(body.clientMessageId || "").trim(),
        text: body.text,
      }),
    });
    return true;
  }

  const body = await readJson(request);
  const room = resolveRoom(body);
  const service = resolveAgentService(room.snapshot().room.id);
  const member = room.touchMember(body.memberId, body.authorName);
  const text = String(body.text || "").trim();
  const attachments = media.resolveMany(body.attachmentIds);
  if (!text && !attachments.length) {
    sendJson(response, { error: "消息不能为空" }, 400);
    return true;
  }
  const agents = room.snapshot().agents;
  const quotedMessage = body.replyTo?.id
    ? room.snapshot().messages.find((candidate) => candidate.id === String(body.replyTo.id))
    : null;
  const quotedAgentId = quotedMessage?.type === "agent"
    ? String(quotedMessage.agentId || quotedMessage.authorId || "").trim()
    : "";
  const requestedAgentIds = Array.isArray(body.agentIds)
    ? body.agentIds
    : [body.agentId || quotedAgentId];
  const { explicitAgentIds, targetAgentIds, broadcast } = resolveAgentRouting({
    text,
    requestedAgentIds,
    agents,
  });
  const { message, created } = await room.addMessageWithStatus({
    type: "human",
    authorId: member.id,
    authorName: member.name,
    clientMessageId: body.clientMessageId,
    agentId: targetAgentIds[0],
    targetAgentIds,
    replyTo: body.replyTo,
    text,
    attachments: attachments.map(({ id, name, mimeType, url: attachmentUrl }) => ({ id, name, mimeType, url: attachmentUrl })),
  });
  if (!created) {
    const dispatchFailed = room.snapshot().messages.some((candidate) => candidate.type === "system"
      && candidate.failure === true && candidate.replyTo?.id === message.id
      && String(candidate.text || "").startsWith("派工失败："));
    if (!dispatchFailed) {
      sendJson(response, { message, execution: null, deduplicated: true }, 202);
      return true;
    }
  }
  if (!targetAgentIds.length) {
    sendJson(response, { message, execution: null, mode: "listening", listening: true,
      notice: "消息已进入群聊，但没有派给员工。请点名员工或使用‘各位/所有人’广播。" }, 202);
    return true;
  }
  let execution;
  try {
    execution = await service.enqueueDiscussion({
      agentIds: targetAgentIds,
      requestText: text || "请查看附件并根据内容进行处理。",
      attachments,
      sourceMessageId: message.id,
      explicitAgentIds,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await room.markMessageFailure?.(message.id, true);
    await room.addMessage({
      type: "system",
      authorId: "system",
      authorName: "系统",
      agentId: targetAgentIds[0] || null,
      failure: true,
      replyTo: { id: message.id },
      text: `派工失败：${detail}。请检查员工连接后重试。`,
    });
    sendJson(response, {
      message,
      execution: { mode: broadcast ? "broadcast" : "targeted", status: "failed",
        assignmentId: message.id, agentIds: targetAgentIds,
        targets: targetAgentIds.map((agentId) => ({ id: agentId, state: "failed" })),
        error: detail },
      error: detail,
    }, error?.statusCode || 503);
    return true;
  }
  if (!created) await room.markMessageFailure?.(message.id, false);
  sendJson(response, { message, execution: { ...execution,
    mode: broadcast ? "broadcast" : "targeted",
    assignmentId: message.id,
    targets: targetAgentIds.map((agentId) => ({ id: agentId, state: "queued" })),
  }, retried: !created }, 202);
  return true;
};
