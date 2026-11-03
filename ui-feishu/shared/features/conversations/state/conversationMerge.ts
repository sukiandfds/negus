import type { SessionDetail, SessionMessage } from "../model/types";

const isOptimisticMessage = (message: SessionMessage) => message.id.startsWith("optimistic-");

const timestampOf = (message: SessionMessage) => {
  const timestamp = Date.parse(message.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : null;
};

// FEAT-001: the timestamp beside a bubble is its chronological position.
export const orderMessageList = (messages: SessionMessage[]) => [...messages].sort((left, right) => {
  const time = (timestampOf(left) ?? -Infinity) - (timestampOf(right) ?? -Infinity);
  if (time && Number.isFinite(time)) return time;
  if (timestampOf(left) === null && timestampOf(right) !== null) return -1;
  if (timestampOf(right) === null && timestampOf(left) !== null) return 1;
  return (left.sequence ?? 0) - (right.sequence ?? 0)
    || (left.submissionId || left.itemId || left.id).localeCompare(right.submissionId || right.itemId || right.id);
});

const submissionIdOf = (message: SessionMessage) => message.submissionId
  || (isOptimisticMessage(message) ? message.id.slice('optimistic-'.length) : '');

export const sameSubmission = (left: SessionMessage, right: SessionMessage) => (
  left.role === "user"
  && right.role === "user"
  && Boolean(submissionIdOf(left))
  && submissionIdOf(left) === submissionIdOf(right)
);

const sameUserMessage = sameSubmission;

const persistedMatchesOptimistic = (persisted: SessionMessage, optimistic: SessionMessage) => {
  return !isOptimisticMessage(persisted)
    && isOptimisticMessage(optimistic)
    && sameUserMessage(persisted, optimistic);
};

const mergeTimestamp = (current: SessionMessage, incoming: SessionMessage): SessionMessage => ({
  ...incoming,
  createdAt: current.serverTimestamp ? current.createdAt : incoming.createdAt || current.createdAt,
  serverTimestamp: current.serverTimestamp || incoming.serverTimestamp,
});

export const mergeMessageList = (baseMessages: SessionMessage[], incomingMessages: SessionMessage[]) => {
  const merged: SessionMessage[] = [];
  const indexes = new Map<string, number>();

  const addOrReplace = (message: SessionMessage) => {
    const knownIndex = indexes.get(message.id);
    if (knownIndex !== undefined) {
      merged[knownIndex] = mergeTimestamp(merged[knownIndex], message);
      return;
    }

    const replacementIndex = merged.findIndex((current) => sameUserMessage(current, message));
    if (replacementIndex >= 0) {
      const current = merged[replacementIndex];
      if (isOptimisticMessage(message) && !isOptimisticMessage(current)) {
        if (!current.createdAt && message.createdAt) merged[replacementIndex] = { ...current, createdAt: message.createdAt };
        return;
      }
      indexes.delete(current.id);
      merged[replacementIndex] = mergeTimestamp(current, message);
      indexes.set(message.id, replacementIndex);
      return;
    }

    indexes.set(message.id, merged.length);
    merged.push(message);
  };

  for (const message of baseMessages) addOrReplace(message);
  for (const message of incomingMessages) addOrReplace(message);
  return orderMessageList(merged);
};

const unresolvedOptimisticMessages = (incoming: SessionDetail, current: SessionDetail) => {
  const persistedUsers = incoming.messages.filter((message) => message.role === "user" && !isOptimisticMessage(message));
  const consumed = new Set<number>();
  return current.messages.filter(isOptimisticMessage).filter((optimistic) => {
    const match = persistedUsers.findIndex((persisted, index) => (
      !consumed.has(index) && persistedMatchesOptimistic(persisted, optimistic)
    ));
    if (match < 0) return true;
    consumed.add(match);
    return false;
  });
};

export const mergeOlderMessages = (olderMessages: SessionMessage[], currentMessages: SessionMessage[]) => (
  mergeMessageList(olderMessages, currentMessages)
);

export const mergePendingOptimisticMessages = (incoming: SessionDetail, pending: SessionMessage[]) => {
  if (!pending.length) return incoming;
  return { ...incoming, messages: mergeMessageList(pending, incoming.messages) };
};

export const mergeSessionRefresh = (current: SessionDetail, incoming: SessionDetail): SessionDetail => {
  incoming = { ...incoming, messages: incoming.messages.map(message => {
    const previous = current.messages.find(item => item.id === message.id || sameSubmission(item, message));
    return previous ? mergeTimestamp(previous, message) : message;
  }) };
  const incomingIds = new Set(incoming.messages.map((message) => message.id));
  const firstOverlap = current.messages.findIndex((message) => !isOptimisticMessage(message) && incomingIds.has(message.id));
  const olderPrefix = firstOverlap > 0
    ? current.messages.slice(0, firstOverlap).filter((message) => !isOptimisticMessage(message))
    : [];
  const pending = unresolvedOptimisticMessages(incoming, current)
    .filter((message) => !incomingIds.has(message.id));
  const retained = incoming.hasMore && firstOverlap >= 0
    ? current.messages.filter(message => !isOptimisticMessage(message)) : olderPrefix;
  return {
    ...incoming,
    messages: mergeMessageList(mergeMessageList(retained, incoming.messages), pending),
  };
};
