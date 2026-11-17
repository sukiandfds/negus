import { readJson, sendJson } from "../http/request-utils.mjs";

export const createConversationInteractionRoutes = ({ execution, media, publishThreadEvent, authorizeAgentThread, sessionSource, publicUserInputRequest, publicAttachment }) => {
  return async (request, response, url) => {
  if (url.pathname === "/api/session/user-input" && request.method === "GET") {
    const threadId = String(url.searchParams.get("threadId") || "").trim();
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const pending = await sessionSource(binding).getPendingUserInput(threadId);
    sendJson(response, { request: publicUserInputRequest(pending) });
    return true;
  }
  if (url.pathname === "/api/session/user-input" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const requestId = body.requestId;
    if (!threadId || (typeof requestId !== "string" && typeof requestId !== "number")) {
      sendJson(response, { error: "threadId and requestId are required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const source = sessionSource(binding);
    const pending = await source.getPendingUserInput(threadId);
    const publicRequest = publicUserInputRequest(pending);
    if (!publicRequest || String(publicRequest.requestId) !== String(requestId)) {
      sendJson(response, { error: "该互动请求已结束或不存在" }, 409);
      return true;
    }
    const rawAnswers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? body.answers
      : {};
    const answers = {};
    for (const question of publicRequest.questions) {
      const values = rawAnswers[question.id]?.answers;
      if (!Array.isArray(values) || !values.length) {
        sendJson(response, { error: `请回答：${question.header || question.question}` }, 400);
        return true;
      }
      answers[question.id] = {
        answers: values.map((value) => String(value).trim()).filter(Boolean).slice(0, 20),
      };
      if (!answers[question.id].answers.length) {
        sendJson(response, { error: `请回答：${question.header || question.question}` }, 400);
        return true;
      }
    }
    await source.respondToUserInput(threadId, requestId, answers);
    execution.publishStatus?.(threadId, {
      phase: "working",
      label: "Codex 正在继续处理",
      detail: "",
      active: true,
      turnId: publicRequest.turnId,
    });
    publishThreadEvent(threadId, { type: "user_input_resolved", threadId, requestId });
    sendJson(response, { threadId, requestId, status: "submitted" });
    return true;
  }
  if (url.pathname === "/api/session/goal" && request.method === "GET") {
    const threadId = String(url.searchParams.get("threadId") || "").trim();
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const source = sessionSource(binding);
    sendJson(response, await source.getGoal(threadId));
    return true;
  }
  if (url.pathname === "/api/session/goal" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const source = sessionSource(binding);
    const goalAttachments = media.resolveMany(body.attachmentIds);
    if (Array.isArray(body.attachmentIds) && goalAttachments.length !== new Set(body.attachmentIds).size) {
      sendJson(response, { error: "目标附件已失效，请重新上传" }, 400);
      return true;
    }
    const objectiveText = String(body.objective || "").trim();
    const objective = body.objective === undefined ? undefined : [
      objectiveText,
      ...goalAttachments.map((file) => file.mimeType?.startsWith("image/")
        ? "Referenced image files:\n- " + file.name + ": " + file.path
        : "Referenced pasted text files:\n- pasted text file: " + file.path + ". Read this file before continuing."),
    ].filter(Boolean).join("\n\n");
    const status = body.status === undefined ? undefined : String(body.status || "").trim();
    const tokenBudget = body.tokenBudget === undefined || body.tokenBudget === null
      ? undefined
      : Number(body.tokenBudget);
    if (objective !== undefined && (!objective || objective.length > 1000000)) {
      sendJson(response, { error: "objective must contain 1 to 1000000 characters" }, 400);
      return true;
    }
    if (status !== undefined && !["active", "paused", "complete"].includes(status)) {
      sendJson(response, { error: "invalid goal status" }, 400);
      return true;
    }
    if (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) {
      sendJson(response, { error: "tokenBudget must be a positive integer" }, 400);
      return true;
    }
    const result = await source.setGoal(threadId, { objective, status, tokenBudget });
    if (objective !== undefined && body.submissionId) {
      const submissionId = String(body.submissionId);
      const createdAt = new Date().toISOString();
      const message = { id: `goal:${submissionId}`, role: "user", text: "/goal " + objectiveText,
        submissionId, createdAt, serverTimestamp: true, source: "native-goal",
        blocks: [{ id: `goal:${submissionId}:text`, type: "markdown", text: "/goal " + objectiveText },
          ...goalAttachments.map(file => ({ id: file.id, type: file.mimeType?.startsWith("image/") ? "image" : "file", source: file.url, file: publicAttachment(file) }))] };
      execution.recordMessage?.(threadId, message);
      publishThreadEvent(threadId, { type: "user_message_submitted", threadId, submissionId, messageId: message.id,
        text: message.text, attachments: goalAttachments.map(publicAttachment), createdAt });
      publishThreadEvent(threadId, { type: "sessions_changed", threadId });
    }
    sendJson(response, result);
    return true;
  }
  if (url.pathname === "/api/session/goal" && request.method === "DELETE") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const source = sessionSource(binding);
    await source.clearGoal(threadId);
    sendJson(response, { threadId, goal: null });
    return true;
  }
  return false;
  };
};
