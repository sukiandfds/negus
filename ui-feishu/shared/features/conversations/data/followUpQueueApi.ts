import { currentConversationId, withConversation } from "../../../shared/api/conversationScope";
import { fetchJson, postJson } from "../../../shared/api/http";
import type { FollowUpQueueItem } from "../model/followUpQueue";

interface FollowUpQueueResponse {
  threadId: string;
  item?: FollowUpQueueItem;
  items: FollowUpQueueItem[];
}

export const followUpQueueApi = {
  list: (threadId: string, signal?: AbortSignal) => fetchJson<FollowUpQueueResponse>(
    `/api/session/queue?threadId=${encodeURIComponent(threadId)}`,
    signal,
  ),
  enqueue: (threadId: string, text: string, attachmentIds: string[], submissionId: string, modelSettings?: { model: string; reasoningEffort: string }, conversationId = currentConversationId()) => postJson<FollowUpQueueResponse>(
    "/api/session/queue",
    withConversation({ threadId, text, attachmentIds, submissionId, modelSettings }, conversationId),
  ),
  action: (threadId: string, action: string, itemId: string, extra: Record<string, unknown> = {}) => postJson<FollowUpQueueResponse>(
    "/api/session/queue",
    { threadId, action, itemId, ...extra },
  ),
};
