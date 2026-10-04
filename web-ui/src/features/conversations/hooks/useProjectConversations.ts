import { currentConversationId } from "../../../shared/api/conversationScope";
import { modelApi } from "../../models/data/modelApi";
import { HttpError } from "../../../shared/api/http";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaFile } from "../../../shared/model/media";
import type { RealtimeRecoveryReason } from "../../../shared/model/realtime";
import { useContextManagement } from "../../context-management/hooks/useContextManagement";
import { executionApi } from "../../execution/data/executionApi";
import { useCodexExecution } from "../../execution/hooks/useCodexExecution";
import type { ProjectEvent, UserInputRequest } from "../../execution/model/types";
import { useModels } from "../../models/hooks/useModels";
import { readModelCatalog } from "../../models/data/modelCatalogCache";
import { providerIdOf, readModelDefaults, resolveVisibleEffort, resolveVisibleModel, useModelDefaults } from "../../models/model/modelDefaults";
import { writeConversationSnapshot } from "../data/conversationSnapshot";
import { conversationApi } from "../data/conversationApi";
import { useConversationEvents } from "../realtime/useConversationEvents";
import { createOptimisticMessage, createSubmissionId } from "../state/optimisticMessage";
import { readInitialConversationState } from "../state/initialConversation";
import { useConversationCatalog } from "./useConversationCatalog";
import { useConversationSession } from "./useConversationSession";
import { useFollowUpQueue } from "./useFollowUpQueue";
import { useThreadGoal } from "../../goals/hooks/useThreadGoal";
import type { SessionMessage, SessionSummary } from "../model/types";
import { createClientId } from "../../../shared/id/clientId";
import { readLocalCache, writeLocalCache } from "../../../shared/state/localCache";
import { isPendingThread } from "../model/pendingThread";

const attachmentsFromMessage = (message: SessionMessage): MediaFile[] => {
  const attachments = new Map<string, MediaFile>();
  for (const block of message.blocks || []) {
    if ("file" in block && block.file) attachments.set(block.file.id, block.file);
  }
  return [...attachments.values()];
};

const conversationLocationKey = () => {
  const params = new URLSearchParams(window.location.search);
  return JSON.stringify([
    params.get("thread") || "",
    params.get("agent") || "",
    params.get("employee") || "",
    params.get("conversation") || "",
    params.get("archived") === "1",
  ]);
};

export function useProjectConversations() {
  const conversationScope = currentConversationId();
  const [initial] = useState(readInitialConversationState);
  const selection = useConversationSession(initial);
  const serverThreadId = isPendingThread(selection.selectedId) ? "" : selection.selectedId;

  const execution = useCodexExecution(serverThreadId);
  const followUpQueue = useFollowUpQueue(serverThreadId);
  const goal = useThreadGoal(serverThreadId);
  const [forkingMessageId, setForkingMessageId] = useState("");
  const [editingMessage, setEditingMessage] = useState<SessionMessage | null>(null);
  const editingMessageRef = useRef<SessionMessage | null>(null);
  const desktopPreparingRef = useRef<Promise<boolean> | null>(null);
  const pendingEditRef = useRef<{
    threadId: string;
    text: string;
    attachments: MediaFile[];
    resolve: (accepted: boolean) => void;
  } | null>(null);
  const [editRequestVersion, setEditRequestVersion] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState("");
  const [localSendVersion, setLocalSendVersion] = useState(0);
  const [userInputRequest, setUserInputRequest] = useState<UserInputRequest | null>(null);
  const [userInputBusy, setUserInputBusy] = useState(false);
  const [userInputError, setUserInputError] = useState("");
  const reconcilingSubmissionsRef = useRef(new Set<string>());
  const reconciledSubmissionsRef = useRef(new Set<string>());
  const submittingThreads = useRef(new Set<string>());
  const draftNames = useRef(new Map<string, string>());
  const contextManagement = useContextManagement(serverThreadId);
  const catalog = useConversationCatalog(initial, {
    selectedIdRef: selection.selectedIdRef,
    loadSession: selection.loadSession,
    adoptSelection: selection.adoptSelection,
    clearSelection: selection.clearSelection,
    setCreatedSession: selection.setCreatedSession,
    cacheCreatedSession: selection.cacheCreatedSession,
    setSessionError: selection.setSessionError,
    selectSession: selection.selectSession,
  }, contextManagement.status.model);
  const runningModelRef = useRef(new Map<string, { turnId: string; model: string }>());
  const modelManager = useModels(serverThreadId, (threadId, result) => {
    if (result.threadId && result.threadId !== threadId) {
      contextManagement.applyModelSettings(result.threadId, result);
      if (selection.selectedIdRef.current === threadId) {
        selection.selectSession(result.threadId);
      }
    } else {
      contextManagement.applyModelSettings(threadId, result);
    }
    if (result.committed) void catalog.refreshSessions(false, undefined, false);
  }, contextManagement.status.model);
  const modelDefaults = useModelDefaults();
  const recordedModel = contextManagement.status.threadId === selection.selectedId ? contextManagement.status.model : "";
  const sessionModel = (selection.session?.threadId === selection.selectedId ? selection.session.model || "" : "")
    || catalog.sessions.find((item) => item.threadId === selection.selectedId)?.model
    || "";
  const recordedEffort = contextManagement.status.threadId === selection.selectedId ? contextManagement.status.reasoningEffort : "";
  const visibleModel = resolveVisibleModel(modelManager.models, modelDefaults, recordedModel, sessionModel);
  if (execution.status.active && execution.status.threadId === selection.selectedId) {
    const previous = runningModelRef.current.get(selection.selectedId);
    if (!previous || !previous.model || previous.turnId !== execution.status.turnId) runningModelRef.current.set(selection.selectedId, { turnId: execution.status.turnId, model: recordedModel || sessionModel });
  } else runningModelRef.current.delete(selection.selectedId);
  const usageModel = execution.status.active ? runningModelRef.current.get(selection.selectedId)?.model || '' : visibleModel;
  const draftSettingsRef = useRef(new Map<string, { model: string; reasoningEffort: string }>());
  const visibleEffort = draftSettingsRef.current.get(selection.selectedId)?.reasoningEffort ?? resolveVisibleEffort(modelManager.models, modelDefaults, visibleModel, recordedEffort);
  const modelChoiceRef = useRef({ threadId: "", recordedModel: "", sessionModel: "", recordedEffort: "", contextSettled: false });
  modelChoiceRef.current = {
    threadId: selection.selectedId,
    recordedModel,
    sessionModel,
    recordedEffort,
    contextSettled: contextManagement.status.threadId === selection.selectedId
      && !selection.loadingSession
      && (Boolean(contextManagement.status.updatedAt) || contextManagement.status.phase === "failed"),
  };
  const catalogModelsRef = useRef(modelManager.models);
  catalogModelsRef.current = modelManager.models;
  const stageUnrecordedModel = useCallback(async (threadId: string, applyVisible = false) => {
    const choice = modelChoiceRef.current;
    if (choice.threadId !== threadId || selection.selectedIdRef.current !== threadId) throw new Error("对话已切换，消息未发送");
    if (!choice.contextSettled) {
      if (applyVisible) throw new Error("模型设置还在读取中，请稍后再发送");
      return false;
    }
    const defaults = readModelDefaults();
    const shownModel = resolveVisibleModel(catalogModelsRef.current, defaults, choice.recordedModel, choice.sessionModel);
    const shownEffort = resolveVisibleEffort(catalogModelsRef.current, defaults, shownModel, choice.recordedEffort);
    const modelNeedsWrite = Boolean(shownModel && (applyVisible || (!choice.recordedModel && !choice.sessionModel)));
    const effortNeedsWrite = Boolean(shownEffort && shownEffort !== choice.recordedEffort);
    if (!modelNeedsWrite && !effortNeedsWrite) return false;
    const staged = modelNeedsWrite
      ? await modelManager.change(shownModel, shownEffort || undefined, threadId)
      : await modelManager.changeReasoningEffort(shownEffort, threadId);
    if (!staged) throw new Error("模型设置没有生效，请重试");
    return true;
  }, [modelManager.change, modelManager.changeReasoningEffort, selection.selectedIdRef]);

  const refreshUserInput = useCallback(async (signal?: AbortSignal) => {
    const threadId = selection.selectedIdRef.current;
    if (!threadId) {
      setUserInputRequest(null);
      return;
    }
    try {
      const result = await executionApi.pendingUserInput(threadId, signal);
      if (selection.selectedIdRef.current === threadId) setUserInputRequest(result.request);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setUserInputRequest(null);
    }
  }, [selection.selectedIdRef]);

  useEffect(() => {
    setUserInputRequest(null);
    setUserInputError("");
    const controller = new AbortController();
    void refreshUserInput(controller.signal);
    return () => controller.abort();
  }, [refreshUserInput, selection.selectedId]);

  const answerUserInput = useCallback(async (answers: Record<string, { answers: string[] }>) => {
    const request = userInputRequest;
    if (!request || userInputBusy) return false;
    setUserInputBusy(true);
    setUserInputError("");
    try {
      await executionApi.answerUserInput(request.threadId, request.requestId, answers);
      setUserInputRequest((current) => String(current?.requestId) === String(request.requestId) ? null : current);
      return true;
    } catch (error) {
      setUserInputError(error instanceof Error ? error.message : "提交失败，请重试");
      await refreshUserInput();
      return false;
    } finally {
      setUserInputBusy(false);
    }
  }, [refreshUserInput, userInputBusy, userInputRequest]);

  const syncLocation = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const requestedArchived = params.get("archived") === "1";
    if (requestedArchived !== catalog.archivedView) {
      await catalog.setArchiveViewMode(requestedArchived);
      return;
    }
    const requestedId = params.get("thread") || "";
    const currentId = selection.selectedIdRef.current;
    if (!requestedId) {
      if (currentId) selection.clearSelection();
      await catalog.refreshSessions(false, undefined, false);
      return;
    }
    if (requestedId !== currentId) {
      await selection.adoptSelection(requestedId, false);
    } else {
      await selection.loadSession(requestedId, { quiet: true });
    }
    await catalog.refreshSessions(false, requestedId, false);
  }, [catalog.archivedView, catalog.refreshSessions, catalog.setArchiveViewMode, selection.adoptSelection, selection.clearSelection, selection.loadSession, selection.selectedIdRef]);

  const syncLocationRef = useRef(syncLocation);
  syncLocationRef.current = syncLocation;
  const locationKeyRef = useRef(conversationLocationKey());

  useEffect(() => {
    const handleNavigation = () => {
      const nextLocationKey = conversationLocationKey();
      if (nextLocationKey === locationKeyRef.current) return;
      locationKeyRef.current = nextLocationKey;
      void syncLocationRef.current();
    };
    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("negus:navigate", handleNavigation);
    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("negus:navigate", handleNavigation);
    };
  }, []);

  useEffect(() => {
    if (!selection.selectedId || !selection.session || isPendingThread(selection.selectedId)) return;
    const timer = window.setTimeout(() => {
      writeConversationSnapshot({
        selectedId: selection.selectedId,
        sessions: catalog.sessions,
        session: selection.session!,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [catalog.sessions, selection.selectedId, selection.session]);

  useEffect(() => {
    editingMessageRef.current = editingMessage;
  }, [editingMessage]);

  const pendingCreatesRef = useRef(new Map<string, Promise<string>>());
  const deferredCreatesRef = useRef(new Map<string, () => Promise<string>>());
  const openingNewSessionRef = useRef(false);
  const waitForThread = useCallback(async (threadId: string, waitForContext = false) => {
    if (!isPendingThread(threadId)) return threadId;
    const deferred = deferredCreatesRef.current.get(threadId);
    if (deferred && !pendingCreatesRef.current.has(threadId)) {
      const task = deferred();
      pendingCreatesRef.current.set(threadId, task);
      void task.then(id => {
        if (id) deferredCreatesRef.current.delete(threadId);
        else pendingCreatesRef.current.delete(threadId);
      }).catch(() => { pendingCreatesRef.current.delete(threadId); });
    }
    const realId = await (pendingCreatesRef.current.get(threadId) || Promise.resolve(""));
    if (realId && waitForContext) {
      const started = Date.now();
      while (Date.now() - started < 8000 && selection.selectedIdRef.current === realId) {
        if (modelChoiceRef.current.threadId === realId && modelChoiceRef.current.contextSettled) return realId;
        await new Promise(resolve => window.setTimeout(resolve, 40));
      }
      return "";
    }
    return realId || "";
  }, [selection.selectedIdRef]);

  const setGoal = useCallback(async (objective: string, attachments: MediaFile[] = [], appendTranscript = true) => {
    const requestedId = selection.selectedIdRef.current;
    const threadId = await waitForThread(requestedId, true);
    if (!threadId || selection.selectedIdRef.current !== threadId) return false;
    try {
      if (!execution.status.active) {
        await stageUnrecordedModel(threadId, true);
        await modelManager.applyPending(threadId);
      }
      if (selection.selectedIdRef.current !== threadId) return false;
      const result = await goal.update({ objective, status: "active", attachmentIds: attachments.map((file) => file.id) }, threadId);
      if (!result) return false;
      if (appendTranscript) {
        const message = { ...createOptimisticMessage("/goal " + objective, attachments, createSubmissionId()), source: "native-goal" };
        selection.addOptimisticMessage(threadId, message);
        setLocalSendVersion((value) => value + 1);
      }
      void catalog.refreshSessions(false, threadId, false);
      return true;
    } catch (error) {
      if (selection.selectedIdRef.current === threadId) selection.setSessionError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [waitForThread, selection.selectedIdRef, selection.addOptimisticMessage, selection.setSessionError, execution.status.active, stageUnrecordedModel, modelManager.applyPending, goal.update, catalog.refreshSessions]);

  const reconcileMessage = useCallback(async (threadId: string, messageId: string, submissionId: string, scope: string) => {
    if (reconcilingSubmissionsRef.current.has(submissionId) || reconciledSubmissionsRef.current.has(submissionId)) return;
    reconcilingSubmissionsRef.current.add(submissionId);
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const result = await executionApi.submissionStatus(threadId, submissionId, undefined, scope).catch(() => null);
        if (result?.status === "accepted" || result?.status === "failed") {
          selection.updateOptimisticMessage(threadId, messageId, {
            deliveryState: result.status === "failed" ? "failed" : undefined,
            ...(result.turnId ? { turnId: result.turnId } : {}),
          });
          if (result.status === "accepted") await selection.loadSession(threadId, { quiet: true, retry: false, recovery: true, conversationId: scope });
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 2000));
      }
      selection.updateCurrentSession(threadId, current => ({ ...current, messages: current.messages.map(message =>
        message.id === messageId ? { ...message, deliveryState: "pending" } : message) }));
    } finally {
      reconciledSubmissionsRef.current.add(submissionId);
      reconcilingSubmissionsRef.current.delete(submissionId);
    }
  }, [selection.updateCurrentSession, selection.updateOptimisticMessage, selection.loadSession]);

  const sendDirectMessage = useCallback(async (text: string, attachments: MediaFile[] = [], existingSubmissionId = "", replacingMessageId = "") => {
    const messageText = text.trim();
    const requestedThreadId = selection.selectedId;
    if ((!messageText && !attachments.length) || !requestedThreadId || submittingThreads.current.has(requestedThreadId)) return false;
    submittingThreads.current.add(requestedThreadId);
    const settings = { model: visibleModel, reasoningEffort: visibleEffort };
    const scope = conversationScope;
    let threadId = requestedThreadId;
    const submissionId = existingSubmissionId || createSubmissionId();
    const optimisticMessage = { ...createOptimisticMessage(messageText, attachments, submissionId), deliveryState: "sending" as const };
    if (replacingMessageId) selection.removeOptimisticMessage(threadId, replacingMessageId);
    reconciledSubmissionsRef.current.delete(submissionId);
    selection.addOptimisticMessage(threadId, optimisticMessage);
    setLocalSendVersion(value => value + 1);
    const updateDelivery = (deliveryState: "pending" | "failed" | undefined, turnId?: string) => {
      selection.updateOptimisticMessage(threadId, optimisticMessage.id, { deliveryState, ...(turnId ? { turnId } : {}) });
    };
    try {
      modelManager.clearPending(requestedThreadId);
      if (isPendingThread(requestedThreadId)) draftSettingsRef.current.set(requestedThreadId, settings);
      const created = await waitForThread(requestedThreadId);
      if (!created) throw new Error("新对话创建失败，请重试");
      if (created !== threadId) {
        selection.removeOptimisticMessage(threadId, optimisticMessage.id);
        threadId = created;
        submittingThreads.current.add(threadId);
        selection.addOptimisticMessage(threadId, optimisticMessage);
      }
      if (!execution.status.active) {
        const result = await modelApi.update(threadId, settings.model, undefined, settings.reasoningEffort, scope);
        if (result.threadId && result.threadId !== threadId) {
          selection.removeOptimisticMessage(threadId, optimisticMessage.id);
          const previous = threadId;
          threadId = result.threadId;
          selection.addOptimisticMessage(threadId, optimisticMessage);
          if (selection.selectedIdRef.current === previous) selection.selectSession(threadId);
        }
        if (settings.reasoningEffort) await modelApi.updateReasoningEffort(threadId, settings.reasoningEffort, undefined, scope);
        contextManagement.markSubmitted(threadId, settings);
      }
      const attempt = await execution.sendMessage(messageText, attachments.map(file => file.id), submissionId, threadId, scope);
      if (!attempt || attempt.outcome === "failed") { updateDelivery("failed"); return true; }
      if (attempt.outcome === "uncertain") {
        updateDelivery("pending");
        void reconcileMessage(threadId, optimisticMessage.id, submissionId, scope);
        return true;
      }
      if (attempt.result.threadId !== threadId) {
        selection.removeOptimisticMessage(threadId, optimisticMessage.id);
        threadId = attempt.result.threadId;
        selection.addOptimisticMessage(threadId, optimisticMessage);
      }
      updateDelivery(undefined, attempt.result.turnId);
      void selection.loadSession(threadId, { quiet: true, retry: false, conversationId: scope });
      return true;
    } catch (error) {
      updateDelivery("failed");
      return true;
    } finally {
      submittingThreads.current.delete(requestedThreadId);
      submittingThreads.current.delete(threadId);
    }
  }, [selection.selectedId, visibleModel, visibleEffort, conversationScope, waitForThread, execution.status.active, execution.sendMessage,
    selection.addOptimisticMessage, selection.removeOptimisticMessage, selection.updateCurrentSession, selection.selectSession, selection.loadSession, selection.updateOptimisticMessage, contextManagement.markSubmitted, modelManager.clearPending, reconcileMessage]);

  useEffect(() => {
    const threadId = selection.selectedId;
    if (!threadId || isPendingThread(threadId)) return;
    for (const message of selection.session?.messages || []) {
      if (message.id.startsWith("optimistic-") && message.submissionId && message.deliveryState !== "sending" && message.deliveryState !== "failed") {
        void reconcileMessage(threadId, message.id, message.submissionId, conversationScope);
      }
    }
  }, [selection.selectedId, selection.session, conversationScope, reconcileMessage]);

  const retryPendingMessage = useCallback(async (message: SessionMessage) => {
    if (!message.submissionId || retryingMessageId) return false;
    setRetryingMessageId(message.id);
    try {
      return await sendDirectMessage(message.text, attachmentsFromMessage(message), message.deliveryState === "failed" ? "" : message.submissionId, message.id);
    } finally {
      setRetryingMessageId("");
    }
  }, [retryingMessageId, sendDirectMessage]);

  useEffect(() => {
    const pending = pendingEditRef.current;
    if (!pending) return;
    if (pending.threadId !== selection.selectedId) {
      pendingEditRef.current = null;
      pending.resolve(false);
      return;
    }
    pendingEditRef.current = null;
    void sendDirectMessage(pending.text, pending.attachments)
      .then(pending.resolve)
      .catch(() => pending.resolve(false));
  }, [editRequestVersion, sendDirectMessage, selection.selectedId]);

  const sendMessage = useCallback(async (text: string, attachments: MediaFile[] = []) => {
    const target = editingMessageRef.current;
    if (!target) return sendDirectMessage(text, attachments);
    const sourceThreadId = selection.selectedIdRef.current;
    if (!sourceThreadId || !target.turnId || target.role !== "user" || execution.status.active || selection.session?.archived) return false;
    const sourceMessages = selection.session?.messages || [];
    const targetIndex = sourceMessages.findIndex((message) => message.id === target.id);
    const previousTurnId = targetIndex > 0
      ? [...sourceMessages.slice(0, targetIndex)].reverse().find((message) => message.role === "assistant" && message.turnId)?.turnId || ""
      : "";
    setForkingMessageId(target.id);
    try {
      const created = previousTurnId
        ? await catalog.forkSession(sourceThreadId, previousTurnId, true)
        : await catalog.createSession(selection.session?.cwd || "", "", "", "", true);
      if (!created) return false;
      setEditingMessage(null);
      editingMessageRef.current = null;
      return await new Promise<boolean>((resolve) => {
        pendingEditRef.current = {
          threadId: selection.selectedIdRef.current,
          text,
          attachments,
          resolve,
        };
        setEditRequestVersion((value) => value + 1);
      });
    } finally {
      setForkingMessageId("");
    }
  }, [catalog.createSession, catalog.forkSession, execution.status.active, selection.selectedIdRef, selection.session, sendDirectMessage]);

  const beginEditMessage = useCallback((message: SessionMessage) => {
    if (message.role !== "user" || !message.turnId || selection.session?.archived) return;
    editingMessageRef.current = message;
    setEditingMessage(message);
  }, [selection.session?.archived]);

  const cancelEditMessage = useCallback(() => {
    editingMessageRef.current = null;
    setEditingMessage(null);
  }, []);

  const renameSession = useCallback(async (name: string) => {
    const threadId = selection.selectedIdRef.current;
    const normalized = name.trim();
    if (!threadId || !normalized || normalized.length > 120 || renaming) return false;
    if (isPendingThread(threadId)) {
      draftNames.current.set(threadId, normalized);
      selection.updateCurrentSession(threadId, current => ({ ...current, title: normalized }));
      return true;
    }
    setRenaming(true);
    try {
      const renamed = await conversationApi.rename(threadId, normalized);
      selection.updateCurrentSession(threadId, (current) => ({
        ...current,
        ...renamed,
        title: renamed.title || normalized,
      }));
      catalog.updateSessionSummary(renamed);
      window.dispatchEvent(new CustomEvent("negus:session-renamed", { detail: renamed }));
      return true;
    } catch {
      return false;
    } finally {
      setRenaming(false);
    }
  }, [catalog.updateSessionSummary, renaming, selection.selectedIdRef, selection.updateCurrentSession]);

  useEffect(() => {
    const renamed = (event: Event) => {
      const summary = (event as CustomEvent<SessionSummary>).detail;
      if (!summary?.threadId) return;
      selection.updateCurrentSession(summary.threadId, current => ({ ...current, ...summary }));
      catalog.updateSessionSummary(summary);
    };
    window.addEventListener("negus:session-renamed", renamed);
    return () => window.removeEventListener("negus:session-renamed", renamed);
  }, [selection.updateCurrentSession, catalog.updateSessionSummary]);

  useEffect(() => {
    if (!editingMessageRef.current) return;
    editingMessageRef.current = null;
    setEditingMessage(null);
  }, [selection.selectedId]);

  const forkFromMessage = useCallback(async (message: SessionMessage) => {
    const threadId = selection.selectedIdRef.current;
    if (!threadId || !message.turnId || execution.status.active || selection.session?.archived) return false;
    setForkingMessageId(message.id);
    try {
      return await catalog.forkSession(threadId, message.turnId);
    } finally {
      setForkingMessageId("");
    }
  }, [catalog.forkSession, execution.status.active, selection.selectedIdRef, selection.session?.archived]);

  const queueMessage = useCallback(async (text: string, attachments: MediaFile[] = []) => {
    const messageText = text.trim();
    if (!messageText && !attachments.length) return false;
    const settings = { model: visibleModel, reasoningEffort: visibleEffort };
    const threadId = await waitForThread(selection.selectedId);
    if (!threadId) return false;
    return followUpQueue.enqueue(messageText, attachments, threadId, settings);
  }, [followUpQueue.enqueue, selection.selectedId, visibleModel, visibleEffort, waitForThread]);

  const openNewSession = useCallback((projectRoot = "", requestedModel = "", requestedProviderId = "", options: { deferred?: boolean; onCreated?: (threadId: string) => void } = {}) => {
    if (openingNewSessionRef.current) return false;
    openingNewSessionRef.current = true;
    const defaults = readModelDefaults();
    const models = readModelCatalog();
    const model = requestedModel || resolveVisibleModel(models, defaults, "", "");
    const entry = models.find((item) => item.model === model);
    const providerId = requestedProviderId || (entry ? providerIdOf(entry) : defaults.providerId);
    const pendingId = `pending:${createClientId("new")}`;
    selection.setCreatedSession({
      threadId: pendingId,
      source: "codex",
      title: "新对话",
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      latestUser: "",
      latestAssistant: "",
      archived: false,
      readOnly: false,
      cwd: projectRoot,
      model,
      messages: [],
    });
    const create = () => {
      const draft = draftSettingsRef.current.get(pendingId);
      const chosenModel = draft?.model || model;
      const chosenEntry = readModelCatalog().find(entry => entry.model === chosenModel);
      const chosenProvider = draft && chosenEntry ? providerIdOf(chosenEntry) : providerId;
      return catalog.createSession(projectRoot, chosenModel, pendingId, chosenProvider, true).then(async (created) => {
        if (created) contextManagement.applyModelSettings(created, {
          model: chosenModel, reasoningEffort: draft?.reasoningEffort ?? resolveVisibleEffort(models, defaults, chosenModel, ""),
        });
        if (created && draftNames.current.has(pendingId)) {
          const renamed = await conversationApi.rename(created, draftNames.current.get(pendingId)!).catch(() => {
            if (selection.selectedIdRef.current === created) selection.setSessionError("对话已创建，但标题保存失败，请重新命名");
            return null;
          });
          if (renamed) {
            selection.updateCurrentSession(created, current => ({ ...current, ...renamed }));
            catalog.updateSessionSummary(renamed);
            draftNames.current.delete(pendingId);
          }
        }
        if (created) options.onCreated?.(created);
        return created || "";
      });
    };
    if (options.deferred) {
      deferredCreatesRef.current.set(pendingId, create);
      openingNewSessionRef.current = false;
      return true;
    }
    const task = create();
    pendingCreatesRef.current.set(pendingId, task);
    void task.finally(() => {
      openingNewSessionRef.current = false;
    });
    return true;
  }, [catalog.createSession, selection.setCreatedSession]);

  const prepareDesktopConversation = useCallback((projectRoot: string) => {
    if (desktopPreparingRef.current) return desktopPreparingRef.current;
    const task = (async () => {
      if (!projectRoot) return false;
      const key = `negus:desktop-thread:v1:${projectRoot}`;
      const saved = readLocalCache(key, (value): value is string => typeof value === "string");
      if (saved) {
        // A partial/stale list must not create a replacement conversation.
        const existing = await conversationApi.session(saved).catch((error: unknown) => {
          if (error instanceof HttpError && error.status === 404) return null;
          throw error;
        });
        if (existing && !("messages" in existing)) return false;
        if (existing && existing.cwd?.replace(/\\/g, "/") !== projectRoot.replace(/\\/g, "/")) return false;
        if (existing && !existing.archived && !existing.readOnly) {
          selection.selectSession(existing.threadId);
          return true;
        }
      }
      setEditingMessage(null);
      editingMessageRef.current = null;
      return openNewSession(projectRoot, "", "", {
        deferred: true,
        onCreated: id => writeLocalCache(key, id),
      });
    })().catch(() => false);
    desktopPreparingRef.current = task;
    void task.finally(() => { desktopPreparingRef.current = null; });
    return task;
  }, [openNewSession, selection.selectSession]);

  const review = useCallback(async () => {
    const threadId = selection.selectedIdRef.current;
    if (!threadId || execution.status.active || selection.session?.archived) return false;
    try {
      await executionApi.review(threadId);
      await execution.refreshStatus(undefined, true);
      return true;
    } catch {
      return false;
    }
  }, [execution.refreshStatus, execution.status.active, selection.selectedIdRef, selection.session?.archived]);

  const onSessionsChanged = useCallback((threadId?: string) => {
    const selected = selection.selectedIdRef.current;
    if (selected && (!threadId || threadId === selected)) {
      void selection.loadSession(selected, { quiet: true });
    }
    void catalog.refreshSessions(false, threadId, false);
  }, [catalog.refreshSessions, selection.loadSession, selection.selectedIdRef]);

  const handleEvent = useCallback((event: ProjectEvent) => {
    execution.handleEvent(event);
    followUpQueue.handleEvent(event);
    goal.handleEvent(event);
    if (event.type === "context_status") contextManagement.handleEvent(event);
    if (event.type === "execution_status" && event.phase === "completed") contextManagement.completeSettings(event.threadId);
    if (event.type === "user_message_submitted") {
      const generated = createOptimisticMessage(
        event.text,
        event.attachments || [],
        event.submissionId,
        event.createdAt,
      );
      const message = { ...generated, id: event.messageId || generated.id, deliveryState: "pending" as const };
      selection.addOptimisticMessage(event.threadId, message);
    }
    if (event.type === "user_input_requested" && event.threadId === selection.selectedIdRef.current) {
      setUserInputError("");
      setUserInputRequest(event.request);
    }
    if (event.type === "user_input_resolved" && event.threadId === selection.selectedIdRef.current) {
      setUserInputRequest((current) => String(current?.requestId) === String(event.requestId) ? null : current);
    }
  }, [contextManagement.handleEvent, execution.handleEvent, followUpQueue.handleEvent, goal.handleEvent, selection.addOptimisticMessage, selection.selectedIdRef]);
  const recoverRealtime = useCallback((_reason: RealtimeRecoveryReason) => {
    const selected = selection.selectedIdRef.current;
    if (selected) void selection.loadSession(selected, { quiet: true, retry: false, recovery: true });
    if (selected) void goal.refresh();
    void execution.refreshStatus(undefined, true).then(() => {
      onSessionsChanged(selection.selectedIdRef.current || undefined);
    });
    void followUpQueue.refresh();
    void refreshUserInput();
  }, [execution.refreshStatus, followUpQueue.refresh, goal.refresh, onSessionsChanged, refreshUserInput, selection.selectedIdRef]);
  const connected = useConversationEvents(
    onSessionsChanged,
    handleEvent,
    recoverRealtime,
    selection.selectedId,
    execution.status.active,
    execution.status.phase === "submitted",
  );

  const selectLatestSession = useCallback((projectRoot = "") => {
    const desktopThreadId = projectRoot
      ? readLocalCache("negus:desktop-thread:v1:" + projectRoot, (value): value is string => typeof value === "string") || ""
      : "";
    catalog.selectLatestSession(desktopThreadId);
  }, [catalog.selectLatestSession]);

  return {
    project: catalog.project,
    sessions: catalog.sessions,
    archivedView: catalog.archivedView,
    selectedId: selection.selectedId,
    composerKey: selection.composerKey,
    session: selection.session,
    loadingList: catalog.loadingList,
    initialSyncReady: catalog.initialSyncReady,
    loadingSession: selection.loadingSession,
    loadingOlder: selection.loadingOlder,
    syncing: selection.syncing,
    contentSyncState: selection.contentSyncState,
    connected,
    listError: catalog.listError,
    sessionError: selection.sessionError,
    selectSession: selection.selectSession,
    selectLatestSession,
    createSession: catalog.createSession,
    openNewSession,
    creating: catalog.creating,
    setArchiveViewMode: catalog.setArchiveViewMode,
    archiveSession: catalog.archiveSession,
    unarchiveSession: catalog.unarchiveSession,
    archiveBusyIds: catalog.archiveBusyIds,
    forkFromMessage,
    forkingMessageId,
    editingMessage,
    editingMessageId: editingMessage?.id || "",
    retryPendingMessage,
    retryingMessageId,
    localSendVersion,
    beginEditMessage,
    cancelEditMessage,
    renameSession,
    renaming,
    loadOlder: selection.loadOlder,
    executionStatus: execution.status,
    streamingText: execution.streamingText,
    commentaryText: execution.commentaryText,
    contextStatus: contextManagement.status,
    visibleModel,
    usageModel,
    visibleEffort,
    models: modelManager.models,
    modelsLoading: modelManager.loading,
    modelChanging: modelManager.changing,
    modelError: modelManager.error,
    sending: execution.sending,
    sendingSlow: execution.sendingSlow,
    sendMessage,
    prepareDesktopConversation,
    queueMessage,
    queueItems: followUpQueue.items,
    queueLoading: followUpQueue.loading,
    queueBusy: followUpQueue.busy,
    queueError: followUpQueue.error,
    editQueueItem: followUpQueue.edit,
    removeQueueItem: followUpQueue.remove,
    moveQueueItem: followUpQueue.move,
    retryQueueItem: followUpQueue.retry,
    sendQueueItem: followUpQueue.sendNow,
    interrupt: () => !execution.status.active && goal.goal?.status === "active"
      ? goal.update({ status: "paused" }).then(Boolean)
      : execution.interrupt(),
    userInputRequest,
    userInputBusy,
    userInputError,
    answerUserInput,
    review,
    compactContext: contextManagement.compact,
    setAutoCompactThreshold: contextManagement.setThreshold,
    changeModel: async (model: string, reasoningEffort?: string) => {
      const id = selection.selectedIdRef.current;
      if (!isPendingThread(id)) return modelManager.change(model, reasoningEffort);
      draftSettingsRef.current.set(id, { model, reasoningEffort: reasoningEffort ?? visibleEffort });
      selection.updateCurrentSession(id, current => ({ ...current, model }));
      return true;
    },
    changeReasoningEffort: async (reasoningEffort: string) => {
      const id = selection.selectedIdRef.current;
      if (!isPendingThread(id)) return modelManager.changeReasoningEffort(reasoningEffort);
      draftSettingsRef.current.set(id, { model: visibleModel, reasoningEffort });
      selection.updateCurrentSession(id, current => ({ ...current }));
      return true;
    },
    goal: goal.goal,
    goalBusy: goal.busy,
    goalError: goal.error,
    goalResumePrompt: goal.resumePrompt,
    dismissGoalResumePrompt: goal.dismissResumePrompt,
    setGoal,
    editGoal: (objective: string) => setGoal(objective, [], false),
    changeGoalStatus: async (status: "active" | "paused") => {
      const threadId = selection.selectedIdRef.current;
      if (status === "active") {
        try {
          if (!execution.status.active) {
            await stageUnrecordedModel(threadId, true);
            await modelManager.applyPending(threadId);
          }
          if (selection.selectedIdRef.current !== threadId) return false;
        } catch (error) {
          if (selection.selectedIdRef.current === threadId) selection.setSessionError(error instanceof Error ? error.message : String(error));
          return false;
        }
      }
      return Boolean(await goal.update({ status }, threadId));
    },
    clearGoal: () => goal.clear(),
    refresh: () => catalog.refreshSessions(),
  };
}
