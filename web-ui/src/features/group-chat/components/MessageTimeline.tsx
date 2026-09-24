import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { JumpToLatest } from "../../../components/JumpToLatest/JumpToLatest";
import { useReturnToBottom } from "../../../components/JumpToLatest/useReturnToBottom";
import { AttachmentDisplay } from "../../attachments/components/AttachmentDisplay";
import { ArtifactCollection } from "../../artifacts/components/ArtifactCollection";
import type { Artifact, ArtifactReviewDecision } from "../../artifacts/model/types";
import { MarkdownContent } from "../../conversations/rendering/ContentRenderer";
import { splitMentions } from "../model/agentMentions";
import type { GroupAgent, GroupMember, GroupMessage, GroupMessageHistory, GroupProfile, GroupStreamingMessage } from "../model/types";
import { formatClockTime, formatDayLabel, localDateKey } from "../../../shared/format/dateTime";
import styles from "./MessageTimeline.module.css";


function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  if (!text.trim()) return null;
  return (
    <button
      className={styles.copyButton}
      type="button"
      aria-label={copied ? "已复制" : "复制内容"}
      title={copied ? "已复制" : "复制内容"}
      onClick={() => {
        const finish = (ok: boolean) => {
          setCopied(ok);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1600);
        };
        const write = navigator.clipboard?.writeText(text);
        if (write) {
          void write.then(() => finish(true)).catch(() => finish(false));
          return;
        }
        finish(false);
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}
function agentPresence(agent: GroupAgent) {
  if (agent.active && agent.phase === "queued") return { tone: "queued", label: agent.label || "等候" };
  if (agent.active) return { tone: "working", label: agent.label || "工作中" };
  return { tone: "idle", label: "空闲" };
}

function QuoteMessageButton({ message, onQuote }: { message: GroupMessage; onQuote?: (message: GroupMessage) => void }) {
  const quotable = Boolean(message.text.trim() || (message.attachments || []).some((file) => file.name));
  if (!onQuote || message.pending || message.id.startsWith("optimistic-") || !quotable) return null;
  return (
    <button className={styles.quoteButton} type="button" aria-label="引用这条消息" title="引用" onClick={() => onQuote(message)}>
      引用
    </button>
  );
}
export function MessageTimeline({
  active,
  roomId,
  messages,
  agents,
  members,
  currentMemberId,
  streaming,
  artifacts,
  artifactLoadErrors,
  reviewingArtifactIds,
  reviewerName,
  onRetryArtifact,
  onReviewArtifact,
  onOpenProfile,
  localSendVersion,
  history,
  historyLoading,
  historyNavigation,
  focusRequest = null,
  onLoadOlder,
  onLoadNewer,
  onReturnToLatest,
  onQuote,
  onMentionAgent,
  onRevealReply,
  onRetryAgent,
  onRetrySend,
  unseenLiveCount = 0,
  retryDisabled = false,
}: {
  active: boolean;
  roomId: string;
  messages: GroupMessage[];
  agents: GroupAgent[];
  members: GroupMember[];
  currentMemberId: string;
  streaming: Record<string, GroupStreamingMessage>;
  artifacts: Record<string, Artifact>;
  artifactLoadErrors: Record<string, boolean>;
  reviewingArtifactIds: Set<string>;
  reviewerName: string;
  onRetryArtifact: (artifactId: string) => Promise<void>;
  onReviewArtifact: (artifactId: string, decision: ArtifactReviewDecision, note: string, reviewedBy: string) => Promise<void>;
  onOpenProfile: (profile: GroupProfile) => void;
  localSendVersion: number;
  history?: GroupMessageHistory;
  historyLoading: boolean;
  historyNavigation: { version: number; align: "top" | "bottom" };
  focusRequest?: { id: string; nonce: number } | null;
  onLoadOlder: () => Promise<boolean>;
  onLoadNewer: () => Promise<boolean>;
  onReturnToLatest: () => Promise<boolean>;
  onQuote?: (message: GroupMessage) => void;
  onMentionAgent?: (agent: GroupAgent) => void;
  onRevealReply?: (reply: NonNullable<GroupMessage["replyTo"]>) => void;
  onRetryAgent?: (agentId: string, replyTo?: GroupMessage["replyTo"]) => void;
  onRetrySend?: (message: GroupMessage) => void;
  unseenLiveCount?: number;
  retryDisabled?: boolean;
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
      {agents.length ? (
        <div className={styles.roster} aria-label="群里的员工">
          {agents.map((agent) => {
            const presence = agentPresence(agent);
            return (
              <button
                key={agent.id}
                className={styles.rosterItem}
                type="button"
                title={agent.responsibility}
                aria-label={`点名${agent.name}，${agent.responsibility}，当前${presence.label}`}
                onClick={() => onMentionAgent?.(agent)}
              >
                <i className={`${styles.rosterDot} ${presence.tone === "working" ? styles.rosterDotWorking : ""} ${presence.tone === "queued" ? styles.rosterDotQueued : ""}`} />
                <strong>{agent.name}</strong>
                <span>{presence.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className={styles.timeline} ref={scrollRef} onScroll={(event) => onTimelineScroll(event.currentTarget)}>
        {history?.hasOlder ? <div className={styles.historyMarker}>继续向上加载更早消息</div> : null}
        {!messages.length && !streams.length ? (
          <div className={styles.emptyRoom}><Bot /><strong>这个群还没有消息</strong><p>直接发言只会留在群里。点上方员工，或用 @ 点名，对方才会回答。</p></div>
        ) : null}
        {messages.map((message, index) => {
          const agent = message.type === "agent"
            ? agents.find((item) => item.id === message.agentId || item.id === message.authorId)
            : null;
          const member = message.type === "human"
            ? members.find((item) => item.id === message.authorId)
              || { id: message.authorId, name: message.authorName, lastSeenAt: message.createdAt }
            : null;
          const profile: GroupProfile | null = agent
            ? { kind: "agent", profile: agent }
            : member ? { kind: "member", profile: member } : null;
          const liveStream = message.workId ? streaming[message.workId] : undefined;
          const pendingAgent = message.type === "agent" && message.pending;
          const authorName = agent?.name || message.authorName;
          const ownMessage = message.type === "human" && Boolean(currentMemberId) && message.authorId === currentMemberId;
          const askedNames = (message.targetAgentIds || []).map((id) => agents.find((item) => item.id === id)?.name || "").filter(Boolean);
          const statusText = message.type === "human" && message.pending
            ? "发送中"
            : message.type === "human" && message.failure
              ? "发送失败"
            : pendingAgent
              ? (agent?.active && agent.label ? agent.label : "正在回复")
              : formatClockTime(message.createdAt);
          return (
          <Fragment key={message.id}>
            {index === 0 || localDateKey(messages[index - 1].createdAt) !== localDateKey(message.createdAt)
              ? <div className={styles.dateDivider}><span>{formatDayLabel(message.createdAt)}</span></div>
              : null}
            <article
              className={`${styles.message} ${message.type === "system" ? styles.systemMessage : ""} ${highlightedId === message.id ? styles.messageFocused : ""}`}
              data-message-id={message.id}
            >
              {profile ? (
                <button
                  className={`${styles.messageAvatar} ${message.type === "agent" ? styles.agentMessageAvatar : ""}`}
                  type="button"
                  aria-label={`查看${profile.profile.name}的个人信息`}
                  onClick={() => onOpenProfile(profile)}
                >
                  {message.type === "agent" ? "AI" : authorName.slice(0, 1)}
                </button>
              ) : <span className={`${styles.messageAvatar} ${message.type === "agent" ? styles.agentMessageAvatar : ""}`}>{message.type === "agent" ? "AI" : message.type === "system" ? "!" : authorName.slice(0, 1)}</span>}
              <div className={styles.messageContent}>
                <div className={styles.messageMeta}><strong>{authorName}</strong><span>{statusText}</span><CopyMessageButton text={message.text} /><QuoteMessageButton message={message} onQuote={onQuote} /></div>
                <div className={`${styles.messageBubble} ${ownMessage ? styles.ownMessageBubble : ""}`}>
                  {message.replyTo ? (
                    <button className={styles.replyLine} type="button" onClick={() => message.replyTo && onRevealReply?.(message.replyTo)}>
                      {message.type === "system" && message.failure ? "未完成的任务" : "回复"} {message.replyTo.authorName}：{message.replyTo.text}
                    </button>
                  ) : null}
                  {message.type === "human" && askedNames.length ? <p className={styles.askedLine}>{askedNames.length > 1 ? `按顺序点名了 ${askedNames.join("、")}` : `点名了 ${askedNames[0]}`}</p> : null}
                  {message.type === "agent"
                    ? pendingAgent
                      ? <p className={styles.streamingText}>{liveStream?.text || message.text}<i className={styles.cursor} /></p>
                      : <MarkdownContent text={message.text} className={styles.markdown} />
                    : message.text ? <p>{splitMentions(message.text, agents).map((part, partIndex) => part.mention ? <mark key={partIndex} className={styles.mention}>{part.text}</mark> : <Fragment key={partIndex}>{part.text}</Fragment>)}</p> : null}
                  {message.type === "system" && message.failure && message.agentId && onRetryAgent ? (
                    <button className={styles.retryButton} type="button" disabled={retryDisabled} onClick={() => message.agentId && onRetryAgent(message.agentId, message.replyTo)}>
                      再让{agents.find((item) => item.id === message.agentId)?.name || "该员工"}试一次
                    </button>
                  ) : null}
                  <AttachmentDisplay files={message.attachments || []} />
                  {message.type === "human" && message.failure && onRetrySend ? (
                    <button className={styles.retryButton} type="button" disabled={retryDisabled} onClick={() => onRetrySend(message)}>
                      重新发送
                    </button>
                  ) : null}
                  <ArtifactCollection
                    artifactIds={message.artifactIds || []}
                    artifacts={artifacts}
                    loadErrors={artifactLoadErrors}
                    reviewingIds={reviewingArtifactIds}
                    reviewerName={reviewerName}
                    onRetry={onRetryArtifact}
                    onReview={onReviewArtifact}
                  />
                </div>
              </div>
            </article>
          </Fragment>
          );
        })}
        {(history?.date || history?.hasNewer) ? null : orphanStreams.map(([workId, value]) => {
          const agent = agents.find((item) => item.id === value.agentId);
          return (
            <article className={styles.message} key={workId}>
              {agent ? (
                <button className={`${styles.messageAvatar} ${styles.agentMessageAvatar}`} type="button" aria-label={`查看${agent.name}的个人信息`} onClick={() => onOpenProfile({ kind: "agent", profile: agent })}>AI</button>
              ) : <span className={`${styles.messageAvatar} ${styles.agentMessageAvatar}`}>AI</span>}
              <div className={styles.messageContent}>
                <div className={styles.messageMeta}><strong>{agent?.name || "Codex Agent"}</strong><span>...</span></div>
                <div className={styles.messageBubble}>
                  <p className={styles.streamingText}>{value.text}<i className={styles.cursor} /></p>
                </div>
              </div>
            </article>
          );
        })}
        {!history?.hasNewer && agents.some((agent) => agent.active && agent.phase === "queued") ? (
          <p className={styles.liveStatus}>
            {agents.filter((agent) => agent.active && agent.phase === "queued").map((agent) => `${agent.name} ${agent.label || "等候"}`).join("，")}
          </p>
        ) : null}
        {history?.hasNewer ? <div className={styles.historyMarker}>继续向下加载更新消息</div> : null}
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
