import { useCallback, useEffect, useRef, useState } from "react";
import { createClientId } from "../../../shared/id/clientId";
import type { MediaFile } from "../../../shared/model/media";
import { createMemberId, readStoredMember, writeStoredMember } from "../data/groupMemberStorage";
import { groupApi } from "../data/groupApi";
import { upsertGroupMessage } from "../data/groupMessageState";
import { readGroupSnapshot, reconcileGroupSnapshot, writeGroupSnapshot } from "../data/groupSnapshot";
import { mentionedAgentIds } from "../model/agentMentions";
import type { GroupMessage, GroupMessagePage, GroupRoom, GroupSnapshot, StoredMember } from "../model/types";
import { useGroupEvents } from "../realtime/useGroupEvents";

const describeSendResult = (result: {
  execution: { queuedBehind?: number; agentNames?: string[]; agentIds?: string[] } | null;
  listening?: boolean;
}) => {
  const queuedBehind = Number(result.execution?.queuedBehind || 0);
  const names = Array.isArray(result.execution?.agentNames)
    ? result.execution.agentNames.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    : [];
  const agentIds = Array.isArray(result.execution?.agentIds)
    ? result.execution.agentIds.filter((id): id is string => typeof id === "string" && Boolean(id))
    : [];
  if (queuedBehind > 0) {
    const who = names.length ? names.join("、") : "被点名的员工";
    const wait = queuedBehind === 1
      ? "会等当前任务结束后继续。"
      : "前面还有 " + queuedBehind + " 个任务，会按顺序继续。";
    return { notice: who + "已记下这个请求，" + wait, agentIds };
  }
  return {
    notice: result.listening ? "已记在群里。没有点名员工，所以不会有人回复。" : "",
    agentIds: [] as string[],
  };
};

export function useGroupRoom() {
  const [initialSnapshot] = useState(() => readGroupSnapshot("current-project"));
  const [snapshot, setSnapshot] = useState<GroupSnapshot | null>(initialSnapshot);
  const [rooms, setRooms] = useState<GroupRoom[]>([]);
  const [roomId, setRoomId] = useState(initialSnapshot?.room.id || "current-project");
  const [member, setMember] = useState<StoredMember | null>(readStoredMember);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [initialSyncReady, setInitialSyncReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const [historyNavigation, setHistoryNavigation] = useState({ version: 0, align: "bottom" as "top" | "bottom" });
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sendingRef = useRef(false);
  const activeRoomIdRef = useRef(roomId);
  const sendGenerationRef = useRef(0);
  const roomGenerationRef = useRef(0);
  const refreshVersionRef = useRef(0);
  const historyRequestRef = useRef<AbortController | null>(null);
  const pendingMessagesRef = useRef(new Map<string, GroupMessage>());
  const snapshotRef = useRef(snapshot);
  const queuedAgentIdsRef = useRef<string[]>([]);
  const knownWorkIdsRef = useRef(new Set<string>());
  snapshotRef.current = snapshot;
  const historyLoadingRef = useRef(false);
  activeRoomIdRef.current = roomId;
  const reviewingHistory = Boolean(snapshot?.history?.date || snapshot?.history?.hasNewer);
  const realtime = useGroupEvents(setSnapshot, roomId, reviewingHistory);

  useEffect(() => {
    const controller = new AbortController();
    void groupApi.rooms(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setRooms(Array.isArray(response.rooms) ? response.rooms : []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = roomGenerationRef.current;
    const version = ++refreshVersionRef.current;
    const isCurrent = () => !signal?.aborted && generation === roomGenerationRef.current
      && roomId === activeRoomIdRef.current && version === refreshVersionRef.current;
    try {
      const next = await groupApi.snapshot(roomId, signal);
      if (!isCurrent()) return;
      setSnapshot((current) => isCurrent() ? reconcileGroupSnapshot(
        next,
        current,
        [...pendingMessagesRef.current.values()],
      ) : current);
      setError("");
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [roomId]);

  const applyHistoryPage = useCallback((page: GroupMessagePage, replace: boolean, generation: number) => {
    setSnapshot((current) => {
      if (!current || generation !== roomGenerationRef.current) return current;
      const messages = replace
        ? page.messages
        : page.messages.reduce((next, message) => upsertGroupMessage(next, message), current.messages);
      const { messages: _messages, ...history } = page;
      const previous = current.history;
      const oldestSequence = messages[0]?.sequence || history.oldestSequence;
      const newestSequence = messages.at(-1)?.sequence || history.newestSequence;
      return {
        ...current,
        messages,
        history: replace ? history : {
          ...history,
          oldestSequence,
          newestSequence,
          hasOlder: history.oldestSequence <= (previous?.oldestSequence || Number.MAX_SAFE_INTEGER)
            ? history.hasOlder
            : Boolean(previous?.hasOlder),
          hasNewer: history.newestSequence >= (previous?.newestSequence || 0)
            ? history.hasNewer
            : Boolean(previous?.hasNewer),
        },
      };
    });
  }, []);

  const loadHistory = useCallback(async (params: Record<string, string | number | undefined>, replace = false) => {
    if (historyLoadingRef.current) return false;
    const generation = roomGenerationRef.current;
    const controller = new AbortController();
    historyRequestRef.current = controller;
    const isCurrent = () => !controller.signal.aborted && generation === roomGenerationRef.current
      && roomId === activeRoomIdRef.current;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    setError("");
    try {
      const page = await groupApi.messages(roomId, params, controller.signal);
      if (!isCurrent()) return false;
      if (!page.found) {
        setHistoryNotice(params.around ? "没有找到被引用的原消息" : "当天无消息");
        return false;
      }
      applyHistoryPage(page, replace, generation);
      setHistoryNotice("");
      return page.messages.length > 0;
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      if (historyRequestRef.current === controller) {
        historyRequestRef.current = null;
        historyLoadingRef.current = false;
        setHistoryLoading(false);
      }
    }
  }, [applyHistoryPage, roomId]);

  const loadOlder = useCallback(() => loadHistory({ before: snapshot?.history?.oldestSequence || snapshot?.messages[0]?.sequence }, false), [loadHistory, snapshot?.history?.oldestSequence, snapshot?.messages]);
  const loadNewer = useCallback(() => loadHistory({ after: snapshot?.history?.newestSequence || snapshot?.messages.at(-1)?.sequence }, false), [loadHistory, snapshot?.history?.newestSequence, snapshot?.messages]);
  const jumpToDate = useCallback(async (date: string) => {
    const generation = roomGenerationRef.current;
    const moved = await loadHistory({ date }, true);
    if (moved && generation === roomGenerationRef.current) setHistoryNavigation((current) => ({ version: current.version + 1, align: "top" }));
    return moved;
  }, [loadHistory]);
  const revealMessage = useCallback(async (reply: { id: string; sequence?: number } | null | undefined) => {
    const id = String(reply?.id || "");
    if (!id) return false;
    const visible = snapshotRef.current?.messages.some((message) => message.id === id);
    if (!visible) {
      const sequence = Number(reply?.sequence);
      if (!Number.isSafeInteger(sequence) || sequence <= 0) {
        setHistoryNotice("原消息不在当前已加载的记录里");
        return false;
      }
      const moved = await loadHistory({ around: sequence }, true);
      if (!moved) return false;
    }
    setFocusRequest((current) => ({ id, nonce: (current?.nonce || 0) + 1 }));
    setHistoryNotice("");
    return true;
  }, [loadHistory]);
  const returnToLatest = useCallback(async () => {
    const generation = roomGenerationRef.current;
    const moved = await loadHistory({}, true);
    if (moved && generation === roomGenerationRef.current) setHistoryNavigation((current) => ({ version: current.version + 1, align: "bottom" }));
    return moved;
  }, [loadHistory]);

  const ensureLiveTail = useCallback(async () => {
    const history = snapshotRef.current?.history;
    if (!history?.date && !history?.hasNewer) return true;
    const generation = roomGenerationRef.current;
    const moved = await loadHistory({}, true);
    if (!moved || generation !== roomGenerationRef.current || activeRoomIdRef.current !== roomId) return false;
    setHistoryNavigation((current) => ({ version: current.version + 1, align: "bottom" }));
    return true;
  }, [loadHistory, roomId]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = roomGenerationRef.current;
    void refresh(controller.signal).finally(() => {
      if (!controller.signal.aborted && generation === roomGenerationRef.current) setInitialSyncReady(true);
    });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => () => {
    roomGenerationRef.current += 1;
    historyRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setTimeout(() => writeGroupSnapshot(snapshot), 250);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  const selectRoom = useCallback((nextRoomId: string) => {
    const next = String(nextRoomId || "").trim();
    if (!next || next === activeRoomIdRef.current) return;
    if (snapshot) writeGroupSnapshot(snapshot);
    const cached = readGroupSnapshot(next);
    roomGenerationRef.current += 1;
    activeRoomIdRef.current = next;
    historyRequestRef.current?.abort();
    historyRequestRef.current = null;
    historyLoadingRef.current = false;
    setHistoryLoading(false);
    sendGenerationRef.current += 1;
    sendingRef.current = false;
    pendingMessagesRef.current.clear();
    setRoomId(next);
    setSnapshot(cached);
    setLoading(!cached);
    setSending(false);
    setInitialSyncReady(false);
    setError("");
    queuedAgentIdsRef.current = [];
    setNotice("");
    setFocusRequest(null);
    setHistoryNotice("");
    setHistoryNavigation((current) => ({ version: current.version + 1, align: "bottom" }));
  }, [snapshot]);

  useEffect(() => {
    if (!member) return;
    const controller = new AbortController();
    const ping = () => groupApi.presence(member, roomId, controller.signal).catch(() => {});
    void ping();
    const timer = window.setInterval(ping, 20000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [member, roomId]);

  const join = useCallback(async (name: string) => {
    const joined = await groupApi.join({ id: member?.id || createMemberId(), name: name.trim() }, roomId);
    setMember(joined);
    writeStoredMember(joined);
    return joined;
  }, [member?.id, roomId]);

  const resolveReply = (replyTo: GroupMessage["replyTo"]) => {
    if (!replyTo?.id) return null;
    if (!replyTo.id.startsWith("optimistic-")) return replyTo;
    const clientMessageId = replyTo.id.slice("optimistic-".length);
    const confirmed = snapshotRef.current?.messages.find((message) => message.clientMessageId === clientMessageId
      && !message.pending
      && !message.id.startsWith("optimistic-"));
    if (!confirmed) return undefined;
    return {
      id: confirmed.id,
      authorName: confirmed.authorName,
      text: (confirmed.text || replyTo.text || "").trim().slice(0, 160),
      sequence: confirmed.sequence,
    };
  };

  const send = useCallback(async (text: string, attachments: MediaFile[] = [], replyTo: GroupMessage["replyTo"] = null) => {
    const attachmentIds = attachments.map((file) => file.id);
    if (!member || sendingRef.current || (!text.trim() && !attachmentIds.length)) return false;
    const resolvedReply = resolveReply(replyTo);
    if (replyTo?.id && resolvedReply === undefined) {
      setError("引用的消息还在发送，请稍后再发");
      return false;
    }
    if (!(await ensureLiveTail()) || sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setError("");
    const clientMessageId = createClientId("group");
    const requestRoomId = roomId;
    const sendGeneration = ++sendGenerationRef.current;
    const optimisticMessage: GroupMessage = {
      id: `optimistic-${clientMessageId}`,
      clientMessageId,
      pending: true,
      type: "human",
      authorId: member.id,
      authorName: member.name,
      agentId: null,
      targetAgentIds: mentionedAgentIds(text, snapshotRef.current?.agents || []),
      replyTo: resolvedReply,
      text: text.trim(),
      attachments,
      artifactIds: [],
      createdAt: new Date().toISOString(),
    };
    pendingMessagesRef.current.set(clientMessageId, optimisticMessage);
    setSnapshot((current) => current && {
      ...current,
      messages: upsertGroupMessage(current.messages, optimisticMessage),
    });
    void (async () => {
      try {
        const result = await groupApi.send(member, requestRoomId, text.trim(), clientMessageId, attachmentIds, resolvedReply);
        if (sendGeneration !== sendGenerationRef.current || activeRoomIdRef.current !== requestRoomId) return;
        pendingMessagesRef.current.delete(clientMessageId);
        const confirmedMessage = {
          ...result.message,
          clientMessageId: result.message.clientMessageId || clientMessageId,
        };
        setSnapshot((current) => current && {
          ...current,
          messages: upsertGroupMessage(current.messages, confirmedMessage),
        });
        const followUp = describeSendResult(result);
        queuedAgentIdsRef.current = followUp.agentIds;
        if (followUp.agentIds.length) {
          knownWorkIdsRef.current = new Set((snapshotRef.current?.activeWorks || []).map((work) => work.workId));
        }
        setNotice(followUp.notice);
      } catch (reason) {
        if (sendGeneration !== sendGenerationRef.current || activeRoomIdRef.current !== requestRoomId) return;
        const failedMessage: GroupMessage = { ...optimisticMessage, pending: false, failure: true };
        pendingMessagesRef.current.set(clientMessageId, failedMessage);
        setSnapshot((current) => current && {
          ...current,
          messages: upsertGroupMessage(current.messages, failedMessage),
        });
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (sendGeneration === sendGenerationRef.current) {
          sendingRef.current = false;
          setSending(false);
        }
      }
    })();
    return true;
  }, [ensureLiveTail, member, roomId]);

  const retrySend = useCallback(async (message: GroupMessage) => {
    const clientMessageId = message.clientMessageId || "";
    const attachmentIds = (message.attachments || []).map((file) => file.id);
    if (!member || sendingRef.current || !message.failure || !clientMessageId || (!message.text.trim() && !attachmentIds.length)) return false;
    if (!(await ensureLiveTail()) || sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setError("");
    const requestRoomId = roomId;
    const sendGeneration = ++sendGenerationRef.current;
    const optimisticMessage: GroupMessage = {
      ...message,
      id: message.id.startsWith("optimistic-") ? message.id : `optimistic-${clientMessageId}`,
      pending: true,
      failure: false,
    };
    pendingMessagesRef.current.set(clientMessageId, optimisticMessage);
    setSnapshot((current) => current && {
      ...current,
      messages: upsertGroupMessage(current.messages, optimisticMessage),
    });
    void (async () => {
      try {
        const result = await groupApi.send(member, requestRoomId, message.text.trim(), clientMessageId, attachmentIds, message.replyTo || null);
        if (sendGeneration !== sendGenerationRef.current || activeRoomIdRef.current !== requestRoomId) return;
        pendingMessagesRef.current.delete(clientMessageId);
        setSnapshot((current) => current && {
          ...current,
          messages: upsertGroupMessage(current.messages, {
            ...result.message,
            clientMessageId: result.message.clientMessageId || clientMessageId,
          }),
        });
        const followUp = describeSendResult(result);
        queuedAgentIdsRef.current = followUp.agentIds;
        if (followUp.agentIds.length) {
          knownWorkIdsRef.current = new Set((snapshotRef.current?.activeWorks || []).map((work) => work.workId));
        }
        setNotice(followUp.notice);
      } catch (reason) {
        if (sendGeneration !== sendGenerationRef.current || activeRoomIdRef.current !== requestRoomId) return;
        const failedMessage: GroupMessage = { ...optimisticMessage, pending: false, failure: true };
        pendingMessagesRef.current.set(clientMessageId, failedMessage);
        setSnapshot((current) => current && {
          ...current,
          messages: upsertGroupMessage(current.messages, failedMessage),
        });
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (sendGeneration === sendGenerationRef.current) {
          sendingRef.current = false;
          setSending(false);
        }
      }
    })();
    return true;
  }, [ensureLiveTail, member, roomId]);

  useEffect(() => {
    const waiting = queuedAgentIdsRef.current;
    if (!waiting.length || !snapshot) return;
    const started = (snapshot.activeWorks || []).some((work) => waiting.includes(work.agentId) && !knownWorkIdsRef.current.has(work.workId));
    if (!started) return;
    queuedAgentIdsRef.current = [];
    setNotice("");
  }, [snapshot]);

  const interrupt = useCallback(async () => {
    setError("");
    try {
      await groupApi.interrupt(roomId);
      queuedAgentIdsRef.current = [];
      setNotice("");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [roomId]);

  return {
    snapshot, rooms, roomId, selectRoom, member, loading, initialSyncReady, sending, error, notice, join, send, interrupt, refresh,
    retrySend,
    historyLoading, historyNotice, historyNavigation, focusRequest, loadOlder, loadNewer, jumpToDate, returnToLatest, revealMessage,
    connected: realtime.connected,
    streaming: realtime.streaming,
    artifactEvent: realtime.artifactEvent,
    unseenLiveCount: realtime.unseenLiveCount,
  };
}
