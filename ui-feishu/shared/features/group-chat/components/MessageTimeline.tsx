import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { JumpToLatest } from "../../../components/JumpToLatest/JumpToLatest";
import { useReturnToBottom } from "../../../components/JumpToLatest/useReturnToBottom";
import { emptyStatus } from "../../context-management/hooks/useContextManagement";
import { Message } from "../../conversations/components/ConversationView";
import { deliveryPatch, messageContentBlocks } from "../../conversations/state/optimisticMessage";
import type { SessionMessage } from "../../conversations/model/types";
import type { ExecutionStatus } from "../../execution/model/types";
import type { GroupMessage, GroupMessageHistory, GroupStreamingMessage } from "../model/types";
import { avatarColor } from "../../../shared/presentation/avatarColor";
import styles from "./MessageTimeline.module.css";


const groupExecution = (id: string, label: string, text: string, startedAt: string | null): ExecutionStatus => ({
  type: "execution_status",
  threadId: id,
  turnId: id,
  phase: "working",
  label,
  detail: "",
  commentary: text,
  active: true,
  startedAt,
  updatedAt: null,
  activities: text ? [{ id, phase: "working", label: "正在回复", detail: text, completed: false, updatedAt: startedAt || "" }] : [],
});

// A task's empty placeholder and persisted terminal message are the same visual
// bubble. Keep that identity stable so realtime delivery updates it in place.
const timelineMessageKey = (message: GroupMessage) => {
  if (message.type === "human" && message.clientMessageId) return `client:${message.clientMessageId}`;
  if (!message.workId) return `message:${message.id}`;
  if (message.phase === "commentary") {
    return `work:${message.workId}:item:${message.itemId || message.id}`;
  }
  return `work:${message.workId}:final`;
};

export const groupSessionMessage = (message: GroupMessage, currentMemberId: string): SessionMessage => ({
  id: message.id,
  submissionId: message.clientMessageId || undefined,
  role: message.type === "human" && message.authorId === currentMemberId ? "user" : "assistant",
  authorId: message.authorId,
  authorName: message.authorName,
  text: message.text,
  blocks: messageContentBlocks(message.id, message.text, message.attachments || []),
  createdAt: message.createdAt,
  sequence: message.sequence,
  ...deliveryPatch(message.type === "human" && message.pending ? "sending" : message.type === "human" && message.failure ? "failed" : undefined, message.failure ? message.deliveryError || "发送失败" : undefined),
});

const TimelineMessage = memo(function TimelineMessage({
  groupMessage,
  currentMemberId,
  liveText,
  onQuote,
  onEdit,
  editable,
  editDisabled,
  editing,
  onSelect,
  selectDisabled,
  shareableRoomId,
  onRetry,
  retrying,
}: {
  groupMessage: GroupMessage;
  currentMemberId: string;
  liveText: string;
  onQuote?: () => void;
  onEdit?: () => void;
  editable?: boolean;
  editDisabled?: boolean;
  editing?: boolean;
  onSelect?: () => void;
  selectDisabled?: boolean;
  shareableRoomId?: string;
  onRetry?: () => Promise<boolean>;
  retrying?: boolean;
}) {
  const pendingAgent = groupMessage.type === "agent" && groupMessage.pending;
  const executionId = groupMessage.workId || groupMessage.id;
  return <Message
    message={groupSessionMessage(groupMessage, currentMemberId)}
    executionPlaceholder={Boolean(pendingAgent)}
    executionStatus={pendingAgent ? groupExecution(executionId, "正在回复", liveText, groupMessage.createdAt) : undefined}
    contextStatus={pendingAgent ? emptyStatus(executionId) : undefined}
    onQuote={onQuote}
    onSelect={onSelect}
    selectDisabled={selectDisabled}
    quoteDisabled={Boolean(groupMessage.pending)}
    editable={editable}
    editDisabled={editDisabled}
    editing={editing}
    onEdit={onEdit}
    shareable={Boolean(shareableRoomId) && groupMessage.type === "agent" && !groupMessage.pending && Boolean(groupMessage.agentId) && Boolean(groupMessage.text.trim())}
    groupShare={shareableRoomId && groupMessage.type === "agent" && groupMessage.agentId ? { roomId: shareableRoomId, agentId: groupMessage.agentId } : undefined}
    retryable={groupMessage.type === "human" && groupMessage.failure === true}
    retrying={retrying}
    onRetry={onRetry}
  />;
}, (previous, next) => previous.groupMessage === next.groupMessage
  && previous.currentMemberId === next.currentMemberId
  && previous.liveText === next.liveText
  && Boolean(previous.onQuote) === Boolean(next.onQuote)
  && Boolean(previous.onEdit) === Boolean(next.onEdit)
  && previous.editable === next.editable
  && previous.editDisabled === next.editDisabled
  && previous.editing === next.editing
  && Boolean(previous.onSelect) === Boolean(next.onSelect)
  && previous.selectDisabled === next.selectDisabled
  && previous.shareableRoomId === next.shareableRoomId
  && Boolean(previous.onRetry) === Boolean(next.onRetry)
  && previous.retrying === next.retrying);

export function MessageTimeline({
  active,
  roomId,
  messages,
  currentMemberId,
  streaming,
  localSendVersion,
  history,
  historyLoading,
  historyNavigation,
  focusRequest = null,
  onLoadOlder,
  onLoadNewer,
  onReturnToLatest,
  onQuote,
  onEdit,
  editingMessageId = "",
  selectedMessages = null,
  onSelectMessage,
  onRetry,
  retryingMessageId = "",
  unseenLiveCount = 0,
}: {
  active: boolean;
  roomId: string;
  messages: GroupMessage[];
  currentMemberId: string;
  streaming: Record<string, GroupStreamingMessage>;
  localSendVersion: number;
  history?: GroupMessageHistory;
  historyLoading: boolean;
  historyNavigation: { version: number; align: "top" | "bottom" };
  focusRequest?: { id: string; nonce: number } | null;
  onLoadOlder: () => Promise<boolean>;
  onLoadNewer: () => Promise<boolean>;
  onReturnToLatest: () => Promise<boolean>;
  onQuote?: (message: GroupMessage) => void;
  onEdit?: (message: GroupMessage) => void;
  editingMessageId?: string;
  selectedMessages?: ReadonlySet<string> | null;
  onSelectMessage?: (id: string) => void;
  onRetry?: (message: GroupMessage) => Promise<boolean>;
  retryingMessageId?: string;
  unseenLiveCount?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const streams = Object.entries(streaming).filter(([, value]) => value.text);
  const messageWorkIds = new Set(messages.map((message) => message.workId).filter(Boolean));
  const orphanStreams = streams.filter(([workId]) => !messageWorkIds.has(workId));
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const scrollToBottom = useCallback(() => {
    const root = scrollRef.current;
    if (root) root.scrollTop = root.scrollHeight;
  }, []);
  const historyPositionRef = useRef(historyNavigation.version);
  const [highlightedId, setHighlightedId] = useState("");
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const oldestSequenceRef = useRef(messages[0]?.sequence || 0);
  const {
    visible: showReturnToBottom,
    stickToBottomRef,
    onScroll: updateReturnToBottom,
    contentChanged,
    returnToBottom,
    reset: resetReturnToBottom,
  } = useReturnToBottom({
    active,
    isStreaming: streams.length > 0,
    localSendVersion,
    getScrollElement,
    scrollToBottom,
    promptDistance: 120,
  });
  const newestIdRef = useRef(messages.at(-1)?.id || "");
  const [arrivedWhileReading, setArrivedWhileReading] = useState(0);

  useLayoutEffect(() => {
    if (!active) return;
    resetReturnToBottom(true);
    scrollToBottom();
  }, [active, resetReturnToBottom, roomId, scrollToBottom]);

  useEffect(() => {
    contentChanged();
  }, [contentChanged, messages.length, streaming]);
  useEffect(() => {
    const newestId = messages.at(-1)?.id || "";
    const previousId = newestIdRef.current;
    newestIdRef.current = newestId;
    if (stickToBottomRef.current) {
      setArrivedWhileReading(0);
      return;
    }
    if (!previousId || newestId === previousId) return;
    const previousIndex = messages.findIndex((message) => message.id === previousId);
    const appended = previousIndex >= 0 ? messages.length - 1 - previousIndex : 0;
    if (appended > 0) setArrivedWhileReading((count) => count + appended);
  }, [messages, stickToBottomRef]);
  useEffect(() => {
    if (!showReturnToBottom && !history?.date && !history?.hasNewer) setArrivedWhileReading(0);
  }, [history?.date, history?.hasNewer, showReturnToBottom]);

  useLayoutEffect(() => {
    if (historyNavigation.version === historyPositionRef.current) return;
    historyPositionRef.current = historyNavigation.version;
    const root = scrollRef.current;
    if (!root) return;
    root.scrollTop = historyNavigation.align === "top" ? 0 : root.scrollHeight;
    resetReturnToBottom(historyNavigation.align === "bottom");
  }, [historyNavigation, resetReturnToBottom]);

  useLayoutEffect(() => {
    if (!focusRequest?.id) return;
    const root = scrollRef.current;
    const target = root?.querySelector(`[data-message-id="${CSS.escape(focusRequest.id)}"]`);
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ block: "center" });
    setHighlightedId(focusRequest.id);
    const timer = window.setTimeout(() => {
      setHighlightedId((current) => current === focusRequest.id ? "" : current);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [focusRequest, messages]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const oldestSequence = messages[0]?.sequence || 0;
    if (anchor && oldestSequence && oldestSequence < oldestSequenceRef.current) {
      const root = scrollRef.current;
      if (root) root.scrollTop = anchor.top + root.scrollHeight - anchor.height;
    }
    prependAnchorRef.current = null;
    oldestSequenceRef.current = oldestSequence;
  }, [messages]);

  const onTimelineScroll = (root: HTMLDivElement) => {
    updateReturnToBottom(root);
    if (historyLoading) return;
    if (root.scrollTop < 80 && history?.hasOlder) {
      prependAnchorRef.current = { height: root.scrollHeight, top: root.scrollTop };
      void onLoadOlder();
    }
    if (root.scrollHeight - root.scrollTop - root.clientHeight < 80 && history?.hasNewer) void onLoadNewer();
  };

  return (
    <div className={styles.timelineShell}>
      <div className={styles.timeline} ref={scrollRef} onScroll={(event) => onTimelineScroll(event.currentTarget)}>
        {!messages.length && !streams.length ? (
          <div className={styles.emptyState}>这个群还没有消息</div>
        ) : null}
        {messages.map((message) => {
          const liveStream = message.workId ? streaming[message.workId] : undefined;
          const hasContent = Boolean(message.text.trim()) || Boolean(message.attachments?.length);
          const contentAvailable = !message.pending && hasContent;
          const selectActionAvailable = hasContent && message.type !== "system";
          const selectable = contentAvailable && message.type !== "system";
          const ownMessage = message.type === "human" && message.authorId === currentMemberId;
          return (
            <div
              key={timelineMessageKey(message)}
              data-message-id={message.id}
              data-focused={highlightedId === message.id ? "" : undefined}
              style={{ "--agent-color": avatarColor(message.agentId || message.authorId) } as CSSProperties}
            >
              {selectedMessages && selectable ? <label className={styles.selectMessage}><input type="checkbox" aria-label={`选择消息 ${message.id}`} checked={selectedMessages.has(message.id)} onChange={() => onSelectMessage?.(message.id)} />选择</label> : null}
              <TimelineMessage
                groupMessage={message}
                currentMemberId={currentMemberId}
                liveText={liveStream?.text || message.text}
                onQuote={onQuote && hasContent ? () => onQuote(message) : undefined}
                editable={ownMessage && Boolean(onEdit)}
                editDisabled={Boolean(message.pending)}
                editing={editingMessageId === message.id}
                onEdit={ownMessage && onEdit ? () => onEdit(message) : undefined}
                onSelect={!selectedMessages && selectActionAvailable && onSelectMessage ? () => onSelectMessage(message.id) : undefined}
                selectDisabled={Boolean(message.pending)}
                onRetry={onRetry && message.type === "human" && message.failure === true ? () => onRetry(message) : undefined}
                retrying={retryingMessageId === message.id}
                shareableRoomId={roomId}
              />
            </div>
          );
        })}
        {(history?.date || history?.hasNewer) ? null : orphanStreams.map(([workId, value]) => {
          return (
            <div key={workId} style={{ "--agent-color": avatarColor(value.agentId) } as CSSProperties}>
              <Message
                message={{ id: workId, role: "assistant", authorName: "Codex Agent", text: "", createdAt: value.startedAt }}
                executionPlaceholder
                executionStatus={groupExecution(workId, "正在回复", value.text, null)}
                contextStatus={emptyStatus(workId)}
              />
            </div>
          );
        })}
      </div>
      <JumpToLatest
        visible={showReturnToBottom || Boolean(history?.date || history?.hasNewer) || unseenLiveCount > 0 || arrivedWhileReading > 0}
        className={styles.jumpToLatest}
        label={(history?.date || history?.hasNewer ? unseenLiveCount : arrivedWhileReading) > 0
          ? `${history?.date || history?.hasNewer ? unseenLiveCount : arrivedWhileReading} 条新消息`
          : history?.date || history?.hasNewer ? "回到最新" : "回到底部"}
        onClick={() => {
          setArrivedWhileReading(0);
          void onReturnToLatest().then((moved) => { if (!moved) returnToBottom(); });
        }}
      />
    </div>
  );
}
