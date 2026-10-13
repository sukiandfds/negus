import { createPendingAgentMessage, keepUnacknowledgedMessages, removePendingAgentMessages, upsertGroupMessage } from "./groupMessageState";
import { readValidStorage, writeStorage } from "../../../shared/state/storage";
import type { GroupMessage, GroupSnapshot } from "../model/types";

const storageKey = "negus-group-snapshot-v1";
const storageKeyFor = (roomId: string) => roomId
  && roomId !== "current-project"
  ? `${storageKey}:${encodeURIComponent(roomId)}`
  : storageKey;
const messageLimit = 80;
const maxBytes = 384 * 1024;

const validSnapshot = (value: unknown): value is GroupSnapshot => {
  const snapshot = value as GroupSnapshot | null;
  return Boolean(
    snapshot?.room?.id
    && Array.isArray(snapshot.messages)
    && Array.isArray(snapshot.agents)
    && Array.isArray(snapshot.members),
  );
};

export const restoreActiveGroupWorks = (snapshot: GroupSnapshot): GroupSnapshot => ({
  ...snapshot,
  activeWorks: snapshot.activeWorks || [],
  messages: (snapshot.activeWorks || []).reduce(
    (messages, work) => messages.some((message) => message.workId === work.workId)
      ? messages
      : upsertGroupMessage(messages, createPendingAgentMessage(work)),
    removePendingAgentMessages(snapshot.messages),
  ),
});

export const reconcileGroupSnapshot = (
  incoming: GroupSnapshot,
  current: GroupSnapshot | null,
  pendingMessages: GroupMessage[] = [],
): GroupSnapshot => {
  const preserveHistory = Boolean(current?.history?.date || current?.history?.hasNewer);
  const messages = keepUnacknowledgedMessages(
    preserveHistory ? current?.messages || [] : incoming.messages,
    [
    ...(preserveHistory ? [] : removePendingAgentMessages(current?.messages || [])),
    ...pendingMessages,
    ],
  );
  const completedWorkIds = new Set(messages
    .filter((message) => !message.pending && message.workId)
    .map((message) => message.workId));
  return restoreActiveGroupWorks({
    ...incoming,
    messages,
    history: current?.history && (current.history.date || current.history.hasNewer)
      ? current.history
      : incoming.history,
    activeWorks: (incoming.activeWorks || []).filter((work) => !completedWorkIds.has(work.workId)),
  });
};

export const readGroupSnapshot = (roomId = ""): GroupSnapshot | null => {
  const snapshot = readValidStorage(storageKeyFor(roomId), validSnapshot);
  if (!snapshot) return null;
  return {
    ...snapshot,
    messages: removePendingAgentMessages(snapshot.messages),
    agents: snapshot.agents.map((agent) => ({ ...agent, active: false })),
    members: [],
    activeWorks: [],
  };
};

export const writeGroupSnapshot = (snapshot: GroupSnapshot) => {
  try {
    if (snapshot.history?.date || snapshot.history?.hasNewer) return;
    const cached: GroupSnapshot = {
      ...snapshot,
      messages: removePendingAgentMessages(snapshot.messages).slice(-messageLimit),
      activeWorks: [],
    };
    const serialized = JSON.stringify(cached);
    if (serialized.length <= maxBytes) writeStorage(storageKeyFor(snapshot.room.id), cached);
  } catch {
    // Storage may be unavailable in private or restricted mobile browsers.
  }
};
