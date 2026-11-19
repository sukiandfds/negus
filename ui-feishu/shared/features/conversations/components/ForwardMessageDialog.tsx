import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import dialogStyles from "./ConversationActions.module.css";

export interface ForwardMessageTarget {
  id: string;
  name: string;
  subtitle?: string;
  threadId?: string | null;
  roomId?: string;
  pending?: boolean;
  session?: { archived?: boolean; readOnly?: boolean } | null;
}

export function ForwardMessageDialog<T extends ForwardMessageTarget>({
  open,
  targets,
  sourceId,
  busy,
  error,
  onClose,
  onForward,
}: {
  open: boolean;
  targets: T[];
  sourceId?: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onForward: (target: T) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [targetId, setTargetId] = useState("");
  const available = targets.filter(item => !item.pending && !item.session?.archived && !item.session?.readOnly
    && (item.roomId ? item.roomId !== sourceId : Boolean(item.threadId && item.threadId !== sourceId)));

  useEffect(() => {
    if (!open) return;
    setTargetId("");
    dialogRef.current?.showModal();
  }, [open]);

  if (!open) return null;
  const selected = available.find(item => (item.roomId || item.threadId || item.id) === targetId);
  return createPortal(
    <dialog ref={dialogRef} className={dialogStyles.dialog} aria-label="转发消息" onCancel={event => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <header><strong>转发消息</strong><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}><X /></button></header>
      <p>仅转发文字，附件不会转发。</p>
      <label>目标对话<select aria-label="目标对话" value={targetId} disabled={busy} onChange={event => setTargetId(event.target.value)}>
        <option value="">选择目标对话</option>
        {available.map(item => {
          const value = item.roomId || item.threadId || item.id;
          return <option key={item.roomId ? `group:${item.roomId}` : value} value={value}>{item.subtitle} · {item.name}</option>;
        })}
      </select></label>
      {error ? <p role="alert" className={dialogStyles.error}>{error}</p> : null}
      <footer>
        <button type="button" disabled={!selected || busy} onClick={() => selected && onForward(selected)}>{busy ? "正在转发…" : "转发"}</button>
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
      </footer>
    </dialog>,
    document.body,
  );
}
