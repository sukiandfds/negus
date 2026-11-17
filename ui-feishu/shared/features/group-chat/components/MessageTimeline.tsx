import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { JumpToLatest } from "../../../components/JumpToLatest/JumpToLatest";
import { useReturnToBottom } from "../../../components/JumpToLatest/useReturnToBottom";
import { emptyStatus } from "../../context-management/hooks/useContextManagement";
import { Message } from "../../conversations/components/ConversationView";
import type { ContentBlock, SessionMessage } from "../../conversations/model/types";
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

const attachmentBlocks = (message: GroupMessage): ContentBlock[] => (message.attachments || []).map((file) => {
  const type = file.mimeType.startsWith("image/") ? "image"
    : file.mimeType.startsWith("audio/") ? "audio"
      : file.mimeType.startsWith("video/") ? "video"
        : "file";
  return type === "file"
    ? { id: file.id, type, source: file.url, name: file.name, file }
    : { id: file.id, type, source: file.url, file };
});

const sessionMessage = (message: GroupMessage, currentMemberId: string): SessionMessage => ({
  id: message.id,
  role: message.type === "human" && message.authorId === currentMemberId ? "user" : "assistant",
  authorId: message.authorId,
  authorName: message.authorName,
  text: message.text,
  blocks: [
    ...(message.text ? [{ id: `${message.id}-text`, type: "markdown" as const, text: message.text }] : []),
    ...attachmentBlocks(message),
  ],
  createdAt: message.createdAt,
  sequence: message.sequence,
  deliveryState: message.type === "human" && message.pending ? "sending" : message.type === "human" && message.failure ? "failed" : undefined,
  deliveryError: message.failure ? "发送失败" : undefined,
});

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
          const pendingAgent = message.type === "agent" && message.pending;
          const executionId = message.workId || message.id;
          return (
            <div
              key={message.id}
              data-message-id={message.id}
              data-focused={highlightedId === message.id ? "" : undefined}
              style={{ "--agent-color": avatarColor(message.agentId || message.authorId) } as CSSProperties}
            >
              <Message
                message={sessionMessage(message, currentMemberId)}
                executionPlaceholder={Boolean(pendingAgent)}
                executionStatus={pendingAgent ? groupExecution(executionId, "正在回复", liveStream?.text || message.text, message.createdAt) : undefined}
                contextStatus={pendingAgent ? emptyStatus(executionId) : undefined}
                onQuote={onQuote && !message.pending && !message.id.startsWith("optimistic-") && (message.text.trim() || message.attachments?.length) ? () => onQuote(message) : undefined}
                onFork={async () => false}
                onEdit={() => {}}
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
                onFork={async () => false}
                onEdit={() => {}}
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
