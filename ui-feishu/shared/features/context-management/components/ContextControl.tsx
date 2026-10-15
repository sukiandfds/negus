import { useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import type { ContextStatus } from "../model/types";
import styles from "./ContextControl.module.css";

interface ContextControlProps {
  status: ContextStatus;
  disabled: boolean;
  onCompact: () => Promise<boolean>;
  onThresholdChange: (threshold: number | null) => Promise<boolean>;
}

const formatTokens = (tokens: number | null) => {
  if (tokens === null || !Number.isFinite(tokens)) return "--";
  const value = tokens / 1000;
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10}k`;
};

const thresholdTokens = (contextWindow: number | null, threshold: number | null) => (
  contextWindow !== null && threshold !== null
    ? Math.round((contextWindow * threshold) / 100)
    : null
);

export function ContextControl({ status, disabled, onCompact, onThresholdChange }: ContextControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const compacting = status.phase === "compacting";
  const queued = status.phase === "queued";
  const percentage = status.percentage === null ? "--" : String(status.percentage);
  const usageLabel = status.percentage === null ? "--" : `${percentage}%`;
  const usedLabel = formatTokens(status.usedTokens);
  const windowLabel = formatTokens(status.contextWindow);
  const autoThresholdTokens = thresholdTokens(status.contextWindow, status.autoCompactThreshold);
  const autoLabel = status.autoCompactThreshold === null
    ? "自动关"
    : status.contextWindow === null
      ? `${status.autoCompactThreshold}%压缩`
      : `${status.autoCompactThreshold}%压缩（${formatTokens(autoThresholdTokens)}）`;
  const summary = status.usedTokens === null || status.contextWindow === null || status.percentage === null
    ? "上下文 --"
    : `上下文 ${usedLabel} / ${windowLabel}（${usageLabel}）`;
  const detail = status.message || (status.percentage === null
    ? "等待 Codex 返回上下文使用量"
    : `已使用 ${status.usedTokens?.toLocaleString()} / ${status.contextWindow?.toLocaleString()} tokens；${autoLabel}`);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={styles.controls} ref={rootRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={detail}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{summary}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.menu} role="dialog" aria-label="上下文设置">
          <div className={styles.usage}>
            <span>当前使用</span>
            <strong>{usedLabel} / {windowLabel}（{usageLabel}）</strong>
          </div>
          <div className={styles.meter} aria-hidden="true">
            <i style={{ width: `${Math.max(0, Math.min(status.percentage || 0, 100))}%` }} />
          </div>
          <button
            className={`${styles.compactButton} ${compacting ? styles.compacting : ""}`}
            type="button"
            disabled={disabled || compacting}
            onClick={() => void onCompact()}
          >
            {compacting ? <LoaderCircle aria-hidden="true" /> : null}
            <span>{compacting ? "正在压缩" : queued ? "任务完成后压缩" : "立即压缩"}</span>
          </button>
          <label className={styles.thresholdRow}>
            <span>
              自动压缩
              {status.autoCompactThreshold === null ? "" : ` · ${formatTokens(autoThresholdTokens)}`}
            </span>
            <select
              className={styles.threshold}
              disabled={disabled || compacting}
              value={status.autoCompactThreshold === null ? "off" : status.autoCompactThreshold}
              onChange={(event) => {
                const value = event.target.value;
                void onThresholdChange(value === "off" ? null : Number(value));
              }}
            >
              <option value="off">关闭</option>
              {[70, 80, 90].map((threshold) => (
                <option key={threshold} value={threshold}>
                  {threshold}%{status.contextWindow === null ? "" : ` · ${formatTokens(thresholdTokens(status.contextWindow, threshold))}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
