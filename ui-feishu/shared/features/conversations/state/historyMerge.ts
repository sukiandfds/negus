import { isOptimisticId, mergeIdentified, sameSubmission } from "../../../../../windows/server/message-identity.mjs";

interface HistoryMessage {
  id: string; role?: string; type?: string; createdAt?: string; sequence?: number;
  submissionId?: string; itemId?: string; serverTimestamp?: boolean;
}
export const historyReadIsStale = (current: number, requested: number) => current > requested;
// For a page that must be loaded, only one request runs at a time; cancel on room change.
export async function readHistoryPage<T>(read: () => Promise<T>, revision: () => number, active: () => boolean) {
  let start: number, result: T;
  do {
    start = revision();
    result = await read();
  } while (active() && historyReadIsStale(revision(), start));
  return result;
}
const isOptimisticMessage = (message: HistoryMessage) => isOptimisticId(message.id);

const timestampOf = (message: HistoryMessage) => {
  const timestamp = Date.parse(message.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : null;
};

// FEAT-001: the timestamp beside a bubble is its chronological position.
export const orderMessageList = <T extends HistoryMessage>(messages: T[]) => [...messages].sort((left, right) => {
  const time = (timestampOf(left) ?? -Infinity) - (timestampOf(right) ?? -Infinity);
  if (time && Number.isFinite(time)) return time;
  if (timestampOf(left) === null && timestampOf(right) !== null) return -1;
  if (timestampOf(right) === null && timestampOf(left) !== null) return 1;
  return (left.sequence ?? 0) - (right.sequence ?? 0)
    || (left.submissionId || left.itemId || left.id).localeCompare(right.submissionId || right.itemId || right.id);
});

const persistedMatchesOptimistic = (persisted: HistoryMessage, optimistic: HistoryMessage) => {
  return !isOptimisticMessage(persisted)
    && isOptimisticMessage(optimistic)
    && sameSubmission(persisted, optimistic);
};

const mergeTimestamp = <T extends HistoryMessage>(current: T, incoming: T): T => ({
  ...incoming,
  createdAt: current.serverTimestamp ? current.createdAt : incoming.createdAt || current.createdAt,
  serverTimestamp: current.serverTimestamp || incoming.serverTimestamp,
});

export const mergeMessageList = <T extends HistoryMessage>(baseMessages: T[], incoming: T[] | T) => {
  const incomingMessages = Array.isArray(incoming) ? incoming : [incoming];
  return orderMessageList(mergeIdentified([...baseMessages, ...incomingMessages], (current, incoming) => {
    if (isOptimisticMessage(incoming) && !isOptimisticMessage(current))
      return !current.createdAt && incoming.createdAt ? { ...current, createdAt: incoming.createdAt } : current;
    return mergeTimestamp(current, incoming);
  }));
};

const unresolvedOptimisticMessages = <T extends HistoryMessage>(incoming: T[], current: T[]) => {
  const persistedUsers = incoming.filter((message) => (message.role === "user" || message.type === "human") && !isOptimisticMessage(message));
  const consumed = new Set<number>();
  return current.filter(isOptimisticMessage).filter((optimistic) => {
    const match = persistedUsers.findIndex((persisted, index) => (
      !consumed.has(index) && persistedMatchesOptimistic(persisted, optimistic)
    ));
    if (match < 0) return true;
    consumed.add(match);
    return false;
  });
};

export const mergeHistory = <T extends HistoryMessage>(current: T[], incoming: T[], hasMore = false): T[] => {
  incoming = incoming.map(message => {
    const previous = current.find(item => item.id === message.id || sameSubmission(item, message));
    return previous ? mergeTimestamp(previous, message) : message;
  });
  const incomingIds = new Set(incoming.map((message) => message.id));
  const firstOverlap = current.findIndex((message) => !isOptimisticMessage(message) && incomingIds.has(message.id));
  const olderPrefix = firstOverlap > 0
    ? current.slice(0, firstOverlap).filter((message) => !isOptimisticMessage(message))
    : [];
  const pending = unresolvedOptimisticMessages(incoming, current)
    .filter((message) => !incomingIds.has(message.id));
  const retained = hasMore && firstOverlap >= 0
    ? current.filter(message => !isOptimisticMessage(message)) : olderPrefix;
  return mergeMessageList(mergeMessageList(retained, incoming), pending);
};
