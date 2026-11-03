import { useCallback, useRef } from "react";
import { contextApi } from "../data/contextApi";
import type { ContextStatus } from "../model/types";

import type { ConversationStore } from "../../conversations/state/conversationStore";

export const emptyStatus = (threadId: string): ContextStatus => ({
  type: "context_status",
  threadId,
  model: "",
  reasoningEffort: "",
  usedTokens: null,
  contextWindow: null,
  percentage: null,
  autoCompactThreshold: 80,
  phase: "idle",
  message: "",
  updatedAt: null,
});

export function useContextManagement(threadId: string, store: ConversationStore) {
  const activeThread = useRef(threadId);
  activeThread.current = threadId;
  const submittedChoices = useRef(new Map<string, { model: string; reasoningEffort: string }>());
  const status = store.get(threadId, false).contextStatus;
  const setStatus = useCallback((value: ContextStatus | ((current: ContextStatus) => ContextStatus)) => {
    const next = typeof value === 'function' ? value(store.get(threadId).contextStatus) : value;
    store.update(threadId, { contextStatus: next });
  }, [store, threadId]);
  const refresh = useCallback(async (_signal?: AbortSignal) => {
    await store.request(threadId);
    return store.get(threadId).contextStatus;
  }, [store, threadId]);
  const handleEvent = useCallback((event: ContextStatus) => {
    const current = store.get(event.threadId, false).contextStatus;
    if (current.updatedAt && event.updatedAt && Date.parse(event.updatedAt) < Date.parse(current.updatedAt)) return;
    store.update(event.threadId, { contextStatus: current.selectedSettings || store.synced.has(event.threadId) || store.modelChoices.has(event.threadId)
      ? { ...event, model: current.model, reasoningEffort: current.reasoningEffort, selectedSettings: current.selectedSettings } : event });
  }, [store]);

  const applyModelSettings = useCallback((changedThreadId: string, settings: { model: string; reasoningEffort: string; committed?: boolean }) => {
    const current = store.get(changedThreadId).contextStatus;
    const { committed, ...visible } = settings;
    if (committed) store.modelChoices.delete(changedThreadId);
    else store.modelChoices.set(changedThreadId, visible);
    const modelChanged = Boolean(visible.model && current.model && visible.model !== current.model);
    store.update(changedThreadId, { contextStatus: { ...current, ...visible,
      selectedSettings: { model: visible.model, reasoningEffort: visible.reasoningEffort },
      ...(modelChanged ? { usedTokens: null, contextWindow: null, percentage: null } : {}), updatedAt: new Date().toISOString() } });
  }, [store]);

  const compact = useCallback(async () => {
    if (!threadId || status.phase === "compacting") return false;
    try {
      setStatus(await contextApi.compact(threadId));
      return true;
    } catch (reason) {
      setStatus((current) => ({
        ...current,
        phase: "failed",
        message: reason instanceof Error ? reason.message : String(reason),
      }));
      return false;
    }
  }, [status.phase, threadId]);

  const setThreshold = useCallback(async (threshold: number | null) => {
    if (!threadId) return false;
    try {
      setStatus(await contextApi.setThreshold(threadId, threshold));
      return true;
    } catch (reason) {
      setStatus((current) => ({
        ...current,
        phase: "failed",
        message: reason instanceof Error ? reason.message : String(reason),
      }));
      return false;
    }
  }, [threadId]);

  const markSubmitted = useCallback((id: string, settings: { model: string; reasoningEffort: string }) => { submittedChoices.current.set(id, settings); }, []);
  const completeSettings = useCallback((id: string) => {
    const sent = submittedChoices.current.get(id);
    const choice = store.modelChoices.get(id);
    if (sent && choice?.model === sent.model && choice?.reasoningEffort === sent.reasoningEffort) store.modelChoices.delete(id);
    submittedChoices.current.delete(id);
    if (activeThread.current === id) void refresh();
  }, [refresh]);
  return { status, ready: !threadId || store.synced.has(threadId), handleEvent, compact, setThreshold, refresh, applyModelSettings, markSubmitted, completeSettings };
}
