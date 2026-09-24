import { useCallback, useEffect, useRef, useState } from "react";
import { readLocalCache, writeLocalCache } from "../../../shared/state/localCache";
import { contextApi } from "../data/contextApi";
import type { ContextStatus } from "../model/types";

const MAX_CACHED_STATUSES = 100;
const contextStatusCacheKey = "negus-context-status-v1";
const statusCache = new Map<string, ContextStatus>();
const validStatus = (value: unknown): value is ContextStatus => {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<ContextStatus>;
  return typeof status.threadId === "string"
    && typeof status.model === "string"
    && typeof status.reasoningEffort === "string";
};
const validStatusRecord = (value: unknown): value is Record<string, ContextStatus> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(validStatus);
};
let persistedStatuses = readLocalCache(contextStatusCacheKey, validStatusRecord) || {};
const uncommittedChoice = new Map<string, { model: string; reasoningEffort: string }>();
const serverModelReady = new Set<string>();

const emptyStatus = (threadId: string): ContextStatus => ({
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

const storedStatus = (status: ContextStatus): ContextStatus => {
  const saved = uncommittedChoice.get(status.threadId);
  return saved ? { ...status, model: saved.model, reasoningEffort: saved.reasoningEffort } : status;
};

const rememberStatus = (status: ContextStatus) => {
  if (!status.threadId) return status;
  statusCache.delete(status.threadId);
  statusCache.set(status.threadId, status);
  while (statusCache.size > MAX_CACHED_STATUSES) {
    const oldest = statusCache.keys().next().value;
    if (!oldest) break;
    statusCache.delete(oldest);
  }
  persistedStatuses = { ...persistedStatuses, ...Object.fromEntries([...statusCache].map(([id, value]) => [id, storedStatus(value)])) };
  writeLocalCache(contextStatusCacheKey, persistedStatuses);
  return status;
};

const keepUncommittedChoice = (current: ContextStatus, next: ContextStatus): ContextStatus => {
  if (!uncommittedChoice.has(next.threadId) || current.threadId !== next.threadId) return next;
  return { ...next, model: current.model, reasoningEffort: current.reasoningEffort };
};

const cachedStatus = (threadId: string) => {
  const cached = statusCache.get(threadId) || persistedStatuses[threadId];
  if (!cached) return emptyStatus(threadId);
  return { ...cached, phase: "idle" as const, message: "" };
};

export function useContextManagement(threadId: string) {
  const refreshVersion = useRef(0);
  const activeThread = useRef(threadId);
  activeThread.current = threadId;
  const [storedStatus, setStoredStatus] = useState<ContextStatus>(() => cachedStatus(threadId));
  const status = storedStatus.threadId === threadId
    ? storedStatus
    : cachedStatus(threadId);
  const setStatus = useCallback((value: ContextStatus | ((current: ContextStatus) => ContextStatus)) => {
    setStoredStatus((current) => {
      const next = typeof value === "function" ? value(current) : value;
      return rememberStatus(keepUncommittedChoice(current, next));
    });
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!threadId) return null;
    const version = ++refreshVersion.current;
    try {
      const next = await contextApi.status(threadId, signal);
      if (signal?.aborted || version !== refreshVersion.current || activeThread.current !== threadId) return null;
      if (!uncommittedChoice.has(threadId)) serverModelReady.add(threadId);
      setStatus(next);
      return next;
    } catch (reason) {
      if (!signal?.aborted && version === refreshVersion.current && activeThread.current === threadId) {
        setStatus((current) => ({
          ...current,
          phase: "failed",
          message: reason instanceof Error ? reason.message : String(reason),
        }));
      }
      return null;
    }
  }, [threadId]);

  useEffect(() => {
    setStatus(cachedStatus(threadId));
    if (!threadId) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, threadId]);

  const handleEvent = useCallback((event: ContextStatus) => {
    if (event.type === "context_status" && event.threadId === activeThread.current) {
      ++refreshVersion.current;
      setStatus((current) => {
        if (current.threadId !== event.threadId) return event;
        if (current.updatedAt && event.updatedAt && Date.parse(event.updatedAt) < Date.parse(current.updatedAt)) return current;
        const canKeepQualifiedModel = serverModelReady.has(event.threadId) || uncommittedChoice.has(event.threadId);
        const model = canKeepQualifiedModel && current.model.includes("::") && event.model && !event.model.includes("::")
          ? current.model
          : event.model;
        if (!uncommittedChoice.has(event.threadId)) serverModelReady.add(event.threadId);
        return model === event.model ? event : { ...event, model };
      });
    }
  }, [threadId]);

  const applyModelSettings = useCallback((changedThreadId: string, settings: { model: string; reasoningEffort: string; committed?: boolean }) => {
    if (activeThread.current === changedThreadId) ++refreshVersion.current;
    const current = cachedStatus(changedThreadId);
    const { committed, ...visible } = settings;
    if (committed) uncommittedChoice.delete(changedThreadId);
    else if (!uncommittedChoice.has(changedThreadId)) {
      uncommittedChoice.set(changedThreadId, { model: current.model, reasoningEffort: current.reasoningEffort });
    }
    const modelChanged = Boolean(visible.model && current.model && visible.model !== current.model);
    const next = rememberStatus({
      ...current,
      ...visible,
      ...(modelChanged ? { usedTokens: null, contextWindow: null, percentage: null } : {}),
      updatedAt: new Date().toISOString(),
    });
    if (activeThread.current === changedThreadId) setStoredStatus(next);
  }, []);

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

  return { status, handleEvent, compact, setThreshold, refresh, applyModelSettings };
}
