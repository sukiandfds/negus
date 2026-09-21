import { useEffect, useRef, useState } from "react";
import { Maximize2, RefreshCw, X, Clock3 } from "lucide-react";
import { fetchJson } from "../../shared/api/http";
import { readLocalCache, writeLocalCache } from "../../shared/state/localCache";
import styles from "./AutomationsWidget.module.css";

type Run = { threadId: string; status: string; createdAt: number; updatedAt: number };
type Automation = { id: string; name: string; status: string; schedule: string; kind: string; nextRunAt: number | null; lastRunAt: number | null; threadId: string | null; notificationPolicy: string | null; source: string; runs: Run[]; warning?: string };
type Snapshot = { items: Automation[]; checkedAt: number; warnings: string[]; coverage: string };
const key = "negus:desktop-automations:v1";
const valid = (value: unknown): value is Snapshot => Boolean(value && typeof value === "object" && Array.isArray((value as Snapshot).items) && typeof (value as Snapshot).checkedAt === "number" && Array.isArray((value as Snapshot).warnings));
const time = (value: number | null) => value ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "未提供";
const statusName = (value: string) => ({ ACTIVE: "已启用", PAUSED: "已暂停", DISABLED: "已停用", DELETED: "已删除", ARCHIVED: "已归档", IN_PROGRESS: "执行中", RUNNING: "执行中", COMPLETED: "已完成", SUCCESS: "成功", FAILED: "失败", ERROR: "异常", PENDING_REVIEW: "待查看" }[value] || value || "未知");
export function scheduleLabel(rule: string) {
  const fields: Record<string, string> = Object.fromEntries(rule.replace(/^RRULE:/, "").split(";").map((part) => part.split("=")));
  const interval = Number(fields.INTERVAL || 1);
  const extra = Object.keys(fields).some((key) => !["FREQ", "INTERVAL", "BYHOUR", "BYMINUTE", "BYSECOND", "BYDAY"].includes(key));
  if (extra) return rule || "未提供周期";
  const hours = fields.BYHOUR?.split(",");
  const minutes = fields.BYMINUTE?.split(",");
  if (fields.FREQ === "DAILY" && hours && minutes?.length === 1 && !fields.BYDAY && (!fields.BYSECOND || fields.BYSECOND === "0")) return `${interval === 1 ? "每天" : `每 ${interval} 天`} ${hours.map((hour) => `${hour.padStart(2, "0")}:${minutes[0].padStart(2, "0")}`).join("、")}`;
  if (fields.FREQ === "HOURLY" && !hours && minutes?.length === 1 && !fields.BYDAY && (!fields.BYSECOND || fields.BYSECOND === "0")) return `每 ${interval} 小时 · ${minutes[0]} 分`;
  return rule || "未提供周期";
}
export function AutomationsWidget({ active }: { active: boolean }) {
  const [data, setData] = useState<Snapshot | null>(() => readLocalCache(key, valid));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("all");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!active) { dialog.current?.close(); return; }
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true; setLoading(true);
      try {
        const result = await fetchJson<Snapshot>("/api/desktop/automations", AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
        if (!valid(result)) throw new Error("自动化数据格式异常");
        if (!controller.signal.aborted) {
          setData((previous) => {
            const next = result.warnings.length && previous
              ? { ...result, checkedAt: previous.checkedAt, items: [...new Map([...previous.items, ...result.items].map((item) => [item.id, item])).values()] }
              : result;
            writeLocalCache(key, next);
            return next;
          });
          setError("");
        }
      } catch { if (!controller.signal.aborted) setError("自动化任务同步失败"); }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [active, revision]);
  const items = data?.items || [];
  const warning = error || data?.warnings[0];
  const open = () => dialog.current?.showModal();
  const count = items.filter((item) => item.status === "ACTIVE").length;
  const detailItems = items.filter((item) => filter === "all" || (filter === "enabled" ? item.status === "ACTIVE" : item.status !== "ACTIVE"));
  return <>
    <section className={styles.widget} aria-label="自动化任务列表">
      <button className={styles.heading} onClick={open}><h2>自动化任务</h2><Maximize2 size={14} /></button>
      <p className={styles.caption}>{warning ? data ? `更新于 ${time(data.checkedAt)}` : "正在连接，稍后自动更新" : data ? `${items.length} 项 · ${count} 项启用` : "正在加载…"}</p>
      <div className={styles.rows}>{items.slice(0, 3).map((item) => <button key={item.id} className={styles.row} onClick={open}>
        <span className={styles.title}><strong>{item.name}</strong><small>{statusName(item.status)}</small></span>
        <span className={styles.schedule}>{scheduleLabel(item.schedule)}</span>
        <span className={styles.next}>下次 {item.status === "ACTIVE" ? time(item.nextRunAt) : "不安排"}</span>
      </button>)}</div>
      {data && !items.length && !warning && <p className={styles.empty}>暂无已配置的 Codex 自动化</p>}
      <button className={styles.footer} onClick={open}><Clock3 size={12} />{data ? "查看全部与执行记录" : "查看数据来源"}</button>
    </section>
    <dialog ref={dialog} className={styles.dialog} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className={styles.panel}>
        <header><h2>自动化任务</h2><button aria-label="刷新自动化任务" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={17} /></button><button aria-label="关闭自动化任务" onClick={() => dialog.current?.close()}><X size={19} /></button></header>
        <div className={styles.body}>
          <p className={styles.coverage}>{data ? `${warning ? "快照时间" : "更新于"} ${time(data.checkedAt)}` : "正在读取任务"}</p>
          {warning && <p role="status" className={styles.coverage}>{error ? "正在重新连接" : "正在补全任务数据"}{data ? " · 保留上次读取的记录" : "，连接后自动显示任务"}</p>}
          <nav className={styles.filters} aria-label="自动化筛选">{[["all", "全部"], ["enabled", "已启用"], ["other", "其他状态"]].map(([id, title]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{title}</button>)}</nav>
          {detailItems.map((item) => <article className={styles.detail} key={item.id}>
            <h3>{item.name}<small>{statusName(item.status)}</small></h3>
            <dl><dt>执行周期</dt><dd>{scheduleLabel(item.schedule)}（主机本地时间）</dd><dt>下次执行</dt><dd>{item.status === "ACTIVE" ? time(item.nextRunAt) : "不安排"}</dd><dt>最近触发</dt><dd>{time(item.lastRunAt)}</dd><dt>通知方式</dt><dd>{item.notificationPolicy === "failed_runs_only" ? "仅执行失败时通知" : item.notificationPolicy || "未提供"}</dd><dt>来源</dt><dd>{item.source}</dd></dl>
            {item.warning && <p className={styles.error}>{item.warning}</p>}
            <h4>最近执行记录</h4>
            {item.runs.length ? <ul>{item.runs.map((run) => <li key={run.threadId}><span>{time(run.createdAt)} · {statusName(run.status)}</span><a href={`/?view=conversation&thread=${encodeURIComponent(run.threadId)}`}>查看对话</a></li>)}</ul> : <p className={styles.coverage}>暂无执行明细</p>}
            {item.threadId && <a className={styles.link} href={`/?view=conversation&thread=${encodeURIComponent(item.threadId)}`}>打开关联会话 ↗</a>}
          </article>)}
          {data && !detailItems.length && <p className={styles.empty}>{warning ? "任务记录将在更新后显示" : "此分类暂无任务"}</p>}
          <details className={styles.coverage}><summary>数据来源与管理</summary><p>{data?.coverage || "本机 Codex 自动化"}</p><p>暂停或修改计划：在 Codex 自动化管理中操作。移除桌面组件不会停止任务。执行时间按当前设备时区显示。</p>{data?.warnings.map((text) => <p key={text}>{text.replace(/；.*$/, "")}</p>)}</details>
        </div>
      </div>
    </dialog>
  </>;
}
