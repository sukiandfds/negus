import { useCallback, useEffect, useRef, useState } from "react";
import { createClientId } from "../../../shared/id/clientId";
import { executionApi } from "../data/executionApi";
import type { SendMessageAttempt, SubmissionStatusResult } from "../data/executionApi";
import type { ExecutionStatus, ProjectEvent } from "../model/types";

const SEND_CONFIRM_TIMEOUT_MS = 20000;
const SEND_SLOW_NOTICE_MS = 3000;
const MAX_RETIRED_TURNS = 20;
const sendingThreads = new Set<string>();

import type { ConversationStore } from "../../conversations/state/conversationStore";

export const idleStatus = (threadId: string): ExecutionStatus => ({
  type: "execution_status",
  threadId,
  turnId: "",
  phase: "idle",
  label: "Codex 已就绪",
  detail: "",
  commentary: "",
  streamingItemId: "",
  streamingText: "",
  activities: [],
  active: false,
  startedAt: null,
  updatedAt: null,
  durationMs: null,
});

export function useCodexExecution(threadId: string, store: ConversationStore) {
  const scopeRef = useRef({ threadId, generation: 0 });
  if (scopeRef.current.threadId !== threadId) {
    scopeRef.current = { threadId, generation: scopeRef.current.generation + 1 };
  }
  const generation = scopeRef.current.generation;
  const isCurrent = useCallback(() => scopeRef.current.generation === generation, [generation]);
  const status = store.get(threadId).executionStatus;
  const setStatus = useCallback((value: ExecutionStatus | ((current: ExecutionStatus) => ExecutionStatus)) => {
    if (!isCurrent()) return;
    const next = typeof value === 'function' ? value(store.get(threadId).executionStatus) : value;
    if (next.threadId === threadId) store.update(threadId, { executionStatus: next }, true);
  }, [isCurrent, store, threadId]);
  const streamingItemId = useRef("");
  const streamingBuffer = useRef("");
  const streamingTimer = useRef(0);
  const currentTurnIdRef = useRef("");
  const retiredTurnIdsRef = useRef(new Set<string>());
  const stateRevisionRef = useRef(0);
  const activeEventEpochRef = useRef("");
  const knownEventEpochsRef = useRef(new Set<string>());
  const lastEventSeqRef = useRef(0);
  const [sendingIds, setSendingIds] = useState(new Set<string>());
  const [slowIds, setSlowIds] = useState(new Set<string>());
  const markSending = (id: string, value: boolean) => setSendingIds(current => {
    const next = new Set(current);
    if (value) next.add(id); else next.delete(id);
    return next;
  });

  const clearStreaming = useCallback(() => {
    window.clearTimeout(streamingTimer.current);
    streamingTimer.current = 0;
    streamingBuffer.current = "";
    streamingItemId.current = "";
    setStatus((current) => ({ ...current, streamingText: "", streamingItemId: "", commentary: "" }));
  }, [setStatus]);

  const retireTurn = useCallback((turnId: string) => {
    if (!turnId) return;
    retiredTurnIdsRef.current.add(turnId);
    while (retiredTurnIdsRef.current.size > MAX_RETIRED_TURNS) {
      const oldest = retiredTurnIdsRef.current.values().next().value;
      if (!oldest) break;
      retiredTurnIdsRef.current.delete(oldest);
    }
  }, []);

  const applyStatus = useCallback((next: ExecutionStatus, revision = stateRevisionRef.current) => {
    if (!isCurrent() || next.threadId !== threadId || revision !== stateRevisionRef.current) return false;
    if (next.turnId && retiredTurnIdsRef.current.has(next.turnId)) return false;
    const previousTurnId = currentTurnIdRef.current;
    if (next.turnId && previousTurnId && next.turnId !== previousTurnId) {
      retireTurn(previousTurnId);
      clearStreaming();

    }
    if (next.turnId) currentTurnIdRef.current = next.turnId;
    stateRevisionRef.current += 1;
    const preserveTerminalStream = ["completed", "idle"].includes(next.phase)
      && !next.streamingText
      && Boolean(streamingBuffer.current)
      && Boolean(streamingItemId.current);
    setStatus({
      ...next,
      turnId: next.turnId || "",
      activities: next.activities || [],
      streamingItemId: preserveTerminalStream ? streamingItemId.current : next.streamingItemId || "",
      streamingText: preserveTerminalStream ? streamingBuffer.current : next.streamingText || "",
    });
    if (next.streamingText !== undefined && !preserveTerminalStream) {
      window.clearTimeout(streamingTimer.current);
      streamingTimer.current = 0;
      streamingItemId.current = next.streamingItemId || "";
      streamingBuffer.current = next.streamingText;
    }
    return true;
  }, [clearStreaming, retireTurn, isCurrent, setStatus, threadId]);

  const refreshStatus = useCallback(async (_signal?: AbortSignal, _reconcile = false) => {
    if (!threadId || !isCurrent()) return null;
    await store.request(threadId);
    return store.get(threadId).executionStatus;
  }, [isCurrent, store, threadId]);

  const acceptEventSequence = useCallback((event: ProjectEvent) => {
    const sequencedEvent = event as ProjectEvent & { eventEpoch?: unknown; eventSeq?: unknown };
    const eventEpoch = typeof sequencedEvent.eventEpoch === "string" ? sequencedEvent.eventEpoch : "";
    const eventSeq = typeof sequencedEvent.eventSeq === "number" && Number.isSafeInteger(sequencedEvent.eventSeq)
      ? sequencedEvent.eventSeq
      : 0;
    if (!eventEpoch || !eventSeq) return true;
    if (!activeEventEpochRef.current) {
      activeEventEpochRef.current = eventEpoch;
      knownEventEpochsRef.current.add(eventEpoch);
    } else if (activeEventEpochRef.current !== eventEpoch) {
      if (knownEventEpochsRef.current.has(eventEpoch)) return false;
      activeEventEpochRef.current = eventEpoch;
      knownEventEpochsRef.current.add(eventEpoch);
      while (knownEventEpochsRef.current.size > 3) {
        const oldestEpoch = knownEventEpochsRef.current.values().next().value;
        if (!oldestEpoch) break;
        knownEventEpochsRef.current.delete(oldestEpoch);
      }
      lastEventSeqRef.current = 0;
    }
    if (eventSeq <= lastEventSeqRef.current) return false;
    lastEventSeqRef.current = eventSeq;
    return true;
  }, []);

  useEffect(() => {
    stateRevisionRef.current += 1;
    const current = store.get(threadId).executionStatus;
    currentTurnIdRef.current = current.turnId || '';
    window.clearTimeout(streamingTimer.current);
    streamingTimer.current = 0;
    streamingItemId.current = current.streamingItemId || '';
    streamingBuffer.current = current.streamingText || '';
    retiredTurnIdsRef.current.clear();
    activeEventEpochRef.current = '';
    knownEventEpochsRef.current.clear();
    lastEventSeqRef.current = 0;
  }, [store, threadId]);

  const committedStatus = store.committed.get(threadId)?.executionStatus;
  useEffect(() => {
    const next = store.get(threadId).executionStatus;
    if (next.turnId && next.turnId !== currentTurnIdRef.current) {
      retireTurn(currentTurnIdRef.current);
      currentTurnIdRef.current = next.turnId;
    }
    streamingItemId.current = next.streamingItemId || '';
    streamingBuffer.current = next.streamingText || '';
  }, [committedStatus, store, threadId, retireTurn]);

  useEffect(() => () => {
    window.clearTimeout(streamingTimer.current);
  }, []);

  const handleEvent = useCallback((event: ProjectEvent) => {
    if (!isCurrent() || !("threadId" in event) || event.threadId !== threadId) return;
    if (!acceptEventSequence(event)) return;
    if (event.type === "execution_status") {
      if (!applyStatus(event)) return;
      if (["failed", "interrupted", "systemError"].includes(event.phase)) {
        clearStreaming();
      }
      return;
    }
    if (event.type === "assistant_commentary") {
      if (!event.turnId || event.turnId !== currentTurnIdRef.current || retiredTurnIdsRef.current.has(event.turnId)) return;
      stateRevisionRef.current += 1;
      setStatus((current) => ({ ...current, commentary: event.text }));
      return;
    }
    if (event.type === "assistant_delta") {
      if (!event.turnId || event.turnId !== currentTurnIdRef.current || retiredTurnIdsRef.current.has(event.turnId)) return;
      stateRevisionRef.current += 1;
      if (streamingItemId.current !== event.itemId) streamingBuffer.current = event.delta;
      else streamingBuffer.current += event.delta;
      streamingItemId.current = event.itemId;
      setStatus((current) => current.turnId === event.turnId
        ? { ...current, streamingItemId: event.itemId, streamingText: current.streamingItemId !== event.itemId ? streamingBuffer.current : current.streamingText, updatedAt: new Date().toISOString() }
        : current);
      if (!streamingTimer.current) {
        streamingTimer.current = window.setTimeout(() => {
          streamingTimer.current = 0;
          setStatus((current) => ({ ...current, streamingText: streamingBuffer.current }));
        }, 100);
      }
      return;
    }
  }, [acceptEventSequence, applyStatus, clearStreaming, isCurrent, setStatus, threadId]);

  const sendMessage = useCallback(async (
    text: string,
    attachmentIds: string[] = [],
    submissionId = "",
    targetThreadId = threadId,
    conversationId?: string,
  ): Promise<SendMessageAttempt | null> => {
    const message = text.trim();
    if (!targetThreadId || (!message && !attachmentIds.length) || sendingThreads.has(targetThreadId)) return null;
    sendingThreads.add(targetThreadId);
    markSending(targetThreadId, true);
    const acceptedSubmissionId = submissionId || createClientId();
    const slowTimer = window.setTimeout(() => setSlowIds(current => new Set(current).add(targetThreadId)), SEND_SLOW_NOTICE_MS);
    const steering = status.active;
    const previousTurnId = status.turnId;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SEND_CONFIRM_TIMEOUT_MS);
    if (!steering && isCurrent() && targetThreadId === threadId) {
      retireTurn(currentTurnIdRef.current || previousTurnId);
      currentTurnIdRef.current = "";
      stateRevisionRef.current += 1;
      clearStreaming();
    }
    const sendRevision = stateRevisionRef.current;
    try {
      const accepted = await executionApi.sendMessage(targetThreadId, message, attachmentIds, acceptedSubmissionId, controller.signal, conversationId);
      if (!isCurrent() || targetThreadId !== threadId) return accepted.status === "pending"
        ? { outcome: "uncertain", result: null }
        : { outcome: "accepted", result: accepted };
      if (accepted.status === "pending") {
        if (sendRevision !== stateRevisionRef.current) return { outcome: "uncertain", result: null };
        stateRevisionRef.current += 1;
        setStatus((current) => ({
          ...current,
          phase: "unknown",
          label: "正在确认指令是否已送达",
          detail: "服务端尚未确认这条指令，不会重复提交",
          active: true,
          updatedAt: new Date().toISOString(),
        }));
        return { outcome: "uncertain", result: null };
      }
      if (accepted.threadId !== targetThreadId) return { outcome: "accepted", result: accepted };
      if (accepted.turnId && sendRevision === stateRevisionRef.current) {
        currentTurnIdRef.current = accepted.turnId;
        stateRevisionRef.current += 1;
        setStatus((current) => ({
          ...(steering ? current : idleStatus(targetThreadId)),
          turnId: accepted.turnId,
          phase: steering && current.active ? current.phase : "working",
          label: steering && current.active ? current.label : "Codex 正在处理任务",
          active: true,
          updatedAt: new Date().toISOString(),
        }));
      }
      return { outcome: "accepted", result: accepted };
    } catch (reason) {
      const receipt = await executionApi.submissionStatus(targetThreadId, acceptedSubmissionId, undefined, conversationId).catch(() => null);
      if (receipt?.status === "accepted") return { outcome: "accepted", result: { threadId: receipt.threadId, turnId: receipt.turnId || "", status: "accepted" } };
      const uncertain = receipt?.status !== "failed" && (receipt?.status === "pending" || controller.signal.aborted || reason instanceof TypeError);
      const detail = uncertain
        ? "发送确认超时，未重复提交；请确认任务状态后重试"
        : receipt?.error || (reason instanceof Error ? reason.message : String(reason));
      if (sendRevision !== stateRevisionRef.current) return uncertain ? { outcome: "uncertain", result: null } : { outcome: "failed", result: null, error: detail };
      if (steering) {
        setStatus((current) => uncertain
          ? { ...current, phase: "unknown", label: "正在确认指令是否已送达", detail }
          : { ...current, detail });
      } else {
        setStatus({
          ...idleStatus(threadId),
          phase: uncertain ? "unknown" : "failed",
          label: uncertain ? "正在确认指令是否已送达" : "指令发送失败",
          detail,
          updatedAt: new Date().toISOString(),
        });
      }
      return uncertain ? { outcome: "uncertain", result: null } : { outcome: "failed", result: null, error: detail };
    } finally {
      sendingThreads.delete(targetThreadId);
      window.clearTimeout(timeout);
      window.clearTimeout(slowTimer);
      setSlowIds(current => { const next = new Set(current); next.delete(targetThreadId); return next; });
      markSending(targetThreadId, false);
    }
  }, [clearStreaming, refreshStatus, retireTurn, status.active, status.turnId, isCurrent, setStatus, threadId]);

  const reconcileSubmission = useCallback(async (submissionId: string, signal?: AbortSignal): Promise<SubmissionStatusResult | null> => {
    if (!threadId || !submissionId) return null;
    try {
      return await executionApi.submissionStatus(threadId, submissionId, signal);
    } catch {
      return null;
    }
  }, [threadId]);

  const interrupt = useCallback(async () => {
    if (!threadId || !status.active || sendingThreads.has(threadId)) return false;
    sendingThreads.add(threadId);
    markSending(threadId, true);
    setStatus((current) => ({
      ...current,
      phase: "stopping",
      label: "正在停止",
      detail: "",
      active: true,
    }));
    try {
      await executionApi.interrupt(threadId);
      return true;
    } catch (reason) {
      const recovered = await refreshStatus(undefined, true);
      if (!recovered && isCurrent()) {
        setStatus((current) => ({
          ...current,
          phase: "unknown",
          label: "停止状态待确认",
          detail: reason instanceof Error ? reason.message : String(reason),
          active: true,
        }));
      }
      return false;
    } finally {
      sendingThreads.delete(threadId);
      markSending(threadId, false);
    }
  }, [refreshStatus, status.active, isCurrent, setStatus, threadId]);

  return { status, streamingText: status.streamingText || "", commentaryText: status.commentary || "", sending: sendingIds.has(threadId), sendingSlow: slowIds.has(threadId), handleEvent, sendMessage, reconcileSubmission, interrupt, clearStreaming, refreshStatus };
}
