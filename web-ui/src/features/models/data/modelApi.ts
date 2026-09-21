import { fetchJson, postJson } from "../../../shared/api/http";
import { currentConversationId, withConversation } from "../../../shared/api/conversationScope";
import type { CodexModel, ModelUpdateResult } from "../model/types";

export const modelApi = {
  list: (signal?: AbortSignal, refreshProvider?: string) => {
    const conversationId = currentConversationId();
    const query = new URLSearchParams();
    if (conversationId) query.set('conversationId', conversationId);
    if (refreshProvider) query.set('refreshProvider', refreshProvider);
    return fetchJson<CodexModel[]>(
      `/api/models${query.size ? `?${query}` : ""}`,
      signal,
    );
  },
  listForAgents: (signal?: AbortSignal) => fetchJson<CodexModel[]>("/api/models?scope=agents", signal),
  update: (threadId: string, model: string, signal?: AbortSignal, reasoningEffort?: string) => postJson<ModelUpdateResult>(
    "/api/session/model",
    withConversation({ threadId, model, allowProviderSwitch: true, reasoningEffort }),
    signal,
  ),
  updateReasoningEffort: (threadId: string, reasoningEffort: string, signal?: AbortSignal) => postJson<ModelUpdateResult>(
    "/api/session/reasoning-effort",
    withConversation({ threadId, reasoningEffort }),
    signal,
  ),
};
