import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./GoalConfirmation.module.css";
export function GoalConfirmation({ kind, objective, paused = false, busy = false, error = "", onCancel, onConfirm }: {
  kind: "replace" | "resume"; objective: string; paused?: boolean; busy?: boolean; error?: string; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const title = kind === "replace" ? "替换当前目标吗？" : paused ? "恢复已暂停的目标吗？" : "恢复目标？";
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-label={title} onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(); }}>
      <h2>{title}</h2>
      <p>{kind === "replace" ? "这会保留聊天，但会用你当前在输入框中的文本替换已保存的目标" : "聊天处于空闲状态时，Codex 会继续推进此目标"}</p>
      <blockquote>{objective}</blockquote>
      {error ? <p role="alert">{error}</p> : null}
      <footer><button type="button" disabled={busy} onClick={onCancel}>{kind === "replace" ? "取消" : paused ? "保持暂停" : "以后再说"}</button><button type="submit" disabled={busy}>{kind === "replace" ? "替换目标" : "继续目标"}</button></footer>
    </form>
  </dialog>, document.body);
}
