import { randomUUID } from "node:crypto";
import { readJson, sendJson } from "../http/request-utils.mjs";

export const createConversationMessageRoutes = ({ conversations, execution, followUpQueue, media, submissionStore, publishThreadEvent, employeeRuntime, authorizeAgentThread, isEmployeeDirectBinding, sessionSource, publicAttachment }) => {
  const inFlightSubmissions = new Map();
  const submissionTtlMs = 60000;
  const maxSubmissions = 200;

  const resolveStoredSubmission = async (entry) => {
    if (!entry) return null;
    if (entry.state === "accepted" && entry.result) return entry.result;
    if (entry.state === "failed") return { body: { error: entry.error || "指令发送失败", submissionId: entry.submissionId }, statusCode: 409 };
    return { body: { threadId: entry.threadId, submissionId: entry.submissionId, status: "pending" }, statusCode: 202 };
  };

  const rememberSubmission = (submissionId, fingerprint, promise) => {
    if (!submissionId) return promise;
    const existing = inFlightSubmissions.get(submissionId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        const error = new Error("submissionId was already used for a different message");
        error.statusCode = 409;
        throw error;
      }
      return existing.promise;
    }
    const timer = setTimeout(() => {
      if (inFlightSubmissions.get(submissionId)?.promise === promise) inFlightSubmissions.delete(submissionId);
    }, submissionTtlMs);
    timer.unref?.();
    inFlightSubmissions.set(submissionId, { fingerprint, promise, timer });
    while (inFlightSubmissions.size > maxSubmissions) {
      const oldestId = inFlightSubmissions.keys().next().value;
      const oldest = inFlightSubmissions.get(oldestId);
      clearTimeout(oldest?.timer);
      inFlightSubmissions.delete(oldestId);
    }
    void promise.catch(() => {
      const entry = inFlightSubmissions.get(submissionId);
      if (entry?.promise === promise) {
        clearTimeout(entry.timer);
        inFlightSubmissions.delete(submissionId);
      }
    });
    return promise;
  };

  return async (request, response, url) => {
  if (url.pathname === "/api/session/message" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const text = String(body.text || "").trim();
    const attachments = media.resolveMany(body.attachmentIds);
    if (!threadId || (!text && !attachments.length)) {
      sendJson(response, { error: "threadId and message content are required" }, 400);
      return true;
    }
    if (text.length > 32000) {
      sendJson(response, { error: "message is too long" }, 413);
      return true;
    }
    const conversationId = String(body.conversationId || "").trim();
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const employeeDirect = isEmployeeDirectBinding(binding);
    const submissionId = String(body.submissionId || "").trim().slice(0, 160) || randomUUID();
    const messageId = `optimistic-${submissionId}`;
    const createdAt = new Date().toISOString();
    const fingerprint = JSON.stringify({
      threadId,
      conversationId,
      text,
      attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds : [],
    });
    const cachedSubmission = inFlightSubmissions.get(submissionId);
    if (cachedSubmission) {
      if (cachedSubmission.fingerprint !== fingerprint) {
        const error = new Error("submissionId was already used for a different message");
        error.statusCode = 409;
        throw error;
      }
      const cachedResult = await cachedSubmission.promise;
      sendJson(response, cachedResult.body, cachedResult.statusCode);
      return true;
    }
    const storedSubmission = submissionStore?.get(submissionId);
    if (storedSubmission) {
      if (storedSubmission.fingerprint !== fingerprint) {
        const error = new Error("submissionId was already used for a different message");
        error.statusCode = 409;
        throw error;
      }
      const resolved = await resolveStoredSubmission(storedSubmission);
      sendJson(response, resolved.body, resolved.statusCode);
      return true;
    }
    const run = async () => {
      const status = execution.getStatus(threadId);
      if (!employeeDirect && status.active && !status.turnId) {
        const error = new Error("Codex 正在启动当前任务，请稍后再试");
        error.statusCode = 409;
        throw error;
      }
      publishThreadEvent(threadId, {
        type: "user_message_submitted",
        threadId,
        submissionId,
        messageId,
        text,
        attachments: attachments.map(publicAttachment),
        createdAt,
      });
      let result;
      try {
        if (employeeDirect) {
          result = await employeeRuntime.sendMessage({
            employeeId: binding.agentId,
            text,
            attachments,
            requestId: submissionId,
          });
        } else {
          result = status.active
            ? await conversations.steerMessage(threadId, status.turnId, text, attachments, submissionId)
            : await conversations.sendMessage(threadId, text, attachments, submissionId);
        }
      } catch (error) {
        if (employeeDirect) throw error;
        const recovered = execution.getStatus(threadId);
        if (status.active || !recovered.turnId || recovered.turnId === status.turnId) throw error;
        return {
          body: { threadId, turnId: recovered.turnId, status: "inProgress", recovered: true, submissionId, messageId },
          statusCode: 202,
        };
      }
      return {
        body: {
          threadId: result.threadId || threadId,
          turnId: employeeDirect ? result.turnId || "" : status.active ? status.turnId : result.turn?.id || "",
          status: employeeDirect ? result.status || "inProgress" : status.active ? "steered" : result.turn?.status || "inProgress",
          submissionId,
          messageId,
          ...(result.migratedFromThreadId ? { migratedFromThreadId: result.migratedFromThreadId } : {}),
        },
        statusCode: 202,
      };
    };
    const persistentEntry = submissionStore?.begin({
      submissionId,
      threadId,
      fingerprint,
      messageId,
      createdAt,
    });
    if (persistentEntry?.state === "accepted" && persistentEntry.result) {
      sendJson(response, persistentEntry.result.body, persistentEntry.result.statusCode);
      return true;
    }
    const submit = followUpQueue?.withThreadLock
      ? followUpQueue.withThreadLock(threadId, run)
      : run();
    const accepted = rememberSubmission(submissionId, fingerprint, submit);
    let responsePayload;
    try {
      responsePayload = await accepted;
      submissionStore?.complete(submissionId, responsePayload);
    } catch (error) {
      submissionStore?.fail(submissionId, error);
      throw error;
    }
    sendJson(response, responsePayload.body, responsePayload.statusCode);
    return true;
  }
  if (url.pathname === "/api/session/submission" && request.method === "GET") {
    const threadId = String(url.searchParams.get("threadId") || "").trim();
    const submissionId = String(url.searchParams.get("submissionId") || "").trim();
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    if (!threadId || !submissionId) {
      sendJson(response, { error: "threadId and submissionId are required" }, 400);
      return true;
    }
    await authorizeAgentThread({ threadId, conversationId });
    const entry = submissionStore?.get(submissionId);
    const resultThreadId = entry?.result?.body?.threadId || "";
    if (!entry || (entry.threadId !== threadId && resultThreadId !== threadId)) {
      sendJson(response, { threadId, submissionId, status: "unknown" });
      return true;
    }
    const resolved = await resolveStoredSubmission(entry);
    if (resolved?.body?.error) {
      sendJson(response, { ...resolved.body, status: "failed" });
      return true;
    }
    sendJson(response, {
      ...resolved.body,
      status: entry.state === "accepted" || resolved.body.status !== "pending" ? "accepted" : "pending",
    });
    return true;
  }
  if (url.pathname === "/api/session/interrupt" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const status = execution.getStatus(threadId);
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const goalSource = sessionSource(binding);
    let pausedGoal = false;
    let pauseError = null;
    try {
      const { goal } = await goalSource.getGoal(threadId, { timeoutMs: 500 });
      if (goal?.status === "active") {
        await goalSource.setGoal(threadId, { status: "paused" }, { timeoutMs: 500 });
        pausedGoal = true;
      }
    } catch (error) { pauseError = error; }
    if (!status.active || !status.turnId) {
      if (pauseError) throw pauseError;
      sendJson(response, pausedGoal ? { threadId, status: "paused" } : { error: "当前没有可停止的任务" }, pausedGoal ? 202 : 409);
      return true;
    }
    if (isEmployeeDirectBinding(binding)) await employeeRuntime.interrupt(binding.agentId, status.turnId);
    else await conversations.interrupt(threadId, status.turnId);
    if (pauseError) throw pauseError;
    sendJson(response, { threadId, turnId: status.turnId, status: "interrupting" }, 202);
    return true;
  }
  return false;
  };
};
