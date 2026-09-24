import { useCallback, useEffect, useRef, useState } from "react";
import { readModelCatalog, writeModelCatalog } from "../data/modelCatalogCache";
import { modelApi } from "../data/modelApi";
import type { CodexModel, ModelUpdateResult } from "../model/types";
import { writeLocalCache } from "../../../shared/state/localCache";

export function useModels(threadId: string, onChanged: (threadId: string, result: ModelUpdateResult & { committed?: boolean }) => void, currentModel = "") {
  const [initialModels] = useState(readModelCatalog);
  const [models, setModels] = useState<CodexModel[]>(initialModels);
  const [loading, setLoading] = useState(initialModels.length === 0);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const hasCatalogRef = useRef(initialModels.length > 0);
  const refreshProviderRef = useRef<string | undefined>(undefined);
  const pendingRef = useRef(new Map<string, { model?: string; reasoningEffort?: string; modelChanged: boolean; effortChanged: boolean }>());
  const applyingRef = useRef<Promise<ModelUpdateResult | null> | null>(null);
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
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
    setLoading(!hasCatalogRef.current);
    const refreshProvider = refreshProviderRef.current;
    refreshProviderRef.current = undefined;
    void modelApi.list(controller.signal, refreshProvider)
      .then((result) => {
        if (controller.signal.aborted) return;
        const availableModels = result.filter((entry) => entry.available !== false);
        setModels(availableModels);
        hasCatalogRef.current = true;
        writeModelCatalog(availableModels);
        setError("");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          if (!hasCatalogRef.current) setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [threadId, catalogRevision]);

  const change = useCallback(async (model: string, reasoningEffort?: string) => {
    const activeThreadId = threadIdRef.current;
    if (!activeThreadId || !model) return false;
    setError("");
    const entry = models.find((item) => item.model === model);
    const modelProvider = entry?.modelProviderId || (model.includes("::") ? model.split("::")[0] : "current");
    const pending = pendingRef.current.get(activeThreadId) || { modelChanged: false, effortChanged: false };
    const nextEffort = reasoningEffort || pending.reasoningEffort;
    pendingRef.current.set(activeThreadId, {
      ...pending,
      model,
      reasoningEffort: nextEffort,
      modelChanged: true,
      effortChanged: pending.effortChanged || Boolean(reasoningEffort),
    });
    onChanged(activeThreadId, { model, modelProvider, reasoningEffort: nextEffort || "" });
    writeLocalCache("negus-preferred-model-v1", model);
    return true;
  }, [models, onChanged]);

  const changeReasoningEffort = useCallback(async (reasoningEffort: string) => {
    const activeThreadId = threadIdRef.current;
    if (!activeThreadId || !reasoningEffort) return false;
    setError("");
    const pending = pendingRef.current.get(activeThreadId) || { modelChanged: false, effortChanged: false };
    pendingRef.current.set(activeThreadId, { ...pending, reasoningEffort, effortChanged: true });
    onChanged(activeThreadId, { model: pending.model || currentModel, modelProvider: "current", reasoningEffort });
    return true;
  }, [currentModel, onChanged]);

  const applyPending = useCallback((): Promise<ModelUpdateResult | null> => {
    if (applyingRef.current) return applyingRef.current;
    const task = (async (): Promise<ModelUpdateResult | null> => {
    const activeThreadId = threadIdRef.current;
    if (!activeThreadId) return null;
    const pending = pendingRef.current.get(activeThreadId);
    if (!pending || (!pending.modelChanged && !pending.effortChanged)) return null;
    setChanging(true);
    setError("");
    try {
      let result = pending.modelChanged
        ? await modelApi.update(activeThreadId, pending.model || "", undefined, pending.reasoningEffort)
        : await modelApi.updateReasoningEffort(activeThreadId, pending.reasoningEffort || "");
      if (pending.modelChanged && pending.effortChanged && pending.reasoningEffort) {
        const effortResult = await modelApi.updateReasoningEffort(result.threadId || activeThreadId, pending.reasoningEffort);
        result = { ...result, threadId: effortResult.threadId || result.threadId || activeThreadId, reasoningEffort: effortResult.reasoningEffort || pending.reasoningEffort };
      }
      const selectedModel = pending.model || currentModel;
      const selected = selectedModel ? models.find((entry) => entry.model === selectedModel) : null;
      const applied = {
        ...result,
        model: selectedModel || result.model,
        modelProvider: selected?.modelProviderId || result.modelProvider,
        reasoningEffort: result.reasoningEffort || pending.reasoningEffort || "",
      };
      pendingRef.current.delete(activeThreadId);
      writeLocalCache("negus-preferred-model-v1", applied.model || "");
      onChanged(activeThreadId, { ...applied, committed: true });
      return applied;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      throw new Error(message);
    } finally {
      setChanging(false);
    }
    })();
    applyingRef.current = task.finally(() => { applyingRef.current = null; });
    return applyingRef.current;
  }, [currentModel, models, onChanged]);

  return { models, loading, changing, error, change, changeReasoningEffort, applyPending };
}
