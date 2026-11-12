import { randomUUID } from "node:crypto";
import { paginationFrom, readJson, sendJson } from "../http/request-utils.mjs";

const publicAttachment = ({ id, name, mimeType, url, width, height }) => ({
  id,
  name,
  mimeType,
  url,
  ...(Number.isSafeInteger(width) && Number.isSafeInteger(height) ? { width, height } : {}),
});

const maxMessageLength = 32000;
const submissionTtlMs = 60000;
const maxSubmissions = 200;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const requiredText = (value, message) => {
  const text = String(value || "").trim();
  if (!text) throw httpError(400, message);
  return text;
};

export const createConversationRoutes = ({ conversations, execution, contextManagement, media, broadcast = () => {} }) => {
  // A browser that never saw the response (tunnel timeout, phone asleep)
  // retries with the same submissionId; replaying the first outcome keeps one
  // user action from starting two turns.
  const submissions = new Map();

  const forgetSubmission = (submissionId, entry) => {
    if (submissions.get(submissionId) !== entry) return;
    clearTimeout(entry.timer);
    submissions.delete(submissionId);
  };

  const rememberSubmission = (submissionId, fingerprint, outcome) => {
    const entry = { fingerprint, outcome };
    entry.timer = setTimeout(() => forgetSubmission(submissionId, entry), submissionTtlMs);
    entry.timer.unref?.();
    submissions.set(submissionId, entry);
    while (submissions.size > maxSubmissions) {
      const [oldestId, oldest] = submissions.entries().next().value;
      forgetSubmission(oldestId, oldest);
    }
    // A failed submission may be retried as a fresh attempt.
    outcome.catch(() => forgetSubmission(submissionId, entry));
  };

  const assertIdle = (threadId, message) => {
    if (execution.getStatus(threadId).active) throw httpError(409, message);
  };

  const submitMessage = async (body) => {
    const threadId = String(body.threadId || "").trim();
    const text = String(body.text || "").trim();
    const attachments = media.resolveMany(body.attachmentIds);
    if (!threadId || (!text && !attachments.length)) throw httpError(400, "threadId and message content are required");
    if (text.length > maxMessageLength) throw httpError(413, "message is too long");

    const submissionId = String(body.submissionId || "").trim().slice(0, 160) || randomUUID();
    const fingerprint = JSON.stringify({ threadId, text, attachmentIds: attachments.map((attachment) => attachment.id) });
    const repeated = submissions.get(submissionId);
    if (repeated) {
      if (repeated.fingerprint !== fingerprint) throw httpError(409, "submissionId was already used for a different message");
      return repeated.outcome;
    }

    const status = execution.getStatus(threadId);
    if (status.active && !status.turnId) throw httpError(409, "Codex 正在启动当前任务，请稍后再试");

    const messageId = `optimistic-${submissionId}`;
    const accepted = (turnId, turnStatus, extra = {}) => ({ threadId, turnId, status: turnStatus, ...extra, submissionId, messageId });
    const outcome = (async () => {
      // Checked before the message is announced to other devices, so a
      // thread outside this project never produces a visible message.
      await conversations.assertProjectThread?.(threadId);
      broadcast({
        type: "user_message_submitted",
        threadId,
        submissionId,
        messageId,
        text,
        attachments: attachments.map(publicAttachment),
        createdAt: new Date().toISOString(),
      });
      if (status.active) {
        await conversations.steerMessage(threadId, status.turnId, text, attachments);
        return accepted(status.turnId, "steered");
      }
      try {
        const result = await conversations.sendMessage(threadId, text, attachments);
        return accepted(result.turn?.id || "", result.turn?.status || "inProgress");
      } catch (error) {
        // The request can time out after Codex has already started the turn;
        // a new turn id on the tracker is proof that it did.
        const recovered = execution.getStatus(threadId);
        if (!recovered.turnId || recovered.turnId === status.turnId) throw error;
        return accepted(recovered.turnId, "inProgress", { recovered: true });
      }
    })();
    rememberSubmission(submissionId, fingerprint, outcome);
    return outcome;
  };

  const postRoutes = {
    "/api/session": async (body) => [201, await conversations.createSession(String(body.model || "").trim())],
    "/api/session/message": async (body) => [202, await submitMessage(body)],
    "/api/session/model": async (body) => {
      const threadId = requiredText(body.threadId, "threadId and model are required");
      const model = requiredText(body.model, "threadId and model are required");
      assertIdle(threadId, "当前任务运行中，请在完成后切换模型");
      return [200, await conversations.updateModel(threadId, model)];
    },
    "/api/session/reasoning-effort": async (body) => {
      const threadId = requiredText(body.threadId, "threadId and reasoningEffort are required");
      const reasoningEffort = requiredText(body.reasoningEffort, "threadId and reasoningEffort are required");
      assertIdle(threadId, "当前任务运行中，请在完成后调整推理强度");
      return [200, await conversations.updateReasoningEffort(threadId, reasoningEffort)];
    },
    "/api/session/interrupt": async (body) => {
      const threadId = String(body.threadId || "").trim();
      const status = execution.getStatus(threadId);
      if (!threadId || !status.active || !status.turnId) throw httpError(409, "当前没有可停止的任务");
      await conversations.interrupt(threadId, status.turnId);
      return [202, { threadId, turnId: status.turnId, status: "interrupting" }];
    },
    "/api/session/fork": async (body) => {
      const threadId = requiredText(body.threadId, "threadId and lastTurnId are required");
      const lastTurnId = requiredText(body.lastTurnId, "threadId and lastTurnId are required");
      assertIdle(threadId, "当前任务运行中，请完成后再从这里继续");
      const session = await conversations.forkSession(threadId, lastTurnId);
      return [201, { session, sourceThreadId: threadId, forkedFromTurnId: lastTurnId }];
    },
    "/api/session/archive": async (body) => {
      const threadId = requiredText(body.threadId, "threadId is required");
      assertIdle(threadId, "当前任务运行中，请完成后再归档");
      return [202, await conversations.archiveSession(threadId)];
    },
    "/api/session/unarchive": async (body) => (
      [202, await conversations.unarchiveSession(requiredText(body.threadId, "threadId is required"))]
    ),
    "/api/session/context/settings": async (body) => {
      const threadId = requiredText(body.threadId, "threadId is required");
      const threshold = body.autoCompactThreshold === null ? null : Number(body.autoCompactThreshold);
      return [200, await contextManagement.setThreshold(threadId, threshold)];
    },
    "/api/session/context/compact": async (body) => (
      [202, await contextManagement.requestCompaction(requiredText(body.threadId, "threadId is required"))]
    ),
  };

  const getRoutes = {
    "/api/models": async () => conversations.listModels(),
    "/api/sessions": async (url) => {
      const sessions = await conversations.listSessions(
        url.searchParams.get("source") || "all",
        url.searchParams.get("archived") === "1",
      );
      return sessions.map(({ messages, file, ...summary }) => summary);
    },
    "/api/session": async (url) => {
      const session = await conversations.findSession(
        requiredText(url.searchParams.get("threadId"), "threadId is required"),
        url.searchParams.get("source") || "all",
        paginationFrom(url),
      );
      if (!session) throw httpError(404, "session not found");
      return session;
    },
    "/api/session/context": async (url) => (
      contextManagement.load(requiredText(url.searchParams.get("threadId"), "threadId is required"))
    ),
    "/api/execution-status": async (url) => {
      const threadId = requiredText(url.searchParams.get("threadId"), "threadId is required");
      if (execution.getStatus(threadId).active && url.searchParams.get("reconcile") === "1") {
        const authoritative = await conversations.getThreadStatus(threadId).catch(() => null);
        execution.reconcile(threadId, authoritative);
      }
      return execution.getStatus(threadId);
    },
  };

  return async (request, response, url) => {
    if (request.method === "POST" && Object.hasOwn(postRoutes, url.pathname)) {
      const [statusCode, body] = await postRoutes[url.pathname](await readJson(request));
      sendJson(response, body, statusCode);
      return true;
    }
    if (request.method === "GET" && Object.hasOwn(getRoutes, url.pathname)) {
      sendJson(response, await getRoutes[url.pathname](url));
      return true;
    }
    return false;
  };
};
