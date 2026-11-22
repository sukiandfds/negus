import type { SessionDetail, SessionMessage } from "../model/types";
import { mergeHistory, mergeMessageList } from "./historyMerge.ts";
export { mergeMessageList, orderMessageList } from "./historyMerge.ts";
export { sameSubmission } from "../../../../../windows/server/message-identity.mjs";

export const mergePendingOptimisticMessages = (incoming: SessionDetail, pending: SessionMessage[]) => {
  if (!pending.length) return incoming;
  return { ...incoming, messages: mergeMessageList(pending, incoming.messages) };
};

export const mergeSessionRefresh = (current: SessionDetail, incoming: SessionDetail): SessionDetail => {
  return { ...incoming, messages: mergeHistory(current.messages, incoming.messages, incoming.hasMore) };
};
