import { executionHandoff } from "../state/executionHandoff";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarClock, Clock3, LoaderCircle, Target } from "lucide-react";
import { JumpToLatest } from "../../../components/JumpToLatest/JumpToLatest";
import type { ContentSyncState, SessionDetail, SessionMessage } from "../model/types";
import { MessageActions } from "./MessageActions";
import { CollapsedMarkdown, ContentRenderer } from "../rendering/ContentRenderer";
import { presentConversationMessage } from "../rendering/heartbeatMessage";
import { ExecutionTimeline } from "../../execution/components/ExecutionTimeline";
import type { ExecutionStatus } from "../../execution/model/types";
import type { ContextStatus } from "../../context-management/model/types";
import { formatConversationTimestamp } from "../../../shared/format/dateTime";
import { advanceLiveTranscript, createLiveTranscriptMemory } from "../state/liveTranscript";
import { orderMessageList } from "../state/conversationMerge";
import styles from "./ConversationView.module.css";
import type { ThreadGoal } from "../../goals/model/types";
import { completedGoalMessageId } from "../../goals/model/completedGoal";

const messageListKey = (message: SessionMessage) => (
  message.role === "user" && message.submissionId
    ? `submission:${message.submissionId}`
    : message.itemId || message.id
);

export function Message({
  message,
  onQuote,
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
  completedGoal,
  queued = false,
  actions,
}: {
  message: SessionMessage;
  onQuote?: () => void;
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
  completedGoal?: ThreadGoal | null;
  queued?: boolean;
  actions?: ReactNode;
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
      {formattedTime || reserveTimestamp ? (
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
        {queued || message.deliveryState === "pending" ? <Clock3 className={styles.waiting} role="status" aria-label={queued ? "等待助手完成后发送" : "正在确认指令是否已送达"} /> : null}
        {message.deliveryState === "sending" ? <LoaderCircle className={styles.sending} role="status" aria-label="发送中" /> : null}
        {message.role === "assistant" && message.turnStatus === "interrupted" ? <small>已中断</small> : null}
        {streaming ? <><ContentRenderer message={shown} threadId={threadId} /><i className={styles.cursor} /></> : heartbeatUser ? <CollapsedMarkdown text={heartbeatUser.instructions} /> : <>{showPriorReply ? <div className={styles.priorReply}>追加指令前的回复</div> : null}<ContentRenderer message={shown} threadId={threadId} /></>}
        {message.deliveryState === "occupied" ? <small>Codex 占用中，未发送</small> : message.deliveryState === "failed" ? <small>{message.deliveryError || "发送失败"}</small> : null}
      </div> : null}
      {!executionPlaceholder ? (
        <div className={styles.actionRow}>
          {actions ?? <MessageActions
            onQuote={onQuote}
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
          />}
          {completedGoal ? <span className={styles.goalAchieved} aria-label="目标达成结果"><Target aria-hidden="true" />已在 {Math.floor(completedGoal.timeUsedSeconds)} 秒内达成目标</span> : null}
        </div>
      ) : null}
      {executionPlaceholder && completedGoal ? <span className={styles.goalAchieved} aria-label="目标达成结果"><Target aria-hidden="true" />已在 {Math.floor(completedGoal.timeUsedSeconds)} 秒内达成目标</span> : null}
      {executionStatus && contextStatus ? (
        <ExecutionTimeline status={executionStatus} contextStatus={contextStatus} />
      ) : null}
    </article>
  );
}

interface ConversationViewProps {
  assistantName?: string;
  onQuoteMessage?: (message: SessionMessage) => void;
  queue?: ReactNode;
  completedGoal?: ThreadGoal | null;
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
}

type ConversationItem = {
  id: string;
  message: SessionMessage;
  streaming: boolean;
  execution: boolean;
  executionPlaceholder?: boolean;
  local?: boolean;
};

const visibleText = (message: SessionMessage) => message.text.replace(/\s+/gu, " ").trim();

const sameRenderedMessage = (left: SessionMessage, right: SessionMessage) => (
  left.role === right.role
  && Boolean(left.turnId && right.turnId && left.turnId === right.turnId)
  && (
    (Boolean(left.itemId && right.itemId) && left.itemId === right.itemId)
    || (Boolean(left.submissionId && right.submissionId) && left.submissionId === right.submissionId)
  )
);

const staysAtEnd = (item: ConversationItem) => (
  item.streaming || item.executionPlaceholder
);

const orderVisibleItems = (items: ConversationItem[]) => {
  const ordered = items.filter((item, index) => !(
    item.local
    && visibleText(item.message)
    && items.slice(0, index).some((current) => (
      sameRenderedMessage(current.message, item.message)
      && visibleText(current.message) === visibleText(item.message)
    ))
  ));
  const byMessage = new Map(ordered.map((item) => [item.message, item]));
  return [
    ...orderMessageList(ordered.filter((item) => !staysAtEnd(item)).map((item) => item.message))
      .map((message) => byMessage.get(message)!),
    ...ordered.filter(staysAtEnd),
  ];
};

export function ConversationView({
  assistantName,
  onQuoteMessage,
  queue,
  completedGoal,
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
  }: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followBottomRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const previousScrollSizeRef = useRef("");
  const openedThreadRef = useRef("");
  const [returnButtonThread, setReturnButtonThread] = useState("");
  const loadingOlderThreadsRef = useRef(new Set<string>());
  const olderLoadTimersRef = useRef(new Map<string, number>());
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
  const { showExecution, waitingForReply, latestReplyAt } = executionHandoff(session?.threadId || "", messages, executionStatus);
  const transcript = advanceLiveTranscript(transcriptMemoryRef.current, {
    threadId: session?.threadId || "",
    messages,
    streamingText: "",
    streamingItemId: "",
    turnId: executionMatchesSession ? executionStatus.turnId || "" : "",
    active: showExecution && executionStatus.active && !completedExecution,
    retainPlaceholder: waitingForReply,
    showExecution,
    now: new Date().toISOString(),
  });
  const executionOn = (message: SessionMessage) => showExecution && message.id === transcript.executionMessageId;
  const visibleItems = orderVisibleItems([
    ...transcript.persisted.map((message) => ({
      id: `message:${messageListKey(message)}`,
      message,
      streaming: message.id === transcript.streamingMessageId,
      execution: executionOn(message),
    })),
    ...transcript.preceding.map((message) => ({
      id: `segment:${message.itemId || message.id}:${message.createdAt}`,
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
      id: `segment:${transcript.live.message.itemId || transcript.live.message.id}:${transcript.live.message.createdAt}`,
      message: transcript.live.message,
      streaming: transcript.live.streaming,
      execution: executionOn(transcript.live.message),
      local: true,
    }] : []),
    ...(transcript.placeholder ? [{
      id: "message:execution-placeholder",
      message: { ...transcript.placeholder, authorName: assistantName, createdAt: latestReplyAt || executionStatus.startedAt || undefined },
      streaming: false,
      execution: true,
      executionPlaceholder: true,
      local: true,
    }] : []),
  ]);
  const goalMessageId = completedGoalMessageId(visibleItems.map(item => {
    const message = item.message;
    return message.turnId === executionStatus.turnId && executionStatus.phase === "completed"
      ? { ...message, turnStatus: "completed", turnStartedAtMs: message.turnStartedAtMs ?? Date.parse(executionStatus.startedAt || "") }
      : message;
  }), completedGoal);
  // 用户授权：打开定位底部，仅在底部时跟随内容更新，不补偿历史阅读位置；后续修改须获用户明确同意。
  useLayoutEffect(() => {
    if (!active) {
      openedThreadRef.current = "";
      return;
    }
    const threadId = session?.threadId;
    const root = scrollRef.current;
    if (!threadId || loading || !root || openedThreadRef.current === threadId) return;
    followBottomRef.current = true;
    root.scrollTop = root.scrollHeight;
    openedThreadRef.current = threadId;
    setReturnButtonThread("");
  }, [active, loading, session?.threadId]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const content = root?.firstElementChild;
    if (!active || !root || !content) return;
    const observer = new ResizeObserver(() => {
      if (followBottomRef.current) root.scrollTop = root.scrollHeight;
    });
    observer.observe(content);
    observer.observe(root);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const root = scrollRef.current;
    if (!root) return;
    let disposed = false;
    const onScroll = () => {
      const currentSession = currentSessionRef.current;
      const threadId = currentSession?.threadId || "";
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
  }, [active]);

  return (
    <div className={styles.viewport}>
      <div className={styles.scrollArea} ref={scrollRef} onScroll={(event) => {
        const root = event.currentTarget;
        const size = `${root.scrollHeight}:${root.clientHeight}`;
        if (root.scrollHeight - root.scrollTop - root.clientHeight <= 2) followBottomRef.current = true;
        else if (size === previousScrollSizeRef.current && root.scrollTop < previousScrollTopRef.current) followBottomRef.current = false;
        previousScrollTopRef.current = root.scrollTop;
        previousScrollSizeRef.current = size;
        setReturnButtonThread(root.scrollHeight - root.scrollTop - root.clientHeight > 120 ? session?.threadId || "" : "");
      }}>
        <section className={styles.conversation} aria-label="真实项目对话" aria-live="off">
        {error ? <div className={styles.state} role="alert">{error}</div> : null}
        {!loading && !error && !session && listAvailable ? <div className={styles.state}>当前项目暂无可显示对话</div> : null}
        {session ? (
          <>
            {visibleItems.map((item, index) => (
                <div data-message-id={item.message.id} key={item.id}>
                  <Message
                        message={item.message}
                        onQuote={!session.archived && onQuoteMessage ? () => onQuoteMessage(item.message) : undefined}
                        completedGoal={item.message.id === goalMessageId ? completedGoal : null}
                        streaming={item.streaming}
                        forkable={item.message.role === "assistant"
                          && !session?.archived}
                        forking={forkingMessageId === item.message.id}
                        onFork={() => onForkMessage(item.message)}
                        editable={item.message.role === "user"
                          && !session?.archived}
                        editing={editingMessageId === item.message.id}
                        onEdit={() => onEditMessage(item.message)}
                        retryable={item.message.deliveryState === "pending" || item.message.deliveryState === "failed"}
                        retrying={retryingMessageId === item.message.id}
                        onRetry={() => onRetryMessage(item.message)}
                        shareable={agentScoped
                          && !employeeScoped
                          && item.message.role === "assistant"
                          && !session?.archived}
                        threadId={session.threadId}
                        executionStatus={item.execution ? executionStatus : undefined}
                        contextStatus={item.execution ? contextStatus : undefined}
                        executionPlaceholder={item.executionPlaceholder}
                        showPriorReply={Boolean(item.message.superseded) && !visibleItems[index - 1]?.message.superseded}
                      />
                </div>
            ))}
            {queue}
          </>
        ) : null}
        {completedGoal && !executionStatus.active && !goalMessageId && !visibleItems.some(item => item.message.turnId) ? <div className={styles.actionRow}><span className={styles.goalAchieved} aria-label="目标达成结果"><Target aria-hidden="true" />已在 {Math.floor(completedGoal.timeUsedSeconds)} 秒内达成目标</span></div> : null}
        </section>
      </div>
      {loadingOlder ? <div className={styles.older} role="status" aria-label="正在加载更早消息"><LoaderCircle aria-hidden="true" /></div> : null}
      <JumpToLatest visible={Boolean(session?.threadId && returnButtonThread === session.threadId)} className={styles.jumpToLatest} onClick={() => {
        const root = scrollRef.current;
        followBottomRef.current = true;
        if (root) root.scrollTop = root.scrollHeight;
        setReturnButtonThread("");
      }} />
    </div>
  );
}
