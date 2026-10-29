import { currentConversationId } from "../../../shared/api/conversationScope";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaFile } from "../../../shared/model/media";
import type { ProjectEvent } from "../../execution/model/types";
import { followUpQueueApi } from "../data/followUpQueueApi";
import type { FollowUpQueueItem } from "../model/followUpQueue";
import { createSubmissionId } from "../state/optimisticMessage";

export function useFollowUpQueue(threadId: string) {
  const conversationId = currentConversationId();
  const [snapshot, setSnapshot] = useState({ threadId, items: [] as FollowUpQueueItem[] });
  const snapshotRef = useRef(snapshot);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadIdRef = useRef(threadId);
  const requestRef = useRef(0);
  const accepted = useRef(new Set<string>());
  if (threadIdRef.current !== threadId) {
    threadIdRef.current = threadId;
    requestRef.current += 1;
  }

  const run = useCallback(async (targetThreadId: string, request: () => Promise<{ items: FollowUpQueueItem[] }>, reading = false) => {
    if (!targetThreadId) return false;
    const requestId = ++requestRef.current;
    const isCurrent = () => threadIdRef.current === targetThreadId && requestRef.current === requestId;
    const setPending = reading ? setLoading : setBusy;
    if (threadIdRef.current === targetThreadId) setPending(true);
    try {
      const response = await request();
      if (isCurrent()) {
        const next = { threadId: targetThreadId, items: response.items || [] };
        snapshotRef.current = next;
        setSnapshot(next);
        setError("");
      }
      return true;
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      if (threadIdRef.current === targetThreadId) setPending(false);
    }
  }, []);

  const refresh = useCallback(() => run(threadId, () => followUpQueueApi.list(threadId), true), [run, threadId]);

  useEffect(() => {
    setError("");
    setLoading(false);
    setBusy(false);
    void refresh();
  }, [refresh]);

  const enqueue = useCallback(async (text: string, attachments: MediaFile[] = [], targetThreadId = threadId, modelSettings?: { model: string; reasoningEffort: string }) => {
    return run(targetThreadId, () => followUpQueueApi.enqueue(
      targetThreadId,
      text.trim(),
      attachments.map((attachment) => attachment.id),
      `queue-${createSubmissionId()}`,
      modelSettings,
      conversationId,
    ));
  }, [run, threadId, conversationId]);

  const remove = useCallback((itemId: string) => {
    if (!threadId) return Promise.resolve(false);
    return run(threadId, () => followUpQueueApi.action(threadId, "remove", itemId));
  }, [run, threadId]);

  const move = useCallback((itemId: string, direction: "up" | "down") => {
    if (!threadId) return Promise.resolve(false);
    return run(threadId, () => followUpQueueApi.action(threadId, "move", itemId, { direction }));
  }, [run, threadId]);

  const retry = useCallback((itemId: string) => {
    if (!threadId) return Promise.resolve(false);
    return run(threadId, () => followUpQueueApi.action(threadId, "retry", itemId));
  }, [run, threadId]);

  const sendNow = useCallback((itemId: string) => {
    if (!threadId) return Promise.resolve(false);
    return run(threadId, () => followUpQueueApi.action(threadId, "sendNow", itemId));
  }, [run, threadId]);

  const handleEvent = useCallback((event: ProjectEvent) => {
    if (event.type === "user_message_accepted") {
      const item = snapshotRef.current.threadId === event.threadId
        ? snapshotRef.current.items.find(item => (item.dispatchSubmissionId || item.submissionId) === event.submissionId)
        : undefined;
      accepted.current.add(event.submissionId);
      if (accepted.current.size > 500) accepted.current.delete(accepted.current.values().next().value!);
      const current = snapshotRef.current;
      if (current.threadId === event.threadId) {
        snapshotRef.current = { ...current, items: current.items.filter(entry => (entry.dispatchSubmissionId || entry.submissionId) !== event.submissionId) };
        setSnapshot(snapshotRef.current);
      }
      return item;
    }
    if (event.type !== "queue_changed" || event.threadId !== threadIdRef.current) return;
    requestRef.current += 1;
    snapshotRef.current = { threadId: event.threadId, items: event.items || [] };
    setSnapshot(snapshotRef.current);
    setError("");
  }, [threadId]);

  return { items: snapshot.threadId === threadId ? snapshot.items.filter(item => !accepted.current.has(item.dispatchSubmissionId || item.submissionId)) : [], loading, busy, error, enqueue, remove, move, retry, sendNow, refresh, handleEvent };
}
