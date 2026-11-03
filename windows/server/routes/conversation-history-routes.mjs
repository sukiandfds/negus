import { resolveConversationFile } from "../conversation-file.mjs";
import { paginationFrom, readJson, sendJson } from "../http/request-utils.mjs";

export const createConversationHistoryRoutes = ({ conversations, execution, followUpQueue, contextManagement, media, publishThreadEvent, agentConversationStore, employeeRuntime, roomDirectory, agentTasks, authorizeAgentThread, isEmployeeDirectBinding, sessionSource, readAgentSession, readOrdinarySession, publicUserInputRequest }) => {
  return async (request, response, url) => {
  if (url.pathname === "/api/session/file" && request.method === "GET") {
    const threadId = url.searchParams.get("threadId") || "";
    const conversationId = url.searchParams.get("conversationId") || "";
    const binding = await authorizeAgentThread({ threadId, conversationId, allowGroup: true });
    const session = binding ? await readAgentSession(binding, "all", {}) : await readOrdinarySession(threadId, "all", {});
    const file = await resolveConversationFile(session, url.searchParams.get("messageId"), url.searchParams.get("href"));
    await media.serve(request, response, media.register(file).id, { text: true });
    return true;
  }
  if (url.pathname === "/api/session/name" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const name = String(body.name || "").trim();
    if (!threadId || !name) {
      sendJson(response, { error: "threadId and name are required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    if (name.length > 120) {
      sendJson(response, { error: "name is too long" }, 413);
      return true;
    }
    const session = isEmployeeDirectBinding(binding)
      ? await employeeRuntime.renameSession(binding.agentId, name)
      : await conversations.renameSession(threadId, name);
    publishThreadEvent(threadId, { type: "sessions_changed", threadId });
    sendJson(response, session, 202);
    return true;
  }
  if (url.pathname === "/api/session/review" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    if (execution.getStatus(threadId).active) {
      sendJson(response, { error: "当前任务完成后才能开始审查" }, 409);
      return true;
    }
    if (isEmployeeDirectBinding(binding)) await employeeRuntime.reviewSession(binding.agentId);
    else await conversations.reviewSession(threadId);
    publishThreadEvent(threadId, { type: "sessions_changed", threadId });
    sendJson(response, { threadId, status: "started" }, 202);
    return true;
  }
  if (url.pathname === "/api/session/revert" && request.method === "POST") {
    const { threadId, conversationId, beforeTurnId } = await readJson(request);
    if (!threadId || !beforeTurnId) throw Object.assign(new Error("请选择要重新编辑的消息"), { statusCode: 400 });
    const binding = await authorizeAgentThread({ threadId, conversationId });
    if (execution.getStatus(threadId).active) throw Object.assign(new Error("请先停止当前回复再重新编辑"), { statusCode: 409 });
    if (isEmployeeDirectBinding(binding)) await employeeRuntime.revertSession(binding.agentId, beforeTurnId);
    else await conversations.revertSession(threadId, beforeTurnId);
    execution.clearCompletedMessages?.(threadId);
    publishThreadEvent(threadId, { type: "sessions_changed", threadId });
    sendJson(response, { threadId });
    return true;
  }
  if (url.pathname === "/api/session/fork" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    let lastTurnId = String(body.lastTurnId || "").trim();
    if (!threadId || (!lastTurnId && body.latest !== true)) {
      sendJson(response, { error: "threadId and lastTurnId are required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const status = execution.getStatus(threadId);
    if (status.active && (body.latest === true || !status.turnId || lastTurnId === status.turnId)) {
      sendJson(response, { error: "当前任务运行中，请完成后再从这里继续" }, 409);
      return true;
    }
    if (body.latest === true) {
      const source = binding ? await readAgentSession(binding, "all", { limit: 1 })
        : await conversations.findSession(threadId, "all", { limit: 1 });
      if (!source || source.archived || source.readOnly) throw Object.assign(new Error("请先恢复可操作的源对话"), { statusCode: 409 });
      lastTurnId = source.messages?.at(-1)?.turnId || "";
      if (!lastTurnId) throw Object.assign(new Error("对话尚无可创建分支的消息"), { statusCode: 409 });
    }
    const session = isEmployeeDirectBinding(binding)
      ? await employeeRuntime.forkSession(binding.agentId, lastTurnId)
      : await conversations.forkSession(threadId, lastTurnId);
    sendJson(response, {
      session,
      sourceThreadId: threadId,
      forkedFromTurnId: lastTurnId,
    }, 201);
    return true;
  }
  if (url.pathname === "/api/session/archive" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    if (execution.getStatus(threadId).active) {
      sendJson(response, { error: "当前任务运行中，请完成后再归档" }, 409);
      return true;
    }
    const result = isEmployeeDirectBinding(binding)
      ? await employeeRuntime.archiveSession(binding.agentId)
      : await conversations.archiveSession(threadId);
    publishThreadEvent(threadId, { type: "sessions_changed", threadId });
    sendJson(response, result, 202);
    return true;
  }
  if (url.pathname === "/api/session/unarchive" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const result = isEmployeeDirectBinding(binding)
      ? await employeeRuntime.unarchiveSession(binding.agentId)
      : await conversations.unarchiveSession(threadId);
    publishThreadEvent(threadId, { type: "sessions_changed", threadId });
    sendJson(response, result, 202);
    return true;
  }
  if (url.pathname === "/api/sessions") {
    const archived = url.searchParams.get("archived") === "1";
    const source = url.searchParams.get("source") || "all";
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    if (conversationId && agentConversationStore) {
      const binding = await agentConversationStore.resolve({ conversationId });
      if (binding.conversationKind !== "direct" && binding.conversationKind !== "group"
        && !(binding.conversationKind === "task" && agentTasks?.ownsThread(binding.runtimeSessionId))) {
        sendJson(response, { error: "该 Agent 对话不是独立单聊" }, 409);
        return true;
      }
      const session = await readAgentSession(binding, source, {});
      const matchesFilter = session
        && Boolean(session.archived) === archived
        && (source === "all" || session.source === source);
      if (!matchesFilter) {
        sendJson(response, []);
        return true;
      }
      const { messages, file, ...summary } = session;
      sendJson(response, [summary]);
      return true;
    }
    const sessions = await conversations.listSessions(source, archived);
    const groupThreadIds = new Set(roomDirectory?.threadIds?.() || []);
    const visibleSessions = sessions.filter((session) => {
      const threadId = String(session?.threadId || "").trim();
      if (!threadId) return false;
      if (employeeRuntime?.ownsThread?.(threadId)) return false;
      if (groupThreadIds.has(threadId)) return false;
      return !agentConversationStore?.findByRuntimeSession?.("codex", threadId);
    });
    sendJson(response, visibleSessions.map(({ messages, file, ...summary }) => summary));
    return true;
  }
  if (url.pathname === "/api/session" && request.method === "POST") {
    const body = await readJson(request);
    sendJson(response, await conversations.createSession(
      String(body.model || "").trim(),
      String(body.projectRoot || "").trim(),
      String(body.modelProviderId || "").trim(),
      { createdBy: body.createdBy },
    ), 201);
    return true;
  }
  if (url.pathname === "/api/session") {
    const threadId = url.searchParams.get("threadId") || "";
    const conversationId = url.searchParams.get("conversationId") || "";
    const source = url.searchParams.get("source") || "all";
    const pagination = paginationFrom(url);
    const binding = await authorizeAgentThread({ threadId, conversationId, allowGroup: true });
    const view = url.searchParams.get("view") === "1";
    const requestedRevision = view ? url.searchParams.get("sourceRevision") : null;
    const revisionSource = sessionSource(binding);
    const readRevision = async () => {
      const revision = await Promise.resolve().then(() => revisionSource.getSourceRevision(threadId)).catch(() => null);
      const actorRevision = agentTasks?.actorRevisionFor?.(threadId);
      return revision && actorRevision ? `${revision}|actor:${actorRevision}` : revision;
    };
    const currentRevision = view ? await readRevision() : null;
    const reuseBody = Boolean(requestedRevision && currentRevision === requestedRevision);
    let session = reuseBody ? null : binding
      ? view && isEmployeeDirectBinding(binding)
        ? await employeeRuntime.readSession(binding.agentId, { ...pagination, readOnly: true })
        : await readAgentSession(binding, source, pagination)
      : await readOrdinarySession(threadId, source, pagination);
    if (session && execution.completeSession) session = execution.completeSession(session,
      !url.searchParams.has("before") && !url.searchParams.has("cursor"));
    if (!session && !reuseBody) {
      sendJson(response, { error: "session not found" }, 404);
      return true;
    }
    if (view) {
      const source = sessionSource(binding);
      const [context, goal, input] = await Promise.all([
        contextManagement.load(threadId), source.getGoal(threadId), source.getPendingUserInput(threadId),
      ]);
      const finalRevision = await readRevision();
      if (currentRevision !== finalRevision) throw Object.assign(new Error("对话更新中，请重试同步"), { statusCode: 409 });
      sendJson(response, { session, context, goal: goal.goal, status: execution.getStatus(threadId),
        queue: followUpQueue.list(threadId), input: publicUserInputRequest(input), sourceRevision: finalRevision, historyFormatVersion: 3 });
      return true;
    }
    sendJson(response, session);
    return true;
  }
  return false;
  };
};
