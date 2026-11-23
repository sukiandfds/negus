import { roomTranscript, withCopyHistory } from '../conversation-copy.mjs';
import { randomUUID } from 'node:crypto';
import { resolveConversationFile } from "../conversation-file.mjs";
import { paginationFrom, readJson, sendJson } from "../http/request-utils.mjs";

export const createConversationHistoryRoutes = ({ projectRoot, conversations, execution, followUpQueue, contextManagement, media, publishThreadEvent, agentConversationStore, employeeRuntime, roomDirectory, agentTasks, authorizeAgentThread, isEmployeeDirectBinding, sessionSource, readAgentSession, readOrdinarySession, publicUserInputRequest }) => {
  const providerCopies = new Map();
  const detailReads = new Map();
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
  if (url.pathname === "/api/session/copy" && request.method === "POST") {
    const { threadId, conversationId, roomId, title } = await readJson(request);
    let source;
    if (roomId) source = roomTranscript(roomDirectory.require(roomId));
    else {
      if (!threadId) throw Object.assign(Error("请选择要复制的对话"), { statusCode: 400 });
      const binding = await authorizeAgentThread({ threadId, conversationId, allowGroup: true });
      source = isEmployeeDirectBinding(binding) ? await employeeRuntime.copyHistory(binding.agentId)
        : await conversations.copyHistory(threadId);
    }
    if (source) source = { ...source, title: String(title || source.title || source.name || "对话").slice(0, 120) };
    const result = await withCopyHistory(source, source?.cwd || projectRoot,
      (id, copySource) => conversations.createCopy(threadId || "", id, copySource));
    publishThreadEvent(result.session.threadId, { type: "sessions_changed", threadId: result.session.threadId });
    sendJson(response, { session: result.session }, 201);
    return true;
  }
  if (url.pathname === "/api/session/fork" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const lastTurnId = String(body.lastTurnId || "").trim();
    if (!threadId || !lastTurnId) {
      sendJson(response, { error: "threadId and lastTurnId are required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const status = execution.getStatus(threadId);
    if (status.active && (!status.turnId || lastTurnId === status.turnId)) {
      sendJson(response, { error: "当前任务运行中，请完成后再从这里继续" }, 409);
      return true;
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
  if (url.pathname === "/api/session/provider-copy" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const model = String(body.model || "").trim();
    if (!threadId || !model) {
      sendJson(response, { error: "threadId and model are required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    if (binding) throw Object.assign(new Error("员工对话请在员工详情中切换模型"), { statusCode: 409 });
    if (execution.getStatus(threadId).active) throw Object.assign(new Error("当前任务运行中，请完成后再切换配置"), { statusCode: 409 });
    const reasoningEffort = String(body.reasoningEffort || "").trim();
    const requestId = String(body.requestId || "").trim().slice(0, 160);
    const key = requestId && JSON.stringify([threadId, requestId, model, reasoningEffort]);
    let copy = key && providerCopies.get(key);
    if (!copy) {
      copy = Promise.resolve(conversations.createFromProvider(threadId, model, { reasoningEffort })).then(result => {
        publishThreadEvent(result.session.threadId, { type: "sessions_changed", threadId: result.session.threadId });
        return result;
      });
      if (key) {
        providerCopies.set(key, copy);
        void copy.then(() => {
          const expiry = setTimeout(() => providerCopies.delete(key), 10 * 60_000);
          expiry.unref?.();
        }, () => providerCopies.delete(key));
      }
    }
    const result = await copy;
    sendJson(response, result, 201);
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
    if (isEmployeeDirectBinding(binding)) {
      sendJson(response, { error: "员工主对话不能归档" }, 409);
      return true;
    }
    const result = await conversations.archiveSession(threadId);
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
    if (url.searchParams.get("beforeMessageId")) pagination.beforeMessageId = url.searchParams.get("beforeMessageId");
    const binding = await authorizeAgentThread({ threadId, conversationId, allowGroup: true });
    const view = url.searchParams.get("view") === "1";
    const continuation = url.searchParams.get('details');
    if (view && continuation) {
      const read = detailReads.get(continuation);
      if (!read || read.threadId !== threadId || read.conversationId !== conversationId) {
        throw Object.assign(new Error("详情读取已过期，请刷新对话"), { statusCode: 409 });
      }
      const result = await (read.settled ? read.result() : read.promise);
      detailReads.delete(continuation);
      sendJson(response, result);
      return true;
    }
    let timer;
    const budget = view ? new Promise(resolve => { timer = setTimeout(() => resolve(false), 120); }) : null;
    const requestedRevision = view ? url.searchParams.get("sourceRevision") : null;
    const revisionSource = sessionSource(binding);
    const actor = Promise.resolve(agentTasks?.actorRevisionFor?.(threadId));
    const combineRevision = (revision, actorRevision, liveRevision) => revision
      ? [revision, actorRevision && `actor:${actorRevision}`, liveRevision && `live:${liveRevision}`].filter(Boolean).join('|') : null;
    const readRevision = async () => combineRevision(await revisionSource.getSourceRevision?.(threadId),
      await agentTasks?.actorRevisionFor?.(threadId), execution.getHistoryRevision?.(threadId));
    let currentRevision, bodyRevision;
    const initialRevision = view ? readRevision().then(value => { currentRevision = value; return value; }) : null;
    const readBody = async () => {
      if (requestedRevision && await initialRevision === requestedRevision) { bodyRevision = requestedRevision; return null; }
      let session = binding
        ? view && isEmployeeDirectBinding(binding)
          ? await employeeRuntime.readSession(binding.agentId, { ...pagination, readOnly: true })
          : await readAgentSession(binding, source, pagination)
        : await readOrdinarySession(threadId, source, pagination);
      if (session && execution.completeSession) session = execution.completeSession(session,
        !url.searchParams.has("before") && !url.searchParams.has("cursor") && !url.searchParams.has("beforeMessageId"));
      if (!session) throw Object.assign(new Error("session not found"), { statusCode: 404 });
      if (view) bodyRevision = session.sourceRevision
        ? combineRevision(session.sourceRevision, await actor, execution.getHistoryRevision?.(threadId)) : await initialRevision;
      return session;
    };
    if (view) {
      const ready = {}, errors = {};
      const capture = (key, read) => Promise.resolve().then(read).then(value => { ready[key] = value; }, error => {
        errors[key] = { message: error.message, statusCode: error.statusCode || 500 };
      });
      const complete = Promise.all([
        capture('session', readBody),
        capture('context', () => contextManagement.load(threadId)),
        capture('goal', async () => (await revisionSource.getGoal(threadId)).goal),
        capture('input', async () => publicUserInputRequest(await revisionSource.getPendingUserInput(threadId))),
        initialRevision,
      ]);
      const snapshot = (refreshBody = false, verified = false) => {
        if (errors.session) throw Object.assign(new Error(errors.session.message), { statusCode: errors.session.statusCode });
        const fields = { ...ready };
        if (refreshBody) { if (!fields.session) delete fields.session; delete fields.context; }
        // A locally validated body can ship while the independent version lookup is slow.
        if (!verified && (currentRevision === undefined || (bodyRevision !== undefined && currentRevision !== bodyRevision))) delete fields.context;
        return { ...fields, status: execution.getStatus(threadId), queue: followUpQueue.list(threadId),
          sourceRevision: currentRevision === null ? null : bodyRevision ?? null, historyFormatVersion: 5,
          ...(refreshBody ? { refreshBody: true } : {}),
          ...(Object.keys(errors).length ? { detailErrors: { ...errors } } : {}) };
      };
      const result = async () => {
        const finalRevision = await readRevision();
        const changed = currentRevision !== finalRevision || (finalRevision !== null && bodyRevision !== finalRevision);
        return { ...snapshot(changed, true), sourceRevision: changed ? bodyRevision ?? null : finalRevision };
      };
      const full = complete.then(result);
      void full.catch(() => {});
      let finished;
      try { finished = await Promise.race([full, budget]); } finally { clearTimeout(timer); }
      if (finished !== false) { sendJson(response, finished); return true; }
      const token = randomUUID();
      const read = { threadId, conversationId, promise: full, result, settled: false };
      detailReads.set(token, read);
      void full.then(() => { read.settled = true; }, () => { read.settled = true; });
      const expiry = setTimeout(() => detailReads.delete(token), 60000);
      expiry.unref?.();
      sendJson(response, { ...snapshot(), details: token });
      return true;
    }
    const session = await readBody();
    sendJson(response, session);
    return true;
  }
  return false;
  };
};
