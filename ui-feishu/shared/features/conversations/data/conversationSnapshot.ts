import type { ConversationPresentation, SessionDetail, SessionSummary } from "../model/types";
import { readStorage, writeStorage } from "../../../shared/state/storage";

const storageKey = "negus-conversation-snapshot-v1";
const legacyStorageKey = "codex-collab-conversation-snapshot-v1";
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
    ))
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

const readLegacySnapshot = (): ConversationSnapshot | null => selectNewestSnapshot(
  readLocalSnapshot(storageKey),
  readLocalSnapshot(legacyStorageKey),
);

// FEAT-001: metadata and each conversation commit together; rewrite only changed records.
let restored: ConversationSnapshot | null = null;
let database: Promise<IDBDatabase> | undefined;
let writes = Promise.resolve(true);
const persisted = new Map<string, string>();
const openDatabase = () => database ||= new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('negus-conversations', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('threads', { keyPath: 'threadId' });
    request.result.createObjectStore('metadata');
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => { request.result.close(); database = undefined; };
    resolve(request.result);
  };
  request.onerror = () => { database = undefined; reject(request.error); };
  request.onblocked = () => { database = undefined; reject(new Error('Conversation cache upgrade blocked')); };
});
export const readConversationSnapshot = () => restored || readLegacySnapshot();
export const restoreConversationCache = async () => {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDatabase();
    const saved = await new Promise<ConversationSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(['threads', 'metadata'], 'readonly');
      const metadata = tx.objectStore('metadata').get('snapshot');
      const threads = tx.objectStore('threads').getAll();
      tx.oncomplete = () => {
        const value = metadata.result as ConversationSnapshot | undefined;
        if (!value) return resolve(null);
        const records = threads.result as { threadId: string; entry: CachedConversation; view?: ConversationPresentation }[];
        for (const record of records) persisted.set(record.threadId, JSON.stringify(record));
        const selected = records.find(record => record.threadId === value.selectedId);
        resolve(validSnapshot({ ...value, session: selected?.entry.session || null,
          isPartial: selected?.entry.isPartial, recentSessions: records.filter(record => record !== selected).map(record => record.entry),
          presentation: Object.fromEntries(records.filter(record => record.view).map(record => [record.threadId, record.view!])) }));
      };
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    restored = selectNewestSnapshot(saved, readLegacySnapshot());
  } catch (error) { console.error('[negus:conversation-cache] Cache restore failed; legacy cache retained', error); }
};

export const writeConversationSnapshot = ({ selectedId, sessions, session, cachedSessions, presentation }: {
  selectedId: string;
  sessions: SessionSummary[];
  session: SessionDetail | null;
  cachedSessions?: ReadonlyMap<string, SessionDetail>;
  presentation?: Record<string, ConversationPresentation>;
}) => {
  const previous = readConversationSnapshot();
  const savedAt = new Date().toISOString();
  const entries = new Map((previous?.recentSessions || []).map(entry => [entry.session.threadId, entry]));
  if (previous?.session) entries.set(previous.session.threadId, { savedAt: previous.savedAt, session: previous.session, isPartial: previous.isPartial });
  for (const detail of cachedSessions?.values() || []) entries.set(detail.threadId, { savedAt, session: detail });
  if (session) entries.set(session.threadId, { savedAt, session });
  const selected = entries.get(selectedId);
  const snapshot = validSnapshot({ version: 1, savedAt, selectedId, sessions,
    session: selected?.session || null, isPartial: selected?.isPartial,
    recentSessions: [...entries.values()].filter(entry => entry.session.threadId !== selectedId),
    presentation: { ...previous?.presentation, ...presentation } })!;
  if (typeof indexedDB === 'undefined') {
    const saved = writeStorage(storageKey, snapshot);
    if (!saved) console.error('[negus:conversation-cache] Snapshot storage failed; previous snapshot retained');
    return saved;
  }
  restored = snapshot;
  writes = writes.catch(() => false).then(async () => {
    try {
      const db = await openDatabase();
      const all = [...(snapshot.session ? [{ savedAt, session: snapshot.session, isPartial: snapshot.isPartial }] : []), ...(snapshot.recentSessions || [])];
      const changes = all.map(entry => ({ threadId: entry.session.threadId,
        entry: { ...entry, savedAt: '' }, view: snapshot.presentation?.[entry.session.threadId] }))
        .map(record => ({ record, serialized: JSON.stringify(record) }))
        .filter(({ record, serialized }) => persisted.get(record.threadId) !== serialized);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['threads', 'metadata'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
        try {
          for (const { record } of changes) tx.objectStore('threads').put(record);
          tx.objectStore('metadata').put({ version: 1, savedAt, selectedId, sessions }, 'snapshot');
        } catch (error) { tx.abort(); reject(error); }
      });
      for (const { record, serialized } of changes) persisted.set(record.threadId, serialized);
      return true;
    } catch (error) { console.error('[negus:conversation-cache] Cache write failed; previous persisted content retained', error); return false; }
  });
  return writes;
};
