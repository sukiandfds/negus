import { fetchJson, postJson } from "../../../shared/api/http";
import { currentConversationId, conversationQuery, withConversation } from "../../../shared/api/conversationScope";
import type { ContextStatus } from "../model/types";

export const contextApi = {
  status: (threadId: string, signal?: AbortSignal, conversationId = currentConversationId(threadId)) => fetchJson<ContextStatus>(
    `/api/session/context?threadId=${encodeURIComponent(threadId)}${conversationQuery(conversationId)}`,
    signal,
  ),
  compact: (threadId: string, signal?: AbortSignal) => postJson<ContextStatus>(
    "/api/session/context/compact",
    withConversation({ threadId }),
    signal,
  ),
  setThreshold: (threadId: string, autoCompactThreshold: number | null, signal?: AbortSignal) => postJson<ContextStatus>(
    "/api/session/context/settings",
    withConversation({ threadId, autoCompactThreshold }),
    signal,
  ),
};
