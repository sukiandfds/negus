import type { ConversationPresentation, SessionDetail, SessionMessage, SessionSummary } from "../model/types";
import { readStorage, writeStorage } from "../../../shared/state/storage";

const storageKey = "negus-conversation-snapshot-v1";
const legacyStorageKey = "codex-collab-conversation-snapshot-v1";
const maxSnapshotCharacters = 1024 * 1024;
const maxCachedConversations = 10;
const maxCachedMessages = 60;

const isProtectedMessage = (message: SessionMessage) => message.id.startsWith("optimistic-")
  && (message.deliveryState === "failed" || message.deliveryState === "occupied");

const trimMessages = (messages: SessionMessage[], limit: number) => {
  let remaining = Math.max(0, limit - messages.filter(isProtectedMessage).length);
  return [...messages].reverse().filter(message => isProtectedMessage(message) || remaining-- > 0).reverse();
};

export interface CachedConversation {
  savedAt: string;
  isPartial?: boolean;
  session: SessionDetail;
}

export interface ConversationSnapshot {
  version: 1;
  savedAt: string;
  isPartial?: boolean;
  selectedId: string;
  sessions: SessionSummary[];
  session: SessionDetail | null;
  recentSessions?: CachedConversation[];
  presentation?: Record<string, ConversationPresentation>;
}

const isSessionDetail = (value: unknown): value is SessionDetail => Boolean(
  value
  && typeof value === "object"
  && typeof (value as SessionDetail).threadId === "string"
  && Array.isArray((value as SessionDetail).messages),
);

const validSnapshot = (value: ConversationSnapshot | null): ConversationSnapshot | null => {
  if (!value || value.version !== 1 || !Array.isArray(value.sessions)) return null;
  if (value.session && !isSessionDetail(value.session)) return null;
  if (value.session && value.session.threadId !== value.selectedId) return null;
  const recentSessions = Array.isArray(value.recentSessions)
    ? value.recentSessions.filter((entry) => Boolean(
      entry
      && typeof entry.savedAt === "string"
      && isSessionDetail(entry.session)
      && entry.session.threadId !== value.selectedId,
    )).slice(0, maxCachedConversations - 1)
    : [];
  // Refetch only snapshots affected by the old attachment-as-prose parser.
  // Keep selection/list state and unrelated cached conversations intact.
  const hasLegacyAttachmentText = (session: SessionDetail) => session.messages.some((message) =>
    message.role === "user" && message.text?.includes("[附件正文：") && message.text.includes("[附件正文结束]"));
  const sanitized = new Set<string>();
  const cleanSession = (session: SessionDetail) => {
    const messages = session.messages.filter(message => !message.id.startsWith("stream-")
      && (!message.id.startsWith("optimistic-") || message.deliveryState === "failed" || message.deliveryState === "occupied"));
    if (messages.length === session.messages.length && !messages.some(message => message.id.startsWith("optimistic-"))) return session;
    sanitized.add(session.threadId);
    return { ...session, messages, sourceSignature: undefined };
  };
  const session = value.session && !hasLegacyAttachmentText(value.session) ? cleanSession(value.session) : null;
  const recent = recentSessions.filter((entry) => !hasLegacyAttachmentText(entry.session)).map(entry => {
    const session = cleanSession(entry.session);
    return { ...entry, session, isPartial: Boolean(entry.isPartial || sanitized.has(session.threadId)) };
  });
  return {
    ...value,
    sessions: value.sessions.map(({ messages: _messages, ...summary }: SessionSummary & { messages?: unknown }) => summary),
    session,
    isPartial: Boolean(value.isPartial || (session && sanitized.has(session.threadId))),
    recentSessions: recent,
    presentation: value.presentation && Object.fromEntries(Object.entries(value.presentation).map(([id, view]) => [id, {
      ...view, ...(sanitized.has(id) ? { syncSignature: undefined } : {}), streamingText: "", commentaryText: "",
      executionStatus: { ...view.executionStatus, streamingText: "", streamingItemId: "", commentary: "" },
    }])),
  };
};

const selectNewestSnapshot = (...snapshots: Array<ConversationSnapshot | null>) => snapshots.reduce<ConversationSnapshot | null>(
  (best, current) => {
    if (!current) return best;
    if (!best) return current;
    const currentAt = Date.parse(current.savedAt) || 0;
    const bestAt = Date.parse(best.savedAt) || 0;
    if (currentAt !== bestAt) return currentAt > bestAt ? current : best;
    return (current.session?.messages.length || 0) >= (best.session?.messages.length || 0) ? current : best;
  },
  null,
);

const readLocalSnapshot = (key: string) => {
  return validSnapshot(readStorage<ConversationSnapshot>(key));
};

export const readConversationSnapshot = (): ConversationSnapshot | null => selectNewestSnapshot(
  readLocalSnapshot(storageKey),
  readLocalSnapshot(legacyStorageKey),
);

export const writeConversationSnapshot = ({ selectedId, sessions, session, cachedSessions, presentation }: {
  selectedId: string;
  sessions: SessionSummary[];
  session: SessionDetail | null;
  cachedSessions?: ReadonlyMap<string, SessionDetail>;
  presentation?: Record<string, ConversationPresentation>;
}) => {
  try {
    const previous = readConversationSnapshot();
    const savedAt = new Date().toISOString();
    const cachedMessageCount = session?.threadId === selectedId ? session.messages.length : 0;
    const cachedSession = session && session.threadId === selectedId
      ? { ...session, messages: trimMessages(session.messages, maxCachedMessages) }
      : null;
    const previousEntries: CachedConversation[] = [
      ...[...(cachedSessions?.values() || [])].sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "")).map(session => ({ savedAt, isPartial: Boolean(session.hasMore), session })),
      ...(previous?.session ? [{
        savedAt: previous.savedAt,
        isPartial: previous.isPartial,
        session: previous.session,
      }] : []),
      ...(previous?.recentSessions || []),
    ];
    const selectedPrevious = previousEntries.find((entry) => entry.session.threadId === selectedId);
    const seen = new Set<string>();
    const recentSessions = previousEntries.filter((entry) => {
      const threadId = entry.session.threadId;
      if (threadId === selectedId || seen.has(threadId)) return false;
      seen.add(threadId);
      return true;
    }).slice(0, maxCachedConversations - 1).map(entry => {
      const latest = cachedSessions?.get(entry.session.threadId);
      if (!latest) return entry;
      const messages = trimMessages(latest.messages, maxCachedMessages);
      return { savedAt, isPartial: Boolean(entry.isPartial || latest.hasMore || latest.messages.length > messages.length),
        session: { ...latest, messages } };
    });
    const snapshot: ConversationSnapshot = validSnapshot({
      version: 1,
      savedAt,
      isPartial: Boolean(selectedPrevious?.isPartial || (cachedSession && cachedMessageCount > cachedSession.messages.length)),
      selectedId,
      sessions,
      session: cachedSession,
      recentSessions,
      presentation: Object.fromEntries([selectedId, ...recentSessions.map(entry => entry.session.threadId)].flatMap(id => {
        const value = presentation?.[id];
        return value ? [[id, value]] : [];
      })),
    })!;
    let serialized = JSON.stringify(snapshot);
    while (serialized.length > maxSnapshotCharacters) {
      let progress = false;
      for (let i = (snapshot.recentSessions?.length || 0) - 1; i >= 0; i--) {
        const entry = snapshot.recentSessions![i];
        const current = entry.session.messages;
        if (current.length <= 1 && !current.some(isProtectedMessage)) {
          snapshot.recentSessions!.splice(i, 1);
          if (snapshot.presentation) delete snapshot.presentation[entry.session.threadId];
        } else {
          const messages = trimMessages(current, Math.floor(current.length / 2));
          if (messages.length === current.length) continue;
          entry.isPartial = true;
          entry.session = { ...entry.session, messages };
        }
        progress = true;
        break;
      }
      if (!progress && snapshot.session && snapshot.session.messages.length > 1) {
        const current = snapshot.session.messages;
        const messages = trimMessages(current, Math.max(1, Math.floor(current.length * 3 / 4)));
        if (messages.length < current.length) {
          snapshot.isPartial = true;
          snapshot.session.messages = messages;
          progress = true;
        }
      }
      if (!progress) {
        console.error("[negus:conversation-cache] Snapshot exceeds storage limit; previous snapshot retained");
        return false;
      }
      serialized = JSON.stringify(snapshot);
    }
    if (writeStorage(storageKey, snapshot)) return true;
    console.error("[negus:conversation-cache] Snapshot storage failed; previous snapshot retained");
  } catch {
    console.error("[negus:conversation-cache] Snapshot preparation failed; previous snapshot retained");
  }
  return false;
};
