import { readLocalCache } from "../../../shared/state/localCache";
import type { ContextStatus } from "../../context-management/model/types";
import { readConversationSnapshot } from "../data/conversationSnapshot";
import type { ConversationPresentation, SessionDetail, SessionSummary } from "../model/types";

export interface InitialConversationState {
  selectedId: string;
  snapshotSavedAt: string;
  sessionIsPartial: boolean;
  session: SessionDetail | null;
  cachedSessions: SessionDetail[];
  partialSessionIds: string[];
  sessions: SessionSummary[];
  presentation?: Record<string, Partial<ConversationPresentation>>;
}

export const readInitialConversationState = (): InitialConversationState => {
  const snapshot = readConversationSnapshot();
  const params = new URLSearchParams(window.location.search);
  const archivedView = params.get("archived") === "1";
  const selectedId = archivedView ? "" : params.get("thread")
    || snapshot?.selectedId
    || "";
  const cachedEntries = snapshot ? [
    ...(snapshot.session ? [{ session: snapshot.session, isPartial: snapshot.isPartial }] : []),
    ...(snapshot.recentSessions || []),
  ] : [];
  const session = !archivedView
    ? cachedEntries.find((entry) => entry.session.threadId === selectedId)?.session || null
    : null;
  // Import the former context cache only when an old page snapshot has no associated fields.
  const legacyContexts = readLocalCache('negus-context-status-v1', (value): value is Record<string, ContextStatus> => value !== null
    && typeof value === 'object' && Object.values(value).every((entry: unknown) => {
      const status = entry as Partial<ContextStatus> | null;
      return Boolean(status && typeof status.threadId === 'string' && typeof status.model === 'string' && typeof status.reasoningEffort === 'string');
    }));
  const presentation: Record<string, Partial<ConversationPresentation>> = { ...snapshot?.presentation };
  for (const { session: detail } of cachedEntries) if (!presentation[detail.threadId]?.contextStatus && legacyContexts?.[detail.threadId]) {
    presentation[detail.threadId] = { ...presentation[detail.threadId], contextStatus: legacyContexts[detail.threadId] };
  }
  return {
    selectedId,
    snapshotSavedAt: snapshot?.savedAt || "",
    sessionIsPartial: Boolean(cachedEntries.find((entry) => entry.session.threadId === selectedId)?.isPartial),
    session,
    cachedSessions: cachedEntries.map((entry) => entry.session),
    partialSessionIds: cachedEntries.filter((entry) => entry.isPartial || entry.session.historyFormatVersion !== 1).map((entry) => entry.session.threadId),
    sessions: snapshot?.sessions || [],
    presentation,
  };
};
