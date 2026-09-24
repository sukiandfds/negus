import { Activity, ArrowLeft, ArrowUpRight, CheckCircle2, List, Maximize2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { useProjectDirectory } from "../project-directory/hooks/useProjectDirectory";
import { openAgentConversation } from "../agent-sharing/navigation/openAgentConversation";
import { taskPreview, type CurrentTask } from "./currentTasks";
import { useCurrentTasks } from "./useCurrentTasks";
import styles from "./CurrentTasksWidget.module.css";
import { fetchJson } from "../../shared/api/http";
import type { SessionDetail } from "../conversations/model/types";
import { readLocalCache, writeLocalCache } from "../../shared/state/localCache";

type Preview = { title: string; instruction: string; signature: string; at: number };
const previewCacheKey = "negus:desktop-task-previews:v1";
const shortStatus = (task: CurrentTask) => task.label.includes("等待") ? "待确认" : task.label.includes("恢复") || task.label.includes("待确认") ? "待同步" : task.category === "completed" ? "完成" : task.category === "running" ? task.label.includes("回复") ? "回复中" : "运行中" : task.label;

type Filter = "running" | "completed" | "other";
export function CurrentTasksWidget({ directory, active, connected, onSelect }: {
  directory: ReturnType<typeof useProjectDirectory>; active: boolean; connected: boolean; onSelect: (id: string) => void;
}) {
  const { tasks, checking, goalError, retry } = useCurrentTasks(directory, active);
  const { running, completed, items } = taskPreview(tasks);
  const itemOrder = useRef<string[]>([]);
  const shownIds = itemOrder.current.filter((id) => items.some((task) => task.id === id));
  const nextIds = [...shownIds, ...items.map((task) => task.id).filter((id) => !shownIds.includes(id))].slice(0, 3);
  itemOrder.current = nextIds;
  const shownItems = nextIds.flatMap((id) => { const task = items.find((entry) => entry.id === id); return task ? [task] : []; });
  const refreshTasks = () => { itemOrder.current = []; retry(); };
  const [view, setView] = useState<"expanded" | "list" | null>(null);
  const [filter, setFilter] = useState<Filter>("running");
  const [openError, setOpenError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>(() => readLocalCache<Record<string, Preview>>(previewCacheKey,
    (value): value is Record<string, Preview> => Boolean(value && typeof value === "object" && Object.values(value).every((item) => item && typeof item.instruction === "string"))) || {});
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(() => {
    const timer = window.setTimeout(() => writeLocalCache(previewCacheKey, Object.fromEntries(Object.entries(previews).sort((a, b) => b[1].at - a[1].at).slice(0, 100))), 250);
    return () => window.clearTimeout(timer);
  }, [previews]);
  const previewRequests = JSON.stringify((view === "list" ? tasks.filter((task) => task.category === filter) : items)
    .map((task) => ({ id: task.id, conversationId: task.conversation.conversationId, signature: `${task.conversation.updatedAt || task.conversation.lastActivityAt || ""}:${directory.statusByThread[task.id]?.turnId || ""}` })));
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const queue = (JSON.parse(previewRequests) as { id: string; conversationId?: string; signature: string }[])
      .filter((task) => { const cached = previewsRef.current[task.id]; return !cached || cached.signature !== task.signature || Date.now() - cached.at > 60_000; });
    void Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length && !controller.signal.aborted) {
        const task = queue.shift()!;
        const query = new URLSearchParams({ threadId: task.id, limit: "20" });
        if (task.conversationId) query.set("conversationId", task.conversationId);
        try {
          const detail = await fetchJson<SessionDetail>(`/api/session?${query}`, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
          if (controller.signal.aborted) return;
          const instruction = detail.latestUser || [...(detail.messages || [])].reverse().find((message) => message.role === "user")?.text || "暂无文字指令";
          setPreviews((current) => ({ ...current, [task.id]: { title: detail.title, instruction, signature: task.signature, at: Date.now() } }));
        } catch {
          if (!controller.signal.aborted) setPreviews((current) => current[task.id] ? current : ({ ...current, [task.id]: { title: "", instruction: "最新指令暂未读到", signature: task.signature, at: Date.now() } }));
        }
      }
    }));
    return () => controller.abort();
  }, [active, previewRequests]);
  useEffect(() => { if (!active) setView(null); }, [active]);
  useEffect(() => {
    if (view && !dialog.current?.open) dialog.current?.showModal();
    if (!view && dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [view]);
  const open = (task: CurrentTask) => {
    setOpenError("");
    if (task.project.employeeId) {
      void openAgentConversation({ agentId: task.project.employeeId, threadId: task.id, conversationId: task.conversation.conversationId })
        .then(() => setView(null)).catch(() => setOpenError("暂时无法打开这个对话，请重试。"));
    } else { setView(null); onSelect(task.id); }
  };
  const href = (task: CurrentTask) => {
    const params = new URLSearchParams({ view: "conversation", thread: task.id });
    if (task.project.employeeId) params.set("agent", task.project.employeeId);
    if (task.conversation.conversationId) params.set("conversation", task.conversation.conversationId);
    return `/?${params}`;
  };
  const rows = (entries: CurrentTask[], detailed = false) => <ul className={styles.rows}>{entries.map((task) => <li key={task.id}>
    <a className={`${styles.row} ${detailed ? styles.detailed : ""}`} href={href(task)} onClick={(event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); open(task);
    }}>
      <span className={`${styles.dot} ${task.category === "running" ? task.attention ? styles.attention : styles.running : ""}`} />
      <span className={styles.text}><strong>{previews[task.id]?.title || task.title}</strong><p className={styles.instruction}>{previews[task.id]?.instruction || "…"}</p>{detailed && <span>{task.project.name}{task.goal ? " · Goal" : ""}</span>}
        {detailed && task.updatedAt && <time dateTime={task.updatedAt}>更新于 {new Date(task.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>}
      </span><span className={styles.status} title={task.label}>{detailed ? task.label : shortStatus(task)}</span><ArrowUpRight size={14} aria-hidden="true" />
    </a>
  </li>)}</ul>;
  const warning = !connected || Boolean(directory.error) || goalError;
  const empty = <p className={styles.empty}>{warning ? "正在重新连接，任务记录将在连接后更新" : directory.loading || checking ? "正在读取任务…" : "暂无任务记录"}</p>;
  const list = tasks.filter((task) => task.category === filter);
  return <>
    <section className={styles.widget} aria-label="当前任务">
      <div className={styles.headingRow}><button ref={trigger} className={styles.heading} type="button" aria-haspopup="dialog" onClick={() => setView("expanded")}>
        <Activity size={18} aria-hidden="true" /><h2>当前任务</h2><Maximize2 size={14} aria-label="放大当前任务" />
      </button><button className={styles.refreshButton} type="button" aria-label="刷新当前任务" title="刷新当前任务" disabled={directory.loading || checking} onClick={refreshTasks}><RefreshCw size={15} aria-hidden="true" /></button></div>
      <p className={styles.caption}>{warning ? tasks.length ? "上次更新的任务" : "正在连接" : running.length ? `${running.length} 项进行中` : !tasks.length && (directory.loading || checking) ? "正在同步" : "最近完成"}</p>
      {items.length ? rows(shownItems) : empty}
      {openError && <p className={styles.warning} role="alert">{openError}</p>}
    </section>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="current-tasks-title" onCancel={() => setView(null)} onClick={(event) => { if (event.target === event.currentTarget) setView(null); }}>
      <div className={styles.panel}>
        <header className={styles.dialogHeader}>{view === "list" && <button type="button" aria-label="返回任务概览" onClick={() => setView("expanded")}><ArrowLeft size={18} /></button>}
          <h2 id="current-tasks-title">{view === "list" ? "任务列表" : "当前任务"}</h2><button type="button" aria-label="刷新当前任务" title="刷新当前任务" disabled={directory.loading || checking} onClick={refreshTasks}><RefreshCw size={17} aria-hidden="true" /></button><button type="button" aria-label="关闭当前任务" onClick={() => setView(null)}><X size={20} /></button>
        </header>
        {warning && <p className={styles.caption} role="status">正在重新连接{tasks.length ? " · 保留上次更新的任务" : ""}</p>}
        <div className={styles.body}>
          {view === "list" ? <>
            <div className={styles.filters} aria-label="任务筛选">{([ ["running", "进行中", running.length], ["completed", "已完成", completed.length], ["other", "暂停与异常", tasks.filter((task) => task.category === "other").length] ] as const).map(([key, title, count]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{title} <span>{count}</span></button>)}</div>
            {list.length ? rows(list, true) : <p className={styles.empty}>这里暂时没有任务。</p>}
          </> : <>
            <p className={styles.summary}>{warning ? "上次读取的任务记录" : !tasks.length && (directory.loading || checking) ? "正在同步任务状态" : running.length ? <><Activity size={17} />{running.length} 项任务正在进行</> : <><CheckCircle2 size={17} />最近完成的任务</>}</p>
            {items.length ? rows(shownItems, true) : empty}
          </>}
          {openError && <p className={styles.warning} role="alert">{openError}</p>}
        </div>
        {view !== "list" && <button className={styles.footer} type="button" onClick={() => { setFilter(running.length ? "running" : completed.length ? "completed" : "other"); setView("list"); }}><List size={16} />查看全部任务 · {tasks.length}</button>}
      </div>
    </dialog>
  </>;
}
