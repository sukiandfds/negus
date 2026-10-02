import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { FushengUsageSnapshot } from "../model/types";
import styles from "./UsageSummaryControl.module.css";
import { useChannelCatalog } from '../../models/components/ChannelManager';
import type { CodexModel } from '../../models/model/types';
import { fetchJson, postJson } from '../../../shared/api/http';

interface UsageSummaryControlProps {
  currentModel?: string;
  models?: CodexModel[];
  snapshot: FushengUsageSnapshot | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}

const shanghaiParts = (value: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).formatToParts(value).map((part) => [part.type, part.value]));

const shanghaiDateKey = (value: Date) => {
  const parts = shanghaiParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const formatUpdatedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  const parts = shanghaiParts(date);
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

const compactAmount = (value: number | null) => value === null ? "--" : `$${value.toFixed(2)}`;
const preciseAmount = (value: number) => `$${value.toFixed(6)}`;
const formatRatio = (value: number | null) => value === null ? "--" : `${value.toFixed(2)}×`;
const formatCount = (value: number) => new Intl.NumberFormat("en-US").format(value);

export function UsageSummaryControl({ snapshot, loading, error, onRefresh, currentModel = "", models = [] }: UsageSummaryControlProps) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [configured, setConfigured] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [credentialMessage, setCredentialMessage] = useState('');
  useEffect(() => {
    if (!open) { setAccessToken(''); return; }
    const controller = new AbortController();
    void fetchJson<{ configured: boolean; userId: number | null }>('/api/usage/fusheng/credentials', controller.signal)
      .then((value) => {
        setConfigured(value.configured);
        setUserId(value.userId === null ? '' : String(value.userId));
        setCredentialsOpen(!value.configured);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setCredentialMessage(reason instanceof Error ? reason.message : '读取凭证状态失败');
      });
    return () => controller.abort();
  }, [open]);
  const saveCredentials = async () => {
    setSaving(true);
    setCredentialMessage('');
    try {
      await postJson('/api/usage/fusheng/credentials', { userId, accessToken });
      setAccessToken('');
      setConfigured(true);
      setCredentialMessage('凭证已保存');
      onRefresh();
    } catch (reason) {
      setCredentialMessage(reason instanceof Error ? reason.message : '保存失败');
    } finally { setSaving(false); }
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const { channels } = useChannelCatalog(models, currentModel);
  const providerId = models.find(model => model.model === currentModel)?.modelProviderId
    || (currentModel.includes('::') ? currentModel.split('::')[0] : /^grok-/i.test(currentModel) ? 'fusheng-grok' : 'current');
  const channel = currentModel ? channels.find(entry => entry.id === (providerId.startsWith('ccswitch_') ? providerId.slice(9) : providerId)) : undefined;
  const channelName = channel?.name || '配置未确认';
  const currentTodayAmount = snapshot?.queryDate === shanghaiDateKey(new Date())
    ? snapshot.today.amountUsd
    : null;

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const updatedAt = snapshot ? formatUpdatedAt(snapshot.updatedAt) : "未更新";
  const isGrok = /^grok-/i.test(currentModel);
  const featuredRatio = channel?.priceRatio ?? null;
  const groupEntries = Object.entries(snapshot?.groupRatios || {}).sort(([left], [right]) => left.localeCompare(right, "zh-CN"));

  const toggleDetails = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !snapshot && !loading) onRefresh();
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        className={styles.summaryButton}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="查看今日用量和分组倍率"
        onClick={toggleDetails}
      >
        <span className={styles.summaryValues}>
          <span className={styles.metric}>
            <span className={styles.metricLabel}>今日</span>
            <strong>{compactAmount(currentTodayAmount)}</strong>
          </span>
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.metric}>
            <span className={styles.channelName} title={channelName}>{channelName}</span>
            <strong>{formatRatio(featuredRatio)}</strong>
          </span>
        </span>
        {loading ? <span className={styles.loadingText}>更新中</span> : null}
      </button>

      {open ? (
        <section className={styles.popover} role="dialog" aria-label="浮生云算用量详情">
          <header className={styles.popoverHeader}>
            <div>
              <h2>浮生云算</h2>
              <p>{updatedAt} 更新 · 账户用量</p>
            </div>
            <button className={styles.refreshButton} type="button" aria-label="刷新用量" title="刷新用量" disabled={loading} onClick={onRefresh}>
              <RefreshCw className={loading ? styles.spinning : ""} aria-hidden="true" />
            </button>
          </header>

          <details className={styles.credentials} open={credentialsOpen} onToggle={(event) => setCredentialsOpen(event.currentTarget.open)}>
            <summary>{configured ? '账户凭证 · 已保存' : '设置账户凭证'}</summary>
            <form onSubmit={(event) => { event.preventDefault(); void saveCredentials(); }}>
              <label>用户 ID<input aria-label="浮生用户 ID" inputMode="numeric" autoComplete="off" value={userId} onChange={(event) => setUserId(event.target.value)} required /></label>
              <label>账户访问令牌<input aria-label="账户访问令牌" type="password" autoComplete="new-password" placeholder={configured ? '填写新令牌以替换' : 'Access Token'} value={accessToken} onChange={(event) => setAccessToken(event.target.value)} required /></label>
              <button type="submit" disabled={saving}>{saving ? '保存中…' : '保存凭证'}</button>
            </form>
            {credentialMessage ? <p role="status">{credentialMessage}</p> : null}
          </details>
          {snapshot ? (
            <>
              <dl className={styles.metrics}>
                <div><dt>今日金额</dt><dd>{snapshot.queryDate === shanghaiDateKey(new Date()) ? preciseAmount(snapshot.today.amountUsd) : "今日尚未更新"}</dd></div>
                <div><dt>今日请求</dt><dd>{snapshot.queryDate === shanghaiDateKey(new Date()) ? formatCount(snapshot.today.requests) : "--"}</dd></div>
                <div><dt>今日 Token</dt><dd>{snapshot.queryDate === shanghaiDateKey(new Date()) ? formatCount(snapshot.today.tokens) : "--"}</dd></div>
                <div><dt>账户余额</dt><dd>{preciseAmount(snapshot.account.balanceUsd)}</dd></div>
                <div><dt>历史用量</dt><dd>{preciseAmount(snapshot.account.historicalUsageUsd)}</dd></div>
                <div><dt>历史请求</dt><dd>{formatCount(snapshot.account.historicalRequests)}</dd></div>
              </dl>
              <div className={styles.groups}>
                {isGrok ? <p>Grok 使用独立 Key，当前分组倍率未知；以下为账户分组表。</p> : null}
                <h3>分组倍率</h3>
                <div className={styles.featuredGroup}>
                  <span>{snapshot.featuredGroup.name}</span><strong>{formatRatio(snapshot.featuredGroup.ratio)}</strong>
                </div>
                {groupEntries.filter(([name]) => name !== snapshot.featuredGroup.name).map(([name, ratio]) => (
                  <div key={name}><span>{name}</span><strong>{formatRatio(ratio)}</strong></div>
                ))}
              </div>
            </>
          ) : <p className={styles.empty}>{loading ? "正在读取真实用量..." : "回复完成后自动更新，也可以点击右上角刷新。"}</p>}
          {error ? <p className={styles.error}>{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
