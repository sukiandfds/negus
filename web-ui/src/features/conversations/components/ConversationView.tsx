import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarClock, Clock3, LoaderCircle } from "lucide-react";
import { JumpToLatest } from "../../../components/JumpToLatest/JumpToLatest";
import { useReturnToBottom } from "../../../components/JumpToLatest/useReturnToBottom";
import { RefreshNotice } from "../../app-update/components/AppUpdateNotice";
import type { ContentSyncState, SessionDetail, SessionMessage } from "../model/types";
import { MessageActions } from "./MessageActions";
import { CollapsedMarkdown, ContentRenderer } from "../rendering/ContentRenderer";
import { presentConversationMessage } from "../rendering/heartbeatMessage";
import { ExecutionTimeline } from "../../execution/components/ExecutionTimeline";
import type { ExecutionStatus } from "../../execution/model/types";
import type { ContextStatus } from "../../context-management/model/types";
import { formatConversationTimestamp } from "../../../shared/format/dateTime";
import { advanceLiveTranscript, createLiveTranscriptMemory } from "../state/liveTranscript";
import styles from "./ConversationView.module.css";

const messageListKey = (message: SessionMessage) => (
  message.role === "user" && message.submissionId
    ? `submission:${message.submissionId}`
    : message.itemId || message.id
);

function Message({
  message,
  streaming = false,
  forkable = false,
  forkDisabled = false,
  forking = false,
  onFork,
  editable = false,
  editing = false,
  onEdit,
  retryable = false,
  retrying = false,
  onRetry,
  shareable = false,
  threadId = "",
  executionStatus,
  contextStatus,
  executionPlaceholder = false,
  showPriorReply = false,
}: {
  message: SessionMessage;
  streaming?: boolean;
  forkable?: boolean;
  forkDisabled?: boolean;
  forking?: boolean;
  onFork: () => Promise<boolean>;
  editable?: boolean;
  editing?: boolean;
  onEdit: () => void;
  retryable?: boolean;
  retrying?: boolean;
  onRetry?: () => Promise<boolean>;
  shareable?: boolean;
  threadId?: string;
  executionStatus?: ExecutionStatus;
  contextStatus?: ContextStatus;
  executionPlaceholder?: boolean;
  showPriorReply?: boolean;
}) {
  const presentation = presentConversationMessage(message);
  const shown = presentation.message;
  const heartbeatUser = presentation.user;
  const assistantText = presentation.assistantText;
  const copyText = heartbeatUser?.instructions ?? assistantText ?? message.text;
  const richBlocks = message.blocks?.some((block) => block.type !== "markdown") ?? false;
  const formattedTime = formatConversationTimestamp(message.createdAt);
  const reserveTimestamp = message.role === "assistant";
  if (assistantText === "" && !streaming && !executionStatus && !executionPlaceholder && !richBlocks) return null;
  return (
    <article className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`}>
      {message.authorName ? <span className={styles.authorName}>{message.authorName}</span> : null}
      {!executionPlaceholder && (formattedTime || reserveTimestamp) ? (
        <time className={styles.timestamp} dateTime={message.createdAt} aria-hidden={!formattedTime}>
          {formattedTime || "\u00a0"}
        </time>
      ) : null}
      {heartbeatUser ? (
        <div className={styles.heartbeatLabel}>
          <CalendarClock aria-hidden="true" />
          <span>由已安排任务发送</span>
        </div>
      ) : null}
      {!executionPlaceholder ? <div className={styles.body}>
        {message.turnStatus === "interrupted" ? <small>已中断</small> : null}
        {streaming ? <div className={styles.streamingText}>{assistantText ?? message.text}<i className={styles.cursor} /></div> : heartbeatUser ? <CollapsedMarkdown text={heartbeatUser.instructions} /> : <>{showPriorReply ? <div className={styles.priorReply}>追加指令前的回复</div> : null}<ContentRenderer message={shown} /></>}
        {message.deliveryState === "pending" ? (
          <span className={styles.deliveryState} title="正在确认指令是否已送达" aria-label="正在确认指令是否已送达">
            <Clock3 aria-hidden="true" />
          </span>
        ) : null}
      </div> : null}
      {!executionPlaceholder && !streaming ? (
        <div className={styles.actionRow}>
          {!streaming ? <MessageActions
            text={copyText}
            forkable={forkable}
            forkDisabled={forkDisabled}
            forking={forking}
            onFork={onFork}
            editable={editable}
            editing={editing}
            onEdit={onEdit}
            retryable={retryable}
            retrying={retrying}
            onRetry={onRetry}
            shareable={shareable}
            threadId={threadId}
            messageId={message.id}
          /> : null}
        </div>
      ) : null}
      {executionStatus && contextStatus ? (
        <ExecutionTimeline status={executionStatus} contextStatus={contextStatus} />
      ) : null}
    </article>
  );
}

interface ConversationViewProps {
  active?: boolean;
  session: SessionDetail | null;
  loading: boolean;
  contentSyncState: ContentSyncState;
  loadingOlder: boolean;
  error: string;
  listAvailable: boolean;
  streamingText: string;
  executionStatus: ExecutionStatus;
  contextStatus: ContextStatus;
  onLoadOlder: () => Promise<void>;
  onForkMessage: (message: SessionMessage) => Promise<boolean>;
  forkingMessageId: string;
  onEditMessage: (message: SessionMessage) => void;
  editingMessageId: string;
  onRetryMessage: (message: SessionMessage) => Promise<boolean>;
  retryingMessageId: string;
  localSendVersion: number;
}

type ConversationItem = {
  id: string;
  message: SessionMessage;
  streaming: boolean;
  execution: boolean;
  executionPlaceholder?: boolean;
  local?: boolean;
};

const CLOSE_ORDER_WINDOW_MS = 10 * 60 * 1000;

const messageTime = (message: SessionMessage) => {
  const value = Date.parse(message.createdAt || "");
  return Number.isFinite(value) ? value : null;
};

const visibleText = (message: SessionMessage) => message.text.replace(/\s+/gu, " ").trim();

const staysAtEnd = (item: ConversationItem) => (
  item.streaming || item.executionPlaceholder || item.message.id.startsWith("optimistic-")
);

const shouldMoveAhead = (previous: ConversationItem, current: ConversationItem) => {
  if (staysAtEnd(previous) || staysAtEnd(current)) return false;
  const sameTurn = Boolean(current.message.turnId) && current.message.turnId === previous.message.turnId;
  if (sameTurn && previous.message.role === "user" && current.message.role === "assistant") return false;
  if (sameTurn && current.message.role === "user" && previous.message.role === "assistant") {
    const userTime = messageTime(current.message);
    const assistantTime = messageTime(previous.message);
    if (userTime === null || assistantTime === null || userTime <= assistantTime) return true;
  }
  const previousTime = messageTime(previous.message);
  const currentTime = messageTime(current.message);
  return previousTime !== null
    && currentTime !== null
    && previousTime > currentTime
    && previousTime - currentTime <= CLOSE_ORDER_WINDOW_MS;
};

const orderVisibleItems = (items: ConversationItem[]) => {
  const ordered = items.filter((item, index) => !(
    item.local
    && visibleText(item.message)
    && items.slice(0, index).some((current) => (
      current.message.role === item.message.role && visibleText(current.message) === visibleText(item.message)
    ))
  ));
  let moved = true;
  while (moved) {
    moved = false;
    for (let index = 1; index < ordered.length; index += 1) {
      if (!shouldMoveAhead(ordered[index - 1], ordered[index])) continue;
      const [current] = ordered.splice(index, 1);
      ordered.splice(index - 1, 0, current);
      moved = true;
    }
  }
  return ordered;
};

export function ConversationView({
  active = true,
  session,
  loading,
  contentSyncState,
  loadingOlder,
  error,
  listAvailable,
  streamingText,
  executionStatus,
  contextStatus,
  onLoadOlder,
  onForkMessage,
  forkingMessageId,
  onEditMessage,
  editingMessageId,
  onRetryMessage,
  retryingMessageId,
  localSendVersion,
  }: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingOlderThreadsRef = useRef(new Set<string>());
  const olderLoadTimersRef = useRef(new Map<string, number>());
  const positionedThreadIdRef = useRef("");
  const visibleCountRef = useRef(0);
  const followLatestFrameRef = useRef(0);
  const transcriptMemoryRef = useRef(createLiveTranscriptMemory());
  const messages = session?.messages || [];
  const currentSessionRef = useRef(session);
  currentSessionRef.current = session;
  const contentSyncStateRef = useRef(contentSyncState);
  contentSyncStateRef.current = contentSyncState;
  const onLoadOlderRef = useRef(onLoadOlder);
  onLoadOlderRef.current = onLoadOlder;
  const locationParams = new URLSearchParams(window.location.search);
  const agentScoped = Boolean(locationParams.get("agent"));
  const employeeScoped = Boolean(locationParams.get("employee"));
  const executionMatchesSession = executionStatus.threadId === session?.threadId;
  const completedExecution = ["completed", "failed", "interrupted", "systemError"].includes(executionStatus.phase);
  const showExecution = executionMatchesSession
    && Boolean(executionStatus.startedAt)
    && executionStatus.phase !== "idle";
  const transcript = advanceLiveTranscript(transcriptMemoryRef.current, {
    threadId: session?.threadId || "",
    messages,
    streamingText: executionMatchesSession ? streamingText : "",
    streamingItemId: executionMatchesSession ? executionStatus.streamingItemId || "" : "",
    turnId: executionMatchesSession ? executionStatus.turnId || "" : "",
    active: showExecution && executionStatus.active && !completedExecution,
    showExecution,
    now: new Date().toISOString(),
  });
  const isAnswerStreaming = transcript.answerStreaming;
  const executionOn = (message: SessionMessage) => showExecution && message.id === transcript.executionMessageId;
  const visibleItems = orderVisibleItems([
    ...transcript.persisted.map((message) => ({
      id: `message:${messageListKey(message)}`,
      message,
      streaming: message.id === transcript.streamingMessageId,
      execution: executionOn(message),
    })),
    ...transcript.preceding.map((message) => ({
      id: `segment:${message.id}`,
      message,
      streaming: false,
      execution: executionOn(message),
      local: true,
    })),
    ...transcript.optimistic.map((message) => ({
      id: `message:${messageListKey(message)}`,
      message,
      streaming: false,
      execution: false,
    })),
    ...(transcript.live ? [{
      id: `segment:${transcript.live.message.id}`,
      message: transcript.live.message,
      streaming: transcript.live.streaming,
      execution: executionOn(transcript.live.message),
      local: true,
    }] : []),
    ...(transcript.placeholder ? [{
      id: "message:execution-placeholder",
      message: transcript.placeholder,
      streaming: false,
      execution: true,
      executionPlaceholder: true,
      local: true,
    }] : []),
  ]);
  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => visibleItems[index]?.message.role === "user" ? 84 : 160,
    overscan: 6,
    getItemKey: (index) => visibleItems[index]?.id || index,
    anchorTo: "end",
    scrollEndThreshold: 120,
  });
  const pinToEnd = () => {
    const root = scrollRef.current;
    if (!active || !root || root.clientHeight <= 0) return false;
    (virtualizer as unknown as { scrollState: unknown }).scrollState = null;
    root.scrollTop = root.scrollHeight;
    return root.scrollTop > 0 || root.scrollHeight <= root.clientHeight + 1;
  };
  const pinToEndRef = useRef(pinToEnd);
  pinToEndRef.current = pinToEnd;
  const scheduleFollowLatest = useCallback(() => {
    window.cancelAnimationFrame(followLatestFrameRef.current);
    followLatestFrameRef.current = window.requestAnimationFrame(() => pinToEndRef.current());
  }, []);

  const getScrollElement = useCallback(() => scrollRef.current, []);
  const getTrailingContentHeight = useCallback(() => 0, []);
  const {
    visible: showReturnToBottom,
    stickToBottomRef,
    onScroll: updateReturnToBottom,
    returnToBottom,
    reset: resetReturnToBottom,
  } = useReturnToBottom({
    active,
    isStreaming: isAnswerStreaming,
    localSendVersion,
    getScrollElement,
    getTrailingContentHeight,
    scrollToBottom: scheduleFollowLatest,
  });

  useLayoutEffect(() => {
    if (!active) {
      window.cancelAnimationFrame(followLatestFrameRef.current);
    }
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return;
    const threadId = session?.threadId || "";
    if (!threadId || loading || !scrollRef.current) {
      if (!threadId) positionedThreadIdRef.current = "";
      return;
    }
    if (positionedThreadIdRef.current === threadId) return;
    window.cancelAnimationFrame(followLatestFrameRef.current);
    resetReturnToBottom(true);
    if (pinToEndRef.current()) positionedThreadIdRef.current = threadId;
  }, [active, loading, resetReturnToBottom, session?.threadId]);

  useLayoutEffect(() => {
    const previousCount = visibleCountRef.current;
    const nextCount = visibleItems.length;
    visibleCountRef.current = nextCount;
    if (!active || positionedThreadIdRef.current !== (session?.threadId || "")) return;
    if (nextCount > previousCount && stickToBottomRef.current) pinToEndRef.current();
  }, [active, session?.threadId, visibleItems.length]);

  useEffect(() => {
    if (!active) return undefined;
    const root = scrollRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    let previousHeight = root.clientHeight;
    let previousViewportHeight = Math.round(window.visualViewport?.height || window.innerHeight);
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const nextHeight = root.clientHeight;
      const nextViewportHeight = Math.round(window.visualViewport?.height || window.innerHeight);
      const viewportChanged = nextViewportHeight !== previousViewportHeight;
      previousViewportHeight = nextViewportHeight;
      if (nextHeight === previousHeight) return;
      previousHeight = nextHeight;
      if (!viewportChanged) return;
      if (!stickToBottomRef.current) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(scheduleFollowLatest);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [active, scheduleFollowLatest]);

  useEffect(() => {
    if (!active) return undefined;
    const root = scrollRef.current;
    if (!root) return;
    let disposed = false;
    const onScroll = () => {
      const currentSession = currentSessionRef.current;
      const threadId = currentSession?.threadId || "";
      updateReturnToBottom(root);
      const pendingTimer = threadId ? olderLoadTimersRef.current.get(threadId) : undefined;
      if (pendingTimer !== undefined && root.scrollTop > 140) {
        window.clearTimeout(pendingTimer);
        olderLoadTimersRef.current.delete(threadId);
        loadingOlderThreadsRef.current.delete(threadId);
        return;
      }
      if (threadId && loadingOlderThreadsRef.current.has(threadId)) {
        return;
      }
      if (
        !threadId
        || root.scrollTop > 140
        || !currentSession?.hasMore
        || contentSyncStateRef.current === "recovering"
      ) return;
      loadingOlderThreadsRef.current.add(threadId);
      const timer = window.setTimeout(() => {
        olderLoadTimersRef.current.delete(threadId);
        const latestSession = currentSessionRef.current;
        if (disposed || !active || latestSession?.threadId !== threadId || root.scrollTop > 140 || !latestSession?.hasMore) {
          loadingOlderThreadsRef.current.delete(threadId);
          return;
        }
        void onLoadOlderRef.current().finally(() => {
          loadingOlderThreadsRef.current.delete(threadId);
        });
      }, 140);
      olderLoadTimersRef.current.set(threadId, timer);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      disposed = true;
      root.removeEventListener("scroll", onScroll);
      const threadId = session?.threadId || "";
      const pending = threadId ? olderLoadTimersRef.current.get(threadId) : undefined;
      if (pending !== undefined) {
        window.clearTimeout(pending);
        olderLoadTimersRef.current.delete(threadId);
        loadingOlderThreadsRef.current.delete(threadId);
      }
    };
  }, [active, updateReturnToBottom]);

  return (
    <div className={styles.viewport}>
      {error ? (
        <RefreshNotice
          surface="conversation"
          title="内容暂时未更新"
          detail="连接长时间没有响应，请刷新网页后重试。"
          actionLabel="刷新网页"
          onAction={() => window.location.reload()}
        />
      ) : null}
      <div className={styles.scrollArea} ref={scrollRef}>
        <section className={styles.conversation} aria-label="真实项目对话" aria-live="off">
        {loading && !session ? <div className={styles.loading} role="status" aria-label="正在读取对话"><LoaderCircle aria-hidden="true" /></div> : null}
        {!loading && !error && !session && listAvailable ? <div className={styles.state}>当前项目暂无可显示对话</div> : null}
        {session ? (
          <div className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = visibleItems[virtualRow.index];
              return (
                <div
                  className={styles.virtualRow}
                  data-index={virtualRow.index}
                    data-message-id={item.message.id}
                  key={virtualRow.key}
                  ref={(element) => {
                    virtualizer.measureElement(element);
                  }}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <Message
                        message={item.message}
                        streaming={item.streaming}
                        forkable={item.message.role === "assistant"
                          && !item.local
                          && Boolean(item.message.turnId)
                          && !session?.archived}
                        forkDisabled={executionStatus.active}
                        forking={forkingMessageId === item.message.id}
                        onFork={() => onForkMessage(item.message)}
                        editable={item.message.role === "user"
                          && Boolean(item.message.turnId)
                          && !session?.archived}
                        editing={editingMessageId === item.message.id}
                        onEdit={() => onEditMessage(item.message)}
                        retryable={item.message.deliveryState === "pending"}
                        retrying={retryingMessageId === item.message.id}
                        onRetry={() => onRetryMessage(item.message)}
                        shareable={agentScoped
                          && !employeeScoped
                          && item.message.role === "assistant"
                          && Boolean(item.message.text?.trim())
                          && Boolean(item.message.turnId)
                          && !item.streaming
                          && !(executionStatus.active && executionStatus.turnId === item.message.turnId)
                          && !session?.archived}
                        threadId={session.threadId}
                        executionStatus={item.execution ? executionStatus : undefined}
                        contextStatus={item.execution ? contextStatus : undefined}
                        executionPlaceholder={item.executionPlaceholder}
                        showPriorReply={Boolean(item.message.superseded) && !visibleItems[virtualRow.index - 1]?.message.superseded}
                      />
                </div>
              );
            })}
          </div>
        ) : null}
        </section>
      </div>
      {loadingOlder ? <div className={styles.older} role="status" aria-label="正在加载更早消息"><LoaderCircle aria-hidden="true" /></div> : null}
      <JumpToLatest visible={showReturnToBottom} className={styles.jumpToLatest} onClick={returnToBottom} />
    </div>
  );
}
