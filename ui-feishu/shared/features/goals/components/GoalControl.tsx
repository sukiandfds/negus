import { LoaderCircle, Pause, Pencil, Play, Target, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { goalElapsedSeconds, goalStatusLabels, nextGoalStatus, type EditableGoalStatus, type ThreadGoal } from "../model/types";
import styles from "./GoalControl.module.css";
import { GoalObjectiveEditor } from "./GoalObjectiveEditor";

export function GoalControl({ goal, busy, error, disabled, onStatusChange, onClear, onEdit }: {
  goal: ThreadGoal | null;
  busy: boolean;
  error: string;
  disabled: boolean;
  onStatusChange: (status: EditableGoalStatus) => Promise<boolean>;
  onClear: () => Promise<boolean>;
  onEdit: (objective: string) => Promise<boolean>;
}) {
  const [now, setNow] = useState(Date.now);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savedAt, setSavedAt] = useState(Date.now);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setEditing(false);
  }, [goal?.threadId]);
  useEffect(() => {
    if (goal?.status !== "active" && !editing) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [goal?.status, goal?.updatedAt, editing]);
  useEffect(() => {
    if (editing) dialog.current?.show();
  }, [editing]);
  if (!goal) return error ? <p className={styles.error} role="alert">{error}</p> : null;

  const objective = goal.displayObjective ?? goal.objective;
  const next = nextGoalStatus(goal.status);
  const seconds = Math.floor(goalElapsedSeconds(goal, now));
  const duration = seconds < 60 ? seconds + " 秒" : seconds < 3600
    ? Math.floor(seconds / 60) + " 分 " + seconds % 60 + " 秒"
    : Math.floor(seconds / 3600) + " 小时 " + Math.floor(seconds % 3600 / 60) + " 分";
  const format = (value: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const progress = goal.tokenBudget != null && ["active", "budgetLimited"].includes(goal.status)
    ? format(goal.tokensUsed) + " / " + format(goal.tokenBudget) : duration;
  const edit = () => { setDraft(objective); setSavedAt(goal.updatedAt * 1000); setEditing(true); };
  const save = async () => {
    const nextDraft = draft.trim();
    if (!busy && nextDraft && nextDraft !== objective && await onEdit(nextDraft)) {
      setDraft(nextDraft);
      setSavedAt(Date.now());
      setNow(Date.now());
    }
  };
  const savedMinutes = Math.max(0, Math.floor((now - savedAt) / 60000));
  const finished = goal.status === "complete";

  return (
    <div className={styles.root} aria-label="目标状态">
      <div className={styles.row}>
        <Target aria-hidden="true" />
        <button type="button" className={styles.summary} disabled={busy || disabled || finished} onClick={edit} title={objective}>
          <strong>{goalStatusLabels[goal.status] || "目标状态待确认"}</strong>
          <span className={styles.objective}>{objective}</span>
          <span className={styles.progress}>{progress}</span>
        </button>
        {!finished ? <div className={styles.actions}>
          <button type="button" disabled={disabled || busy} title="清除目标" aria-label="清除目标" onClick={() => void onClear()}><X /></button>
          {next ? <button type="button" disabled={disabled || busy} title={next === "paused" ? "暂停目标" : "恢复目标"} aria-label={next === "paused" ? "暂停目标" : "恢复目标"} onClick={() => void onStatusChange(next)}>
            {busy ? <LoaderCircle className={styles.spinner} /> : next === "paused" ? <Pause /> : <Play />}
          </button> : null}
          <button type="button" disabled={disabled || busy} title="编辑目标" aria-label="编辑目标" onClick={edit}><Pencil /></button>
        </div> : null}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {editing ? createPortal(
        <dialog ref={dialog} className={styles.editor} aria-label="编辑目标" onCancel={(event) => { if (busy) event.preventDefault(); else setEditing(false); }} onClose={() => setEditing(false)}>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <header><strong>编辑目标</strong><button type="button" aria-label="关闭目标编辑" disabled={busy} onClick={() => setEditing(false)}><X /></button></header>
            <GoalObjectiveEditor value={draft} disabled={busy} onChange={setDraft} onSave={() => void save()} />
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <footer><span className={styles.updated} role="status">{savedMinutes === 0 ? "刚刚更新" : savedMinutes + " 分钟前更新"}</span><button type="button" disabled={busy || draft === objective} onClick={() => setDraft(objective)}>还原</button><button type="submit" disabled={disabled || busy || !draft.trim() || draft.trim() === objective}>保存</button></footer>
          </form>
        </dialog>, document.body,
      ) : null}
    </div>
  );
}
