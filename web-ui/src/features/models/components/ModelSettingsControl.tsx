import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ChannelManager } from './ChannelManager';
import type { CodexModel } from "../model/types";
import { formatModelDisplayName } from "../model/modelDisplayName";
import { formatReasoningEffort } from "../model/reasoningEffortLabels";
import { ModelSelect } from "./ModelSelect";
import { ReasoningEffortSelect } from "./ReasoningEffortSelect";
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
  const [draftModel, setDraftModel] = useState(currentModel);
  const [draftEffort, setDraftEffort] = useState(currentEffort);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const current = models.find((entry) => entry.model === currentModel);
  const draftModelEntry = models.find((entry) => entry.model === draftModel);
  const modelLabel = currentModel
    ? formatModelDisplayName(currentModel, current?.displayName)
    : loading ? "读取模型" : "选择模型";
  const effortLabel = formatReasoningEffort(currentEffort);
  const busy = changing || applying;
  const hasChanges = draftModel !== currentModel || Boolean(draftEffort && draftEffort !== currentEffort);
  const providerOf = (model: string) => models.find((entry) => entry.model === model)?.modelProviderId || (model.includes('::') ? model.split('::')[0] : /^grok-/i.test(model) ? 'fusheng-grok' : 'current');
  const selectedProvider = providerOf(currentModel);
  const visibleModels = models.filter((entry, index, all) =>
    providerOf(entry.model) === selectedProvider
    && all.findIndex((candidate) => candidate.model === entry.model) === index);
  const crossProvider = Boolean(currentModel && draftModel && providerOf(currentModel) !== providerOf(draftModel));

  const closeMenu = () => {
    if (busy) return;
    setOpen(false);
    setApplyError("");
  };

  const toggleMenu = () => {
    if (open) {
      closeMenu();
      return;
    }
    setDraftModel(currentModel);
    setDraftEffort(currentEffort);
    setApplyError("");
    window.dispatchEvent(new Event('negus-channels-updated'));
    setOpen(true);
  };

  const stageModel = async (model: string) => {
    const next = models.find((entry) => entry.model === model);
    const supported = next?.supportedReasoningEfforts.map((entry) => entry.reasoningEffort) || [];
    setDraftModel(model);
    if (!supported.length) setDraftEffort("");
    else if (!supported.includes(draftEffort)) {
      setDraftEffort(supported.includes(currentEffort) ? currentEffort : "");
    }
    setApplyError("");
    return true;
  };

  const stageEffort = async (reasoningEffort: string) => {
    setDraftEffort(reasoningEffort);
    setApplyError("");
    return true;
  };

  const applySettings = async () => {
    if (disabled || busy || !hasChanges) return;
    setApplying(true);
    setApplyError("");
    try {
      if (draftModel !== currentModel && !await onModelChange(draftModel, crossProvider ? draftEffort : undefined)) {
        setApplyError("模型设置没有生效，请重试");
        return;
      }
      if (!crossProvider && draftEffort && draftEffort !== currentEffort && !await onReasoningEffortChange(draftEffort)) {
        setApplyError("推理强度没有生效，请重试");
        return;
      }
      setOpen(false);
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => {
    if (!open) return;
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
  }, [busy, open]);

  return (
    <div className={styles.settings} ref={rootRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="模型与推理强度"
        onClick={toggleMenu}
      >
        <span>{modelLabel}{effortLabel ? ` · ${effortLabel}` : ""}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.settingsMenu} role="dialog" aria-label="模型设置">
          <label className={styles.settingRow}>
            <span>模型</span>
            <ModelSelect
              currentModel={draftModel}
              models={visibleModels}
              loading={loading}
              changing={busy}
              error={applyError || error}
              disabled={disabled}
              onChange={stageModel}
            />
          </label>
          <label className={styles.settingRow}>
            <span>推理强度</span>
            <ReasoningEffortSelect
              currentModel={draftModelEntry}
              currentEffort={draftEffort}
              loading={loading}
              changing={busy}
              error={applyError || error}
              disabled={disabled}
              onChange={stageEffort}
            />
          </label>
          {disabled ? <small className={styles.menuHint}>任务运行时暂时不能修改</small> : null}
          {crossProvider ? <div className={styles.menuHint} role="status">下次发送使用新渠道，会话保持不变。</div> : null}
          {applyError || error ? <small className={styles.menuError} role="alert">{error || applyError}</small> : null}
          <div className={styles.settingRow}>
            <span>渠道</span>
            <button className={styles.cancelButton} type="button" disabled={busy} onClick={() => { setOpen(false); setChannelsOpen(true); }}>
              {current?.providerDisplayName && current.providerDisplayName !== 'Current Codex provider' ? current.providerDisplayName : selectedProvider === 'fusheng-grok' ? 'Fusheng Grok' : '当前 Codex 渠道'} <ChevronDown size={12} />
            </button>
          </div>
          <div className={styles.settingsActions}>
            <button className={styles.cancelButton} type="button" disabled={busy} onClick={closeMenu}>取消</button>
            <button className={styles.confirmButton} type="button" disabled={disabled || busy || !hasChanges} onClick={() => void applySettings()}>
              {busy ? "正在应用" : crossProvider ? "切换" : "确认"}
            </button>
          </div>
        </div>
      ) : null}
      {channelsOpen ? <ChannelManager currentModel={currentModel} disabled={disabled} onSwitch={(model) => onModelChange(model, currentEffort)} onClose={() => setChannelsOpen(false)} /> : null}
    </div>
  );
}
