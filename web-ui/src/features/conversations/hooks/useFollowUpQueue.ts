import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaFile } from "../../../shared/model/media";
import type { ProjectEvent } from "../../execution/model/types";
import { followUpQueueApi } from "../data/followUpQueueApi";
import type { FollowUpQueueItem } from "../model/followUpQueue";
import { createSubmissionId } from "../state/optimisticMessage";

export function useFollowUpQueue(threadId: string) {
  const [snapshot, setSnapshot] = useState({ threadId, items: [] as FollowUpQueueItem[] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadIdRef = useRef(threadId);
  const requestRef = useRef(0);
  if (threadIdRef.current !== threadId) {
    threadIdRef.current = threadId;
    requestRef.current += 1;
  }

  const run = useCallback(async (targetThreadId: string, request: () => Promise<{ items: FollowUpQueueItem[] }>, reading = false) => {
    if (!targetThreadId || targetThreadId !== threadIdRef.current) return false;
    const requestId = ++requestRef.current;
    const isCurrent = () => threadIdRef.current === targetThreadId && requestRef.current === requestId;
    const setPending = reading ? setLoading : setBusy;
    setPending(true);
    try {
      const response = await request();
      if (isCurrent()) {
        setSnapshot({ threadId: targetThreadId, items: response.items || [] });
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

  const enqueue = useCallback(async (text: string, attachments: MediaFile[] = [], targetThreadId = threadId) => {
    return run(targetThreadId, () => followUpQueueApi.enqueue(
      targetThreadId,
      text.trim(),
      attachments.map((attachment) => attachment.id),
      `queue-${createSubmissionId()}`,
    ));
  }, [run, threadId]);

  const edit = useCallback((itemId: string, text: string) => {
    if (!threadId) return Promise.resolve(false);
    return run(threadId, () => followUpQueueApi.action(threadId, "edit", itemId, { text: text.trim() }));
  }, [run, threadId]);

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
    if (event.type !== "queue_changed" || event.threadId !== threadIdRef.current) return;
    requestRef.current += 1;
    setSnapshot({ threadId: event.threadId, items: event.items || [] });
    setError("");
  }, [threadId]);

  return { items: snapshot.threadId === threadId ? snapshot.items : [], loading, busy, error, enqueue, edit, remove, move, retry, sendNow, refresh, handleEvent };
}
