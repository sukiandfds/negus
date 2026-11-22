import { useEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, RefreshCw } from "lucide-react";
import { ChannelManager, readChannels, useChannelCatalog } from "./ChannelManager";
import type { CodexModel } from "../model/types";
import { channelProviderId, chooseEffort, providerIdForModel } from "../model/modelDefaults";
import { formatModelDisplayName } from "../model/modelDisplayName";
import { formatReasoningEffort } from "../model/reasoningEffortLabels";
import { ModelSelect } from "./ModelSelect";
import { ReasoningEffortSelect } from "./ReasoningEffortSelect";
import { ModelCatalogFeedback } from "./ModelCatalogFeedback";
import { refreshConfiguredModels, refreshModelCatalog, type CatalogResult } from "../data/modelCatalogRefresh";
import styles from "./ModelSelect.module.css";

interface ModelSettingsControlProps {
  currentModel: string;
  currentEffort: string;
  models: CodexModel[];
  disabled: boolean;
  loading: boolean;
  changing: boolean;
  error: string;
  onModelChange: (model: string, reasoningEffort?: string) => Promise<boolean>;
  onReasoningEffortChange: (reasoningEffort: string) => Promise<boolean>;
}

export function ModelSettingsControl({
  currentModel, currentEffort, models, disabled, loading, changing, error,
  onModelChange, onReasoningEffortChange,
}: ModelSettingsControlProps) {
  const [open, setOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [emptyResults, setEmptyResults] = useState<CatalogResult[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = models.find(entry => entry.model === currentModel);
  const buttonLabel = [currentModel ? formatModelDisplayName(currentModel, current?.displayName?.split(" · ").at(-1)) : "选择模型",
    formatReasoningEffort(currentEffort)].filter(Boolean).join(" · ");
  const { channelOptions, canonical, managed } = useChannelCatalog(models, currentModel, open);
  useEffect(() => {
    if (open) void refreshModelCatalog("", undefined, false).catch(() => {});
  }, [open]);
  const providerOf = (model: string) => providerIdForModel(models, model);
  const provider = providerOf(currentModel);
  const selectedProvider = canonical(provider);
  const candidates = models.filter(model => canonical(providerOf(model.model)) === selectedProvider);
  const local = candidates.filter(model => providerOf(model.model) === provider);
  const visibleModels = local.length ? local : candidates;
  const busy = changing || refreshing;
  const closeMenu = () => { if (!busy) setOpen(false); };
  const stageModel = async (model: string) => {
    if (!model) return false;
    setRefreshError("");
    return onModelChange(model, chooseEffort(models.find(entry => entry.model === model), currentEffort));
  };
  const stageChannel = async (providerId: string) => {
    const entry = channelOptions.find(item => canonical(channelProviderId(item)) === providerId);
    const option = entry?.availableModel || entry?.modelKey || models.find(model => canonical(providerOf(model.model)) === providerId)?.model;
    return option ? stageModel(option) : false;
  };
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError("");
    try {
      if (!managed) {
        await refreshModelCatalog(provider);
        return;
      }
      const results = await refreshConfiguredModels(provider);
      await readChannels(true);
      setRefreshError(results.filter(entry => entry.error).map(entry => entry.error).join("；"));
      setEmptyResults(results.filter(entry => entry.count === 0));
    } catch (reason) {
      setRefreshError(reason instanceof Error ? reason.message : "刷新失败");
    } finally { setRefreshing(false); }
  };

  useEffect(() => {
    if (!open || channelsOpen || emptyResults.length) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, open, channelsOpen, emptyResults.length]);

  return (
    <div className={styles.settings} ref={rootRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={buttonLabel}
        onClick={() => setOpen(value => !value)}
      >
        <span>{buttonLabel}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.settingsMenu} role="dialog" aria-label="模型设置">
          <div className={styles.settingRow}>
            <span>模型</span>
            <div className={styles.modelPicker}>
            <ModelSelect
              currentModel={currentModel}
              models={visibleModels}
              loading={loading && !models.length}
              changing={busy}
              error={refreshError || error}
              disabled={disabled}
              onChange={stageModel}
            />
            <button className={styles.refreshButton} type="button"
              title={loading ? "正在刷新模型" : "刷新配置模型"}
              aria-label="刷新配置模型" aria-busy={loading}
              disabled={loading || busy}
              onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden="true" />
            </button>
            </div>
          </div>
          <label className={styles.settingRow}>
            <span>推理强度</span>
            <ReasoningEffortSelect
              currentModel={current}
              currentEffort={currentEffort}
              loading={loading && !models.length}
              changing={busy}
              error={refreshError || error}
              disabled={disabled}
              onChange={onReasoningEffortChange}
            />
          </label>
          {disabled ? <small className={styles.menuHint}>当前会话不支持修改</small> : null}
          <div className={styles.menuHint} role="status">下一轮发送时生效，不影响正在运行的任务。</div>
          {refreshError || error ? <small className={styles.menuError} role="alert">{refreshError || error}</small> : null}
          <div className={styles.settingRow}>
            <span>配置</span>
            <div className={styles.modelPicker}>
              <select className={styles.select} aria-label="配置" value={channelOptions.some((entry) => canonical(channelProviderId(entry)) === selectedProvider) ? selectedProvider : ""} disabled={disabled || busy || !channelOptions.length} onChange={(event) => void stageChannel(event.target.value)}>
                {channelOptions.some((entry) => canonical(channelProviderId(entry)) === selectedProvider) ? null : <option value="">{current?.providerDisplayName || "选择配置"}</option>}
                {channelOptions.map((entry) => <option key={channelProviderId(entry)} value={canonical(channelProviderId(entry))}>{entry.name}</option>)}
              </select>
              <button className={styles.refreshButton} type="button" title="编辑配置" aria-label="编辑配置" disabled={busy} onClick={() => setChannelsOpen(true)}>
                <Pencil size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

        </div>
      ) : null}
      {emptyResults.length ? <ModelCatalogFeedback results={emptyResults} onClose={() => setEmptyResults([])}
        onDeleted={() => { window.dispatchEvent(new Event("negus-channels-updated")); }} /> : null}
      {channelsOpen ? <ChannelManager currentModel={currentModel} models={models} onClose={() => setChannelsOpen(false)} /> : null}
    </div>
  );
}
