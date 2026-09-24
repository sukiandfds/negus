import { useEffect, useState } from "react";
import { readLocalCache, writeLocalCache } from "../../../shared/state/localCache";
import type { CodexModel } from "./types";

export interface ModelDefaults {
  providerId: string;
  model: string;
  effort: string;
  archivedProviderIds: string[];
}

const defaultsKey = "negus-model-defaults-v1";
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

export const writeModelDefaults = (next: ModelDefaults) => {
  writeLocalCache(defaultsKey, next);
  listeners.forEach((listener) => listener());
};

export function useModelDefaults(): ModelDefaults {
  const [value, setValue] = useState(readModelDefaults);
  useEffect(() => {
    const listener = () => setValue(readModelDefaults());
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return value;
}

export const providerIdOf = (entry: CodexModel) => (
  entry.modelProviderId || (entry.model.includes("::") ? entry.model.split("::")[0] : "current")
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
  if (recordedModel) return recordedModel;
  if (sessionModel) return sessionModel;
  const pool = availableModels(models, defaults);
  if (!pool.length) return "";
  const preferred = pool.find((entry) => entry.model === defaults.model && (!defaults.providerId || providerIdOf(entry) === defaults.providerId));
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
