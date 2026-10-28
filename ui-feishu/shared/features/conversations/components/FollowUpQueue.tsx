import { ChevronUp, RotateCcw, Send, Trash2 } from "lucide-react";
import type { FollowUpQueueItem } from "../model/followUpQueue";
import styles from "./FollowUpQueue.module.css";
import actions from "./MessageActions.module.css";
import { MessageActions } from "./MessageActions";
import { Message } from "./ConversationView";
import { createOptimisticMessage } from "../state/optimisticMessage";

interface FollowUpQueueProps {
  items: FollowUpQueueItem[];
  isHidden?: (item: FollowUpQueueItem) => boolean;
  busy: boolean;
  error: string;
  onEdit: (item: FollowUpQueueItem) => Promise<boolean>;
  onRemove: (itemId: string) => Promise<boolean>;
  onMove: (itemId: string, direction: "up" | "down") => Promise<boolean>;
  onRetry: (itemId: string) => Promise<boolean>;
  onSendNow: (itemId: string) => Promise<boolean>;
}

export function FollowUpQueue({ items, isHidden, busy, error, onEdit, onRemove, onMove, onRetry, onSendNow }: FollowUpQueueProps) {
  if (!items.some(item => !isHidden?.(item)) && !error) return null;

  return (
    <section aria-label="指令等候中">
      {error && <p className={styles.error}>{error}</p>}
      {items.map((item, index) => {
        if (isHidden?.(item)) return null;
        const locked = busy || item.state === "dispatching";
        return (
          <Message key={item.id}
            message={{ ...createOptimisticMessage(item.text, item.attachments, item.submissionId, item.createdAt), authorName: "我",
              deliveryState: item.state === "dispatching" ? "sending" : item.state === "failed" ? "failed" : undefined, deliveryError: item.error }}
            threadId={item.threadId} queued={item.state === "pending"}
            onFork={async () => false} onEdit={() => void onEdit(item)}
            actions={<MessageActions text={item.text} forkable={false} forking={false} onFork={async () => false} editable editing={locked} onEdit={() => void onEdit(item)}>
                  <button className={actions.button} type="button" title="直接发送" aria-label="直接发送" disabled={locked} onClick={() => void onSendNow(item.id)}><Send aria-hidden="true" /></button>
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
