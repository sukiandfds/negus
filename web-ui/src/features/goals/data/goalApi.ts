import { currentConversationId } from "../../../shared/api/conversationScope";
import { deleteJson, fetchJson, postJson } from "../../../shared/api/http";
import type { GoalResponse, GoalStatus } from "../model/types";

export const goalApi = {
  get: (threadId: string, signal?: AbortSignal, conversationId = currentConversationId()) => fetchJson<GoalResponse>(
    `/api/session/goal?threadId=${encodeURIComponent(threadId)}${conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : ""}`,
    signal,
  ),
  set: (threadId: string, patch: {
    objective?: string;
    status?: GoalStatus;
    tokenBudget?: number;
    attachmentIds?: string[];
  }, signal?: AbortSignal, conversationId = currentConversationId()) => postJson<GoalResponse>(
    "/api/session/goal",
    { threadId, ...patch, ...(conversationId ? { conversationId } : {}) },
    signal,
  ),
  clear: (threadId: string, signal?: AbortSignal, conversationId = currentConversationId()) => deleteJson<GoalResponse>(
    "/api/session/goal",
    { threadId, ...(conversationId ? { conversationId } : {}) },
    signal,
  ),
};
