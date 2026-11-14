import type { ProjectInfo, SessionDetail, SessionSummary } from "../model/types";
import type { ContextStatus } from "../../context-management/model/types";
import type { ExecutionStatus, UserInputRequest } from "../../execution/model/types";
import type { ThreadGoal } from "../../goals/model/types";
import type { FollowUpQueueItem } from "../model/followUpQueue";
import { currentConversationId, resolveConversationId, conversationQuery, withConversation } from "../../../shared/api/conversationScope";
import { fetchJson, postJson } from "../../../shared/api/http";

const PAGE_SIZE = 30;
const fetchConversationJson = <T,>(pathname: string, signal?: AbortSignal): Promise<T> =>
  fetchJson<T>(pathname, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60000)]));

export const conversationApi = {
  snapshot: async (threadId: string, sourceRevision: string, signal?: AbortSignal, conversationId = currentConversationId(threadId)) => {
    conversationId ||= await resolveConversationId(threadId);
    return fetchJson<{ session: SessionDetail | null; context: ContextStatus; status: ExecutionStatus;
      goal: ThreadGoal | null; queue: FollowUpQueueItem[]; input: UserInputRequest | null; sourceRevision: string | null; historyFormatVersion?: number }>(
      `/api/session?threadId=${encodeURIComponent(threadId)}&limit=${PAGE_SIZE}&view=1${sourceRevision ? `&sourceRevision=${encodeURIComponent(sourceRevision)}` : ''}${conversationQuery(conversationId)}`, signal);
  },
  project: (signal?: AbortSignal) => fetchConversationJson<ProjectInfo>("/api/project", signal),
  sessions: (archived = false, signal?: AbortSignal) => fetchConversationJson<SessionSummary[]>(`/api/sessions?source=all${archived ? "&archived=1" : ""}`, signal),
  create: (model = "", projectRoot = "", modelProviderId = "", signal?: AbortSignal) => postJson<SessionSummary>("/api/session", { model, modelProviderId, projectRoot, createdBy: 'user' }, signal),
  rename: (threadId: string, name: string, signal?: AbortSignal) => postJson<SessionSummary>("/api/session/name", withConversation({ threadId, name }), signal),
  fork: (threadId: string, lastTurnId: string, signal?: AbortSignal) => postJson<{
    session: SessionSummary;
    sourceThreadId: string;
    forkedFromTurnId: string;
  }>("/api/session/fork", withConversation({ threadId, lastTurnId }), signal),
  revert: (threadId: string, beforeTurnId: string) => postJson<{ threadId: string }>("/api/session/revert", withConversation({ threadId, beforeTurnId })),
  archive: (threadId: string, signal: AbortSignal = AbortSignal.timeout(60000)) => postJson<{ threadId: string; archived: boolean }>("/api/session/archive", withConversation({ threadId }), signal),
  unarchive: (threadId: string, signal?: AbortSignal) => postJson<SessionSummary>("/api/session/unarchive", withConversation({ threadId }), signal),
  session: async (threadId: string, { before, cursor }: {
    before?: number;
    cursor?: string;
  } = {}, signal?: AbortSignal, conversationId = currentConversationId(threadId)) => {
    conversationId ||= await resolveConversationId(threadId);
    const beforeQuery = before === undefined ? "" : `&before=${before}`;
    const cursorQuery = cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    return fetchConversationJson<SessionDetail>(
      `/api/session?threadId=${encodeURIComponent(threadId)}&limit=${PAGE_SIZE}${conversationQuery(conversationId)}${beforeQuery}${cursorQuery}`,
      signal,
    );
  },
};
