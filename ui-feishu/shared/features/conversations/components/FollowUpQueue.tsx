import { useState } from "react";
import { ChevronUp, RotateCcw, Send, Trash2 } from "lucide-react";
import type { FollowUpQueueItem } from "../model/followUpQueue";
import styles from "./FollowUpQueue.module.css";
import actions from "./MessageActions.module.css";
import { MessageActions } from "./MessageActions";
import { Message } from "./ConversationView";
import { deliveryPatch, queuedTranscriptMessage } from "../state/optimisticMessage";

interface FollowUpQueueProps {
  items: FollowUpQueueItem[];
  onlyId?: string;
  compacting?: boolean;
  isHidden?: (item: FollowUpQueueItem) => boolean;
  busy: boolean;
  error: string;
  onEdit: (item: FollowUpQueueItem) => Promise<boolean>;
  onRemove: (itemId: string) => Promise<boolean>;
  onMove: (itemId: string, direction: "up" | "down") => Promise<boolean>;
  onRetry: (itemId: string) => Promise<boolean>;
  onSendNow: (itemId: string) => Promise<boolean>;
}

export function FollowUpQueue({ items, onlyId, compacting, isHidden, busy, error, onEdit, onRemove, onMove, onRetry, onSendNow }: FollowUpQueueProps) {
  const [notice, setNotice] = useState(0);
  if (!items.some(item => !isHidden?.(item)) && !error) return null;

  return (
    <section aria-label="指令等候中">
      {notice > 0 && <span key={notice} role="status" className={styles.notice} onAnimationEnd={() => setNotice(0)}>正在压缩，结束后发送</span>}
      {error && <p className={styles.error}>{error}</p>}
      {items.map((item, index) => {
        if ((onlyId && item.id !== onlyId) || isHidden?.(item)) return null;
        const locked = busy || item.state === "dispatching";
        return (
          <Message key={item.id}
            message={{ ...queuedTranscriptMessage(item), authorName: item.authorName || "我",
              ...deliveryPatch(item.state === "dispatching" ? "sending" : item.state === "failed" ? "failed" : undefined, item.error) }}
            threadId={item.threadId} queued={item.state === "pending"}
            onFork={async () => false} onEdit={() => void onEdit(item)}
            actions={<MessageActions text={item.text} forkable={false} forking={false} onFork={async () => false} editable editing={locked} onEdit={() => void onEdit(item)}>
                  <button className={actions.button} type="button" title="直接发送" aria-label="直接发送" disabled={locked} onClick={() => compacting ? setNotice(value => value + 1) : void onSendNow(item.id)}><Send aria-hidden="true" /></button>
                  {item.state === "failed" && <button className={actions.button} type="button" title="重试" aria-label="重试" disabled={locked} onClick={() => void onRetry(item.id)}><RotateCcw aria-hidden="true" /></button>}
                  <button className={actions.button} type="button" title="提前" aria-label="提前" disabled={locked || index === 0} onClick={() => void onMove(item.id, "up")}><ChevronUp aria-hidden="true" /></button>
                  <button className={actions.button} type="button" title="删除" aria-label="删除" disabled={locked} onClick={() => void onRemove(item.id)}><Trash2 aria-hidden="true" /></button>
            </MessageActions>}
          />
        );
      })}
    </section>
  );
}
