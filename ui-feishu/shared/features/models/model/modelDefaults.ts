import { fetchJson, postJson } from "../../../shared/api/http";
import { useEffect, useState } from "react";
import { readLocalCache, writeLocalCache } from "../../../shared/state/localCache";
import type { CodexModel } from "./types";

export interface ModelDefaults {
  providerId: string;
  model: string;
  effort: string;
  archivedProviderIds: string[];
}

const defaultsKey = "negus-model-defaults-shared-v1";
const listeners = new Set<() => void>();

const emptyDefaults = (): ModelDefaults => ({
  providerId: "",
  model: "",
  effort: "",
  archivedProviderIds: [],
});

const validDefaults = (value: unknown): value is ModelDefaults => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ModelDefaults>;
  return typeof entry.providerId === "string"
    && typeof entry.model === "string"
    && typeof entry.effort === "string"
    && Array.isArray(entry.archivedProviderIds)
    && entry.archivedProviderIds.every((id) => typeof id === "string");
};

export const readModelDefaults = (): ModelDefaults => readLocalCache(defaultsKey, validDefaults) || emptyDefaults();

const applyDefaults = (value: ModelDefaults) => {
  writeLocalCache(defaultsKey, value);
  listeners.forEach(listener => listener());
  return value;
};
let reading: Promise<ModelDefaults> | null = null;
let savedVersion = 0;
export const refreshModelDefaults = () => {
  if (!reading) {
    const version = savedVersion;
    reading = fetchJson<ModelDefaults>('/api/model-defaults', AbortSignal.timeout(10000))
      .then(value => version === savedVersion ? applyDefaults(value) : readModelDefaults())
      .finally(() => { reading = null; });
  }
  return reading;
};
export const writeModelDefaults = async (next: Omit<ModelDefaults, "archivedProviderIds">) => {
  const value = await postJson<ModelDefaults>('/api/model-defaults/selection', next);
  savedVersion++;
  return applyDefaults(value);
};
export function useModelDefaults(): ModelDefaults {
  const [value, setValue] = useState(readModelDefaults);
  useEffect(() => {
    const listener = () => setValue(readModelDefaults());
    const refresh = () => { void refreshModelDefaults().catch(() => {}); };
    listeners.add(listener);
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { listeners.delete(listener); window.removeEventListener('focus', refresh); clearInterval(timer); };
  }, []);
  return value;
}

export const providerIdOf = (entry: CodexModel) => (
  entry.modelProviderId || (entry.model.includes("::") ? entry.model.split("::")[0] : "current")
);

export const providerIdForModel = (models: CodexModel[], model: string) => (
  models.find((entry) => entry.model === model)?.modelProviderId
  || (model.includes("::") ? model.split("::")[0] : /^grok-/i.test(model) ? "fusheng-grok" : "current")
);

export const channelProviderId = (entry: { id: string; modelKey?: string }) => {
  if (entry.modelKey?.includes("::")) return entry.modelKey.split("::")[0];
  if (entry.id === "current" || entry.id === "fusheng-grok" || entry.id.startsWith("ccswitch_")) return entry.id;
  return `ccswitch_${entry.id}`;
};

export const groupModels = (models: CodexModel[], providerId: string) => (
  models.filter((entry) => entry.available !== false && providerIdOf(entry) === providerId)
);

export const chooseEffort = (entry: CodexModel | undefined, preferred = "") => {
  const options = entry?.supportedReasoningEfforts.map((item) => item.reasoningEffort) || [];
  if (preferred && options.includes(preferred)) return preferred;
  if (options.includes("medium")) return "medium";
  return options[0] || "";
};

const availableModels = (models: CodexModel[], defaults: ModelDefaults) => {
  const archived = new Set(defaults.archivedProviderIds);
  const open = models.filter((entry) => entry.available !== false && !archived.has(providerIdOf(entry)));
  return open.length ? open : models.filter((entry) => entry.available !== false);
};

export const resolveVisibleModel = (
  models: CodexModel[],
  defaults: ModelDefaults,
  recordedModel: string,
  sessionModel: string,
) => {
  if (recordedModel || sessionModel) return recordedModel || sessionModel;
  if (defaults.model) return defaults.model.includes("::") || !defaults.providerId || defaults.providerId === "current"
    ? defaults.model : `${defaults.providerId}::${defaults.model}`;
  const pool = availableModels(models, defaults);
  if (!pool.length) return defaults.model || "";
  const preferred = pool.find((entry) => (entry.model === defaults.model || entry.model.split('::').at(-1) === defaults.model.split('::').at(-1)) && (!defaults.providerId || providerIdOf(entry) === defaults.providerId));
  if (preferred) return preferred.model;

  const providerId = defaults.providerId || "current";
  const group = pool.filter((entry) => providerIdOf(entry) === providerId);
  const target = group.length ? group : pool.filter((entry) => providerIdOf(entry) === "current");
  const finalGroup = target.length ? target : pool;
  return (finalGroup.find((entry) => entry.isDefault) || finalGroup[0]).model;
};

export const resolveVisibleEffort = (
  models: CodexModel[],
  defaults: ModelDefaults,
  model: string,
  recordedEffort: string,
) => {
  const entry = models.find((item) => item.model === model);
  const options = entry?.supportedReasoningEfforts.map((item) => item.reasoningEffort) || [];
  if (recordedEffort && (!options.length || options.includes(recordedEffort))) return recordedEffort;
  return chooseEffort(entry, defaults.effort);
};
