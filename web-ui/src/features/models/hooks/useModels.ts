import { useCallback, useEffect, useRef, useState } from "react";
import { readModelCatalog, writeModelCatalog } from "../data/modelCatalogCache";
import { modelApi } from "../data/modelApi";
import type { CodexModel, ModelUpdateResult } from "../model/types";
import { writeLocalCache } from "../../../shared/state/localCache";

export function useModels(threadId: string, onChanged: (threadId: string, result: ModelUpdateResult) => void) {
  const [initialModels] = useState(readModelCatalog);
  const [models, setModels] = useState<CodexModel[]>(initialModels);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const refreshProviderRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const refresh = (event: Event) => {
      refreshProviderRef.current = (event as CustomEvent<{ providerId?: string }>).detail?.providerId;
      setCatalogRevision((value) => value + 1);
    };
    window.addEventListener('negus-channels-updated', refresh);
    return () => window.removeEventListener('negus-channels-updated', refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const refreshProvider = refreshProviderRef.current;
    refreshProviderRef.current = undefined;
    void modelApi.list(controller.signal, refreshProvider)
      .then((result) => {
        if (controller.signal.aborted) return;
        const availableModels = result.filter((entry) => entry.available !== false);
        setModels(availableModels);
        writeModelCatalog(availableModels);
        setError("");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [threadId, catalogRevision]);

  const change = useCallback(async (model: string, reasoningEffort?: string) => {
    if (!threadId || !model || changing) return false;
    setChanging(true);
    setError("");
    try {
      const result = await modelApi.update(threadId, model, undefined, reasoningEffort);
      writeLocalCache("negus-preferred-model-v1", result.model || model);
      onChanged(threadId, result);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setChanging(false);
    }
  }, [changing, onChanged, threadId]);

  const changeReasoningEffort = useCallback(async (reasoningEffort: string) => {
    if (!threadId || !reasoningEffort || changing) return false;
    setChanging(true);
    setError("");
    try {
      const result = await modelApi.updateReasoningEffort(threadId, reasoningEffort);
      onChanged(threadId, result);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setChanging(false);
    }
  }, [changing, onChanged, threadId]);

  return { models, loading, changing, error, change, changeReasoningEffort };
}
