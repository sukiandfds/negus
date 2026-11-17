import { readJson, sendJson } from "../http/request-utils.mjs";

export const createConversationSettingsRoutes = ({ conversations, execution, contextManagement, agentConversationStore, employeeRuntime, modelProviders, authorizeAgentThread, isEmployeeDirectBinding, sessionSource }) => {
  return async (request, response, url) => {
  if (url.pathname === "/api/models" && request.method === "GET") {
    const refreshProvider = url.searchParams.get("refreshProvider");
    if (refreshProvider && modelProviders) await modelProviders.refreshProviderModels(refreshProvider);
    const currentModels = await conversations.listModels();
    let includeAgentProviders = url.searchParams.get("scope") === "agents";
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    if (!includeAgentProviders && conversationId && agentConversationStore) {
      try {
        includeAgentProviders = isEmployeeDirectBinding(await agentConversationStore.resolve({ conversationId }));
      } catch {}
    }
    sendJson(response, modelProviders
      ? await modelProviders.listModels(currentModels)
      : currentModels);
    return true;
  }
  if (url.pathname === "/api/session/model" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const model = String(body.model || "").trim();
    if (!threadId || !model) {
      sendJson(response, { error: "threadId and model are required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    if (execution.getStatus(threadId).active) {
      sendJson(response, { error: "当前任务运行中，请在完成后切换模型" }, 409);
      return true;
    }
    if (isEmployeeDirectBinding(binding)) {
      const result = await employeeRuntime.updateModelSettings(binding.agentId, { model });
      sendJson(response, {
        model: result.employee.model || model,
        modelProvider: result.employee.modelProviderId || "current",
        reasoningEffort: result.employee.reasoningEffort || "",
      });
      return true;
    }
    sendJson(response, await conversations.updateModel(threadId, model, { allowProviderSwitch: binding?.conversationKind !== "task" && body.allowProviderSwitch === true, reasoningEffort: body.reasoningEffort }));
    return true;
  }
  if (url.pathname === "/api/session/reasoning-effort" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const reasoningEffort = String(body.reasoningEffort || "").trim();
    if (!threadId || !reasoningEffort) {
      sendJson(response, { error: "threadId and reasoningEffort are required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    if (execution.getStatus(threadId).active) {
      sendJson(response, { error: "当前任务运行中，请在完成后调整推理强度" }, 409);
      return true;
    }
    if (isEmployeeDirectBinding(binding)) {
      const result = await employeeRuntime.updateModelSettings(binding.agentId, { reasoningEffort });
      sendJson(response, {
        model: result.employee.model || "",
        modelProvider: result.employee.modelProviderId || "current",
        reasoningEffort: result.employee.reasoningEffort || reasoningEffort,
      });
      return true;
    }
    sendJson(response, await conversations.updateReasoningEffort(threadId, reasoningEffort));
    return true;
  }
  if (url.pathname === "/api/session/context" && request.method === "GET") {
    const threadId = url.searchParams.get("threadId") || "";
    const conversationId = url.searchParams.get("conversationId") || "";
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    await authorizeAgentThread({ threadId, conversationId });
    sendJson(response, await contextManagement.load(threadId));
    return true;
  }
  if (url.pathname === "/api/session/context/settings" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    await authorizeAgentThread({ threadId, conversationId });
    const threshold = body.autoCompactThreshold === null ? null : Number(body.autoCompactThreshold);
    sendJson(response, await contextManagement.setThreshold(threadId, threshold));
    return true;
  }
  if (url.pathname === "/api/session/context/compact" && request.method === "POST") {
    const body = await readJson(request);
    const threadId = String(body.threadId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    await authorizeAgentThread({ threadId, conversationId });
    sendJson(response, await contextManagement.requestCompaction(threadId), 202);
    return true;
  }
  if (url.pathname === "/api/execution-status") {
    const threadId = url.searchParams.get("threadId") || "";
    const conversationId = url.searchParams.get("conversationId") || "";
    if (!threadId) {
      sendJson(response, { error: "threadId is required" }, 400);
      return true;
    }
    const binding = await authorizeAgentThread({ threadId, conversationId });
    const current = execution.getStatus(threadId);
    if (current.active && url.searchParams.get("reconcile") === "1") {
      try {
        execution.reconcile(threadId, await sessionSource(binding).getThreadStatus(threadId));
      } catch {
        execution.reconcile(threadId, null);
      }
    }
    sendJson(response, execution.getStatus(threadId));
    return true;
  }
  return false;
  };
};
