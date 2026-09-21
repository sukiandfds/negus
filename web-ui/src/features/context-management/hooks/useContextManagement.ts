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
const persistedStatuses = readLocalCache(contextStatusCacheKey, validStatusRecord) || {};

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

const rememberStatus = (status: ContextStatus) => {
  if (!status.threadId) return status;
  statusCache.delete(status.threadId);
  statusCache.set(status.threadId, status);
  while (statusCache.size > MAX_CACHED_STATUSES) {
    const oldest = statusCache.keys().next().value;
    if (!oldest) break;
    statusCache.delete(oldest);
  }
  writeLocalCache(contextStatusCacheKey, { ...persistedStatuses, ...Object.fromEntries(statusCache) });
  return status;
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
    setStoredStatus((current) => rememberStatus(typeof value === "function" ? value(current) : value));
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!threadId) return null;
    const version = ++refreshVersion.current;
    try {
      const next = await contextApi.status(threadId, signal);
      if (signal?.aborted || version !== refreshVersion.current || activeThread.current !== threadId) return null;
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
      setStatus((current) => current.threadId === event.threadId && current.updatedAt && event.updatedAt
        && Date.parse(event.updatedAt) < Date.parse(current.updatedAt) ? current : event);
    }
  }, [threadId]);

  const applyModelSettings = useCallback((changedThreadId: string, settings: { model: string; reasoningEffort: string }) => {
    if (activeThread.current === changedThreadId) ++refreshVersion.current;
    const current = cachedStatus(changedThreadId);
    const modelChanged = Boolean(settings.model && current.model && settings.model !== current.model);
    const next = rememberStatus({
      ...current,
      ...settings,
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
