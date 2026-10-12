import { readJson, sendJson } from "../http/request-utils.mjs";
import { resolveAgentRouting } from "../multi-agent/agent-routing.mjs";

export const createGroupRoutes = ({ groupRoom, roomDirectory, media, multiAgent, multiAgentDirectory, webOutputs }) => async (request, response, url) => {
  const roomIdFrom = (body = {}) => String(body.roomId || url.searchParams.get("roomId") || groupRoom.snapshot().room.id).trim();
  const resolveRoom = (body = {}) => roomDirectory?.require(roomIdFrom(body)) || groupRoom;
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
  if (url.pathname !== "/api/group/message" || request.method !== "POST") return false;

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
