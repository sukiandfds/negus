import { currentConversationId } from "../../../shared/api/conversationScope";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaFile } from "../../../shared/model/media";
import type { ProjectEvent } from "../../execution/model/types";
import { followUpQueueApi } from "../data/followUpQueueApi";
import type { FollowUpQueueItem } from "../model/followUpQueue";
import { createSubmissionId } from "../state/optimisticMessage";

import type { ConversationStore } from "../state/conversationStore";

export function useFollowUpQueue(threadId: string, store: ConversationStore) {
  const conversationId = currentConversationId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingItems, setPendingItems] = useState<FollowUpQueueItem[]>([]);
  const [withdrawing, setWithdrawing] = useState<{ threadId: string; itemId: string } | null>(null);
  const threadIdRef = useRef(threadId);
  const requestRef = useRef(new Map<string, number>());
  threadIdRef.current = threadId;

  const run = useCallback(async (targetThreadId: string, request: () => Promise<{ items: FollowUpQueueItem[] }>, confirmLocal = false) => {
    if (!targetThreadId) return false;
    const requestId = (requestRef.current.get(targetThreadId) || 0) + 1;
    requestRef.current.set(targetThreadId, requestId);
    const isCurrent = () => requestRef.current.get(targetThreadId) === requestId;
    const setPending = setBusy;
    if (threadIdRef.current === targetThreadId) setPending(true);
    try {
      const response = await request();
      if (isCurrent() || confirmLocal) {
        const items = isCurrent() ? response.items : store.live.get(targetThreadId)?.queueItems ?? response.items;
        store.update(targetThreadId, { queueItems: items || [] });
        if (threadIdRef.current === targetThreadId) setError("");
      }
      return true;
    } catch (reason) {
      if (isCurrent() && threadIdRef.current === targetThreadId) setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      if (threadIdRef.current === targetThreadId) setPending(false);
    }
  }, [store]);

  useEffect(() => {
    setError("");
    setBusy(false);
  }, [threadId]);

  const enqueue = useCallback(async (text: string, attachments: MediaFile[] = [], targetThreadId = threadId, modelSettings?: { model: string; reasoningEffort: string }) => {
    const submissionId = `queue-${createSubmissionId()}`;
    const createdAt = new Date().toISOString();
    setPendingItems(items => [...items, { id: submissionId, threadId: targetThreadId, submissionId,
      text: text.trim(), attachments, attachmentIds: attachments.map(item => item.id),
      state: 'pending', error: '', createdAt, updatedAt: createdAt, position: items.length }]);
    try {
      return await run(targetThreadId, () => followUpQueueApi.enqueue(
        targetThreadId, text.trim(), attachments.map(attachment => attachment.id), submissionId, modelSettings, conversationId,
      ), true);
    } finally {
      setPendingItems(items => items.filter(item => item.submissionId !== submissionId));
    }
  }, [run, store, threadId, conversationId]);

  const remove = useCallback(async (itemId: string) => {
    if (!threadId) return false;
    setWithdrawing({ threadId, itemId });
    try {
      const removed = await run(threadId, () => followUpQueueApi.action(threadId, "remove", itemId), true);
      if (!removed && threadIdRef.current === threadId) setError(reason => `撤回未确认，消息按服务器当前状态显示，请勿当作已取消。${reason}`);
      return removed;
    } finally {
      setWithdrawing(current => current?.threadId === threadId && current.itemId === itemId ? null : current);
    }
  }, [run, threadId]);

  const move = useCallback((itemId: string, direction: "up" | "down") => {
    if (!threadId) return Promise.resolve(false);
    return run(threadId, () => followUpQueueApi.action(threadId, "move", itemId, { direction }));
  }, [run, threadId]);

  const retry = useCallback((itemId: string) => {
    if (!threadId) return Promise.resolve(false);
    return run(threadId, () => followUpQueueApi.action(threadId, "retry", itemId));
  }, [run, threadId]);

  const sendNow = useCallback(async (itemId: string) => {
    if (!threadId) return false;
    const key = JSON.stringify([threadId, itemId]);
    store.sendingQueue.set(key, new Date().toISOString());
    store.notify();
    try { return await run(threadId, () => followUpQueueApi.action(threadId, "sendNow", itemId), true); }
    finally { store.sendingQueue.delete(key); store.notify(); }
  }, [run, store, threadId]);

  const handleEvent = useCallback((event: ProjectEvent) => {
    if (event.type === "user_message_accepted") {
      return store.acceptQueuedMessage(event.threadId, event.submissionId);
    }
    if (event.type !== "queue_changed") return;
    requestRef.current.set(event.threadId, (requestRef.current.get(event.threadId) || 0) + 1);
    store.update(event.threadId, { queueItems: event.items || [] }, true);
    setError("");
  }, [store]);

  const view = store.get(threadId);
  const items = [...view.queueItems, ...pendingItems.filter(item => item.threadId === threadId
    && !view.queueItems.some(queued => queued.submissionId === item.submissionId)
    && !view.session?.messages.some(message => message.submissionId === item.submissionId))];
  return { items: items.filter(item => withdrawing?.threadId !== threadId || withdrawing.itemId !== item.id),
    loading: store.dirty.has(threadId), busy, error, enqueue, remove, move, retry, sendNow, handleEvent };
}
