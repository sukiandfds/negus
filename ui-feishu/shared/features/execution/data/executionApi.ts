import { fetchJson, postJson } from "../../../shared/api/http";
import { conversationQuery, withConversation, currentConversationId } from "../../../shared/api/conversationScope";
import type { ExecutionStatus, UserInputRequest } from "../model/types";

export interface SendMessageResult {
  threadId: string;
  turnId: string;
  status: string;
  migratedFromThreadId?: string;
}

export interface SubmissionStatusResult {
  threadId: string;
  submissionId: string;
  status: "accepted" | "pending" | "failed" | "unknown";
  turnId?: string;
  messageId?: string;
  error?: string;
}

export type SendMessageAttempt =
  | { outcome: "accepted"; result: SendMessageResult }
  | { outcome: "uncertain"; result: null }
  | { outcome: "failed"; result: null; error?: string };

interface InterruptResult {
  threadId: string;
  turnId: string;
  status: string;
}

const statusRequests = new Map<string, Promise<ExecutionStatus>>();

export const executionApi = {
  status: (threadId: string, signal?: AbortSignal, reconcile = false, conversationId = currentConversationId()) => {
    const url = `/api/execution-status?threadId=${encodeURIComponent(threadId)}${conversationQuery(conversationId)}${reconcile ? "&reconcile=1" : ""}`;
    if (reconcile) return fetchJson<ExecutionStatus>(url, signal);
    if (signal?.aborted) return Promise.reject(signal.reason);
    let request = statusRequests.get(url);
    if (!request) {
      request = fetchJson<ExecutionStatus>(url, AbortSignal.timeout(10000)).finally(() => statusRequests.delete(url));
      statusRequests.set(url, request);
    }
    return new Promise<ExecutionStatus>((resolve, reject) => {
      const abort = () => reject(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      request.then(value => { signal?.removeEventListener("abort", abort); resolve(value); }, error => { signal?.removeEventListener("abort", abort); reject(error); });
    });
  },
  sendMessage: (threadId: string, text: string, attachmentIds: string[] = [], submissionId = "", signal?: AbortSignal, conversationId = currentConversationId()) => postJson<SendMessageResult>(
    "/api/session/message",
    withConversation({ threadId, text, attachmentIds, submissionId }, conversationId),
    signal,
  ),
  submissionStatus: (threadId: string, submissionId: string, signal?: AbortSignal, conversationId = currentConversationId()) => fetchJson<SubmissionStatusResult>(
    `/api/session/submission?threadId=${encodeURIComponent(threadId)}&submissionId=${encodeURIComponent(submissionId)}${conversationQuery(conversationId)}`,
    signal,
  ),
  interrupt: (threadId: string, signal?: AbortSignal) => postJson<InterruptResult>(
    "/api/session/interrupt",
    withConversation({ threadId }),
    signal,
  ),
  review: (threadId: string, signal?: AbortSignal) => postJson<{ threadId: string; status: string }>(
    "/api/session/review",
    withConversation({ threadId }),
    signal,
  ),
  pendingUserInput: (threadId: string, signal?: AbortSignal) => fetchJson<{ request: UserInputRequest | null }>(
    `/api/session/user-input?threadId=${encodeURIComponent(threadId)}${conversationQuery()}`,
    signal,
  ),
  answerUserInput: (
    threadId: string,
    requestId: string | number,
    answers: Record<string, { answers: string[] }>,
    signal?: AbortSignal,
  ) => postJson<{ threadId: string; requestId: string | number; status: string }>(
    "/api/session/user-input",
    withConversation({ threadId, requestId, answers }),
    signal,
  ),
};
