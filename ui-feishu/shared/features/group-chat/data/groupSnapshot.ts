import { mergeHistory, mergeMessageList } from "../../conversations/state/historyMerge.ts";
import { createPendingAgentMessage, removePendingAgentMessages } from "./groupMessageState";
import { readValidStorage, writeStorage } from "../../../shared/state/storage";
import type { GroupMessage, GroupSnapshot } from "../model/types";

const storageKey = "negus-group-snapshot-v1";
const storageKeyFor = (roomId: string) => roomId
  && roomId !== "current-project"
  ? `${storageKey}:${encodeURIComponent(roomId)}`
  : storageKey;

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
    (messages, work) => messages.some((message) => message.workId === work.workId && message.phase !== "commentary")
      ? messages
      : mergeMessageList(messages, createPendingAgentMessage(work)),
    removePendingAgentMessages(snapshot.messages),
  ),
});

export const unfinishedGroupWorks = (works: GroupSnapshot["activeWorks"], messages: GroupMessage[]) => {
  const completedWorkIds = new Set(messages
    .filter((message) => !message.pending && message.workId && message.phase !== "commentary")
    .map((message) => message.workId));
  return (works || []).filter(work => !completedWorkIds.has(work.workId));
};

export const reconcileGroupSnapshot = (
  incoming: GroupSnapshot,
  current: GroupSnapshot | null,
  pendingMessages: GroupMessage[] = [],
): GroupSnapshot => {
  const preserveHistory = Boolean(current?.history?.date || current?.history?.hasNewer);
  const rows = preserveHistory ? current!.messages : mergeHistory(
    removePendingAgentMessages(current?.messages || []), incoming.messages, incoming.history?.hasOlder);
  const messages = mergeMessageList(pendingMessages, rows);
  return restoreActiveGroupWorks({
    ...incoming,
    messages,
    history: current?.history && (current.history.date || current.history.hasNewer)
      ? current.history
      : incoming.history,
    activeWorks: unfinishedGroupWorks(incoming.activeWorks, messages),
  });
};

export const readGroupSnapshot = (roomId = ""): GroupSnapshot | null => {
  const snapshot = readValidStorage(storageKeyFor(roomId), validSnapshot);
  return snapshot ? restoreActiveGroupWorks(snapshot) : null;
};

export const writeGroupSnapshot = (snapshot: GroupSnapshot) => {
  const previous = readGroupSnapshot(snapshot.room.id);
  const messages = mergeHistory(removePendingAgentMessages(previous?.messages || []), snapshot.messages, snapshot.history?.hasOlder);
  if (!writeStorage(storageKeyFor(snapshot.room.id), { ...snapshot, messages }))
    console.error('[negus:group-cache] Cache write failed; previous snapshot retained');
};
