import { postJson } from "../../../shared/api/http";
import { withConversation } from "../../../shared/api/conversationScope";
import type { ContextStatus } from "../model/types";

export const contextApi = {
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
