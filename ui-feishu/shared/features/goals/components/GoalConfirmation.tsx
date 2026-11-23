import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./GoalConfirmation.module.css";
export function GoalConfirmation({ objective, attachmentNames, onCancel, onConfirm }: {
  objective: string; attachmentNames: string[]; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const title = "替换当前目标吗？";
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-label={title} onCancel={onCancel}>
    <form onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
      <h2>{title}</h2>
      <p>聊天记录会保留。新的目标内容如下：</p>
      {objective && <blockquote>{objective}</blockquote>}
      {attachmentNames.length > 0 && <ul aria-label="目标附件">{attachmentNames.map((name, index) => <li key={index}>{name}</li>)}</ul>}
      <footer><button type="button" onClick={onCancel}>取消</button><button type="submit">替换目标</button></footer>
    </form>
  </dialog>, document.body);
}
