import { Archive, ArchiveRestore, Copy, Forward, MoreHorizontal, Pencil, Pin, PinOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchJson, postJson } from "../../../web-ui/src/shared/api/http";
import type { SessionSummary } from "../../../web-ui/src/features/conversations/model/types";
import styles from "../../../web-ui/src/features/conversations/components/ConversationActions.module.css";

type Target = { threadId: string; title: string; projectName: string; employeeId: string; conversationId: string };
type Props = { session: SessionSummary; archived: boolean; disabled: boolean; onArchive: () => void; className: string; pinned?: boolean; onTogglePin?: () => void; pinOnly?: boolean };
export function ConversationActions({ session, archived, disabled, onArchive, className, pinned, onTogglePin, pinOnly }: Props) {
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"forward" | "rename" | "">("");
  const [name, setName] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const dialogElement = useRef<HTMLDialogElement>(null);
  const request = useRef<{ target: string; id: string } | undefined>(undefined);
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector("button")?.focus();
    const close = (e: PointerEvent) => {
      if (!menuElement.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [menu]);
  useEffect(() => {
    if (dialog) dialogElement.current?.showModal();
    else dialogElement.current?.close();
  }, [dialog]);
  const openForward = async () => {
    setMenu(false); setDialog("forward"); setBusy(true); setError(""); setTarget("");
    try { setTargets((await fetchJson<Target[]>("/api/conversation-forward/targets")).filter(t => t.threadId !== session.threadId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const sourceConversationId = async () => {
    const targets = await fetchJson<Target[]>("/api/conversation-forward/targets");
    return targets.find(t => t.threadId === session.threadId)?.conversationId || "";
  };
  const rename = async () => {
    const normalized = name.trim();
    if (busy || !normalized || normalized.length > 120) return;
    setBusy(true); setError("");
    try {
      const renamed = await postJson<SessionSummary>("/api/session/name", {
        threadId: session.threadId, name: normalized, conversationId: await sourceConversationId(),
      });
      window.dispatchEvent(new CustomEvent("negus:session-renamed", { detail: renamed }));
      setDialog("");
      button.current?.focus();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const conversationId = await sourceConversationId();
      const result = await postJson<{ session: SessionSummary }>("/api/session/fork", {
        threadId: session.threadId, conversationId, latest: true,
      });
      const url = new URL(window.location.href);
      for (const key of ["conversation", "employee", "employeeId", "agent", "archived"]) url.searchParams.delete(key);
      url.searchParams.set("thread", result.session.threadId);
      url.searchParams.set("view", "conversation");
      window.history.pushState(null, "", url.toString());
      window.dispatchEvent(new Event("negus:navigate"));
      setMenu(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const forward = async () => {
    if (!target || busy) return;
    if (request.current?.target !== target) request.current = { target, id: crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      await postJson("/api/conversation-forward", { sourceThreadId: session.threadId, targetThreadId: target, requestId: request.current.id });
      request.current = undefined;
      setDialog("");
      button.current?.focus();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const close = () => { if (!busy) { setDialog(""); button.current?.focus(); } };
  return <>
    <button ref={button} className={className} type="button" title="更多操作" aria-label={`更多操作：${session.title}`}
      aria-haspopup="menu" aria-expanded={menu} disabled={disabled || busy}
      onClick={() => {
        const rect = button.current!.getBoundingClientRect();
        setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 255)), left: Math.max(8, Math.min(rect.right - 150, window.innerWidth - 160)) });
        setMenu(!menu);
      }}><MoreHorizontal aria-hidden="true" /></button>
    {menu && createPortal(<div ref={menuElement} role="menu" className={styles.menu} style={position}>
      {onTogglePin && <button role="menuitem" onClick={() => { setMenu(false); onTogglePin(); }}>{pinned ? <PinOff /> : <Pin />}{pinned ? '取消置顶' : '置顶'}</button>}
      {!pinOnly && <>
      <button role="menuitem" disabled={busy || session.readOnly} onClick={() => {
        setMenu(false); setName(session.title); setError(""); setDialog("rename");
      }}><Pencil />重命名</button>
      <button role="menuitem" disabled={busy} onClick={() => void openForward()}><Forward />转发</button>
      <button role="menuitem" disabled={busy || archived} onClick={() => void copy()}><Copy />{busy ? "复制中…" : "复制"}</button>
      <button role="menuitem" disabled={busy} onClick={() => { setMenu(false); onArchive(); }}>{archived ? <ArchiveRestore /> : <Archive />}{archived ? "恢复" : "归档"}</button>
      </>}
      {error && !dialog ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div>, document.body)}
    {dialog && createPortal(<dialog ref={dialogElement} className={styles.dialog} aria-label={dialog === "rename" ? "重命名对话" : "转发对话"}
      onCancel={e => { e.preventDefault(); close(); }}>
      <header><strong>{dialog === "rename" ? "重命名对话" : "转发对话"}</strong><button aria-label="关闭" disabled={busy} onClick={close}><X /></button></header>
      {dialog === "rename" ? <form onSubmit={e => { e.preventDefault(); void rename(); }}>
        <label>对话名称<input autoFocus aria-label="对话名称" value={name} maxLength={120} disabled={busy}
          onFocus={e => e.currentTarget.select()} onChange={e => { setName(e.target.value); setError(""); }} /></label>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <footer><button type="submit" disabled={busy || !name.trim()}>{busy ? "保存中…" : "保存"}</button>
          <button type="button" disabled={busy} onClick={close}>取消</button></footer>
      </form> : <>
      <p className={styles.source}>{session.title}</p>
      <>
        <label>目标对话<select aria-label="目标对话" value={target} disabled={busy} onChange={e => setTarget(e.target.value)}>
          <option value="">选择项目 / Agent 中的对话</option>
          {targets.map(t => <option key={t.threadId} value={t.threadId}>{t.projectName} · {t.title}</option>)}
        </select></label>
        <p>目标助手阅读原对话，简要反馈理解，然后等待你的下一步指令。忙碌时排队。</p>
        {!busy && !error && !targets.length ? <p>暂无其他可转发的对话，请先建立目标对话。</p> : null}
      </>
      {busy ? <p role="status">正在读取并转发，请稍候…</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <footer><button disabled={!target || busy} onClick={() => void forward()}>转发</button>
        <button disabled={busy} onClick={close}>关闭</button></footer>
      </>}
    </dialog>, document.body)}
  </>;
}
