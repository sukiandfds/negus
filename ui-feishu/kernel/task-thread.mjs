// Register the provider route before binding an employee or room to this thread.
export async function registerTaskThread({ task, threadId, actor, modelProviderId, cwd, providerForThread, registerSession, bindings, bindingScope }) {
  if (!registerSession) throw Error("后台任务登记服务未连接");
  const model = actor.model || "";
  if (!await providerForThread(threadId)) await registerSession({
    threadId, source: "codex", title: task.title, cwd, updatedAt: task.createdAt, archived: false, conversationKind: "task",
  }, modelProviderId, modelProviderId !== "current" && model && !model.includes("::") ? modelProviderId + "::" + model : model,
  { createdBy: "assistant", reasoningEffort: actor.reasoningEffort || "" });
  if (bindings) await bindings.bindRuntime({ conversationId: task.conversationId, agentId: actor.id, runtimeKind: "codex",
    runtimeSessionId: threadId, conversationKind: "task", title: task.title, ...bindingScope });
}

export const taskThreadOptions = (policy, developerInstructions, config, model) =>
  ({ ...policy, developerInstructions, config, ...(model ? { model } : {}) });
