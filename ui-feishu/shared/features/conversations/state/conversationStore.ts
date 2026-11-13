import { goalCompletionKey } from '../../goals/model/types';
import type { ConversationPresentation, SessionDetail, SessionMessage } from '../model/types';
import type { InitialConversationState } from './initialConversation';
import { idleStatus } from '../../execution/hooks/useCodexExecution';
import { emptyStatus } from '../../context-management/hooks/useContextManagement';
import { conversationApi } from '../data/conversationApi';
import { mergeMessageList, mergePendingOptimisticMessages, mergeSessionRefresh, sameSubmission } from './conversationMerge';
import { createOptimisticMessage } from './optimisticMessage';
import { readModelCatalog } from '../../models/data/modelCatalogCache';
import { readModelDefaults, resolveVisibleModel, resolveVisibleEffort } from '../../models/model/modelDefaults';

export type ThreadSnapshot = Pick<ConversationPresentation, 'executionStatus' | 'contextStatus' | 'goal' | 'queueItems' | 'userInputRequest'> & {
  session: SessionDetail | null;
};
type Patch = Partial<ThreadSnapshot>;
const persistedPending = (messages: SessionMessage[]) => JSON.stringify(messages.filter(message => message.id.startsWith('optimistic-')
  && (message.deliveryState === 'failed' || message.deliveryState === 'occupied')));
const signature = (value: unknown, omitStream = false) => JSON.stringify(value,
  function (this: { phase?: string; type?: string; id?: string }, key, field) {
    return ['updatedAt', 'lastProbeAt', 'lastEventAt', 'eventEpoch', 'eventSeq', 'durationMs'].includes(key)
      || (omitStream && (['streamingItemId', 'streamingText', 'commentary'].includes(key)
        || (key === 'detail' && this.phase === 'working' && (this.type === 'execution_status' || this.id === 'reasoning-current')))) ? undefined : field;
  });
export const withStreamingStatus = (status: ThreadSnapshot['executionStatus'], live?: ThreadSnapshot['executionStatus']) =>
  status.active && status.turnId && live?.turnId === status.turnId ? { ...status,
    streamingItemId: live.streamingItemId ?? status.streamingItemId, streamingText: live.streamingText ?? status.streamingText,
    commentary: live.commentary ?? status.commentary } : status;
const refreshSession = (current: SessionDetail, incoming: SessionDetail) => {
  const merged = mergeSessionRefresh(current, incoming);
  return merged.messages.length > incoming.messages.length ? { ...merged, hasMore: current.hasMore,
    nextBefore: current.nextBefore, nextCursor: current.nextCursor } : merged;
};

// FEAT-001: one committed record per thread; events and local sends are overlays, never a second cache.
export class ConversationStore {
  committed = new Map<string, ThreadSnapshot>();
  live = new Map<string, Patch>();
  private completedMessages = new Map<string, SessionMessage[]>();
  clearCompletedMessages = (id: string) => { this.completedMessages.delete(id); };
  completeMessage = (id: string, message: SessionMessage) => {
    this.completedMessages.set(id, mergeMessageList(this.completedMessages.get(id) || [], [message]));
    ++this.persistVersion;
    this.notify();
  };
  localPending = new Map<string, SessionMessage[]>();
  sendingQueue = new Map<string, string>();
  private acceptedSubmissions = new Set<string>();
  private rememberAccepted = (id: string, submissionId: string) => {
    this.acceptedSubmissions.add(JSON.stringify([id, submissionId]));
    if (this.acceptedSubmissions.size > 500) this.acceptedSubmissions.delete(this.acceptedSubmissions.values().next().value!);
  };
  private queueDispatches = new Map<string, string>();
  linkQueuedMessage = (id: string, queueSubmissionId: string, submissionId: string) => {
    this.queueDispatches.set(JSON.stringify([id, queueSubmissionId]), submissionId);
    if (this.queueDispatches.size > 500) this.queueDispatches.delete(this.queueDispatches.keys().next().value!);
  };
  private rememberQueue = (id: string, items: ThreadSnapshot['queueItems'], snapshot = false) => {
    for (const item of items) {
      if (item.dispatchSubmissionId && (!snapshot || !this.queueDispatches.has(JSON.stringify([id, item.submissionId])))) this.linkQueuedMessage(id, item.submissionId, item.dispatchSubmissionId);
      const dispatchId = this.queueDispatches.get(JSON.stringify([id, item.submissionId]));
      if (dispatchId && this.acceptedSubmissions.has(JSON.stringify([id, dispatchId]))) this.addMessage(id, {
        ...createOptimisticMessage(item.text, item.attachments, dispatchId, item.sentAt || item.createdAt),
        authorId: item.authorId, authorName: item.authorName, displaySourceAgentId: item.displaySourceAgentId,
      });
    }
  };
  private visibleQueue = (id: string, items: ThreadSnapshot['queueItems']) => items.flatMap(item => {
    const key = JSON.stringify([id, item.submissionId]);
    const dispatchSubmissionId = this.queueDispatches.get(key) || item.dispatchSubmissionId;
    if (this.acceptedSubmissions.has(JSON.stringify([id, dispatchSubmissionId || '']))) this.rememberAccepted(id, item.submissionId);
    if (this.acceptedSubmissions.has(key)) return [];
    return [{ ...item, dispatchSubmissionId }];
  });
  modelChoices = new Map<string, { model: string; reasoningEffort: string }>();
  revisions = new Map<string, number>();
  synced = new Set<string>();
  dirty = new Set<string>();
  errors = new Map<string, string>();
  dismissedGoals = new Map<string, string>();
  freshBodies = new Set<string>();
  private fieldRevisions = new Map<string, Partial<Record<keyof ThreadSnapshot, number>>>();
  private eventSequences = new Map<string, { epoch: string; seq: number; retired: Set<string> }>();
  acceptEvent = (event: { type: string; threadId?: string; eventEpoch?: string; eventSeq?: number }) => {
    if (!event.eventEpoch || !event.eventSeq) return true;
    const key = `${event.threadId || ''}:${['execution_status', 'assistant_delta', 'assistant_commentary'].includes(event.type) ? 'execution' : event.type}`;
    const previous = this.eventSequences.get(key);
    if (previous?.epoch === event.eventEpoch && event.eventSeq <= previous.seq) return false;
    if (previous?.retired.has(event.eventEpoch)) return false;
    const retired = previous?.retired || new Set<string>();
    if (previous && previous.epoch !== event.eventEpoch) retired.add(previous.epoch);
    this.eventSequences.set(key, { epoch: event.eventEpoch, seq: event.eventSeq, retired });
    return true;
  };
  private listeners = new Set<() => void>();
  private version = 0;
  private persistVersion = 0;
  private reads = new Map<string, { signal: AbortSignal; promise: Promise<ThreadSnapshot> }>();
  private waiters = new Map<string, ((success: boolean) => void)[]>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  getPersistSnapshot = () => this.persistVersion;
  notify = () => { ++this.version; this.listeners.forEach(listener => listener()); };

  constructor(initial: InitialConversationState) {
    for (const id of initial.partialSessionIds) this.freshBodies.add(id);
    for (const detail of initial.cachedSessions) {
      const pending = detail.messages.filter(message => message.id.startsWith('optimistic-'));
      if (pending.length) this.localPending.set(detail.threadId, pending);
      const view = initial.presentation?.[detail.threadId];
      this.committed.set(detail.threadId, { ...this.empty(detail.threadId),
        executionStatus: { ...idleStatus(detail.threadId), ...view?.executionStatus },
        contextStatus: { ...emptyStatus(detail.threadId), ...view?.contextStatus },
        goal: view?.goal || null, queueItems: view?.queueItems || [], userInputRequest: view?.userInputRequest || null,
        session: { ...detail, messages: detail.messages.filter(message => !message.id.startsWith('optimistic-')) } });
    }
  }
  empty = (id: string): ThreadSnapshot => ({ session: null, executionStatus: idleStatus(id), contextStatus: emptyStatus(id),
    goal: null, queueItems: [], userInputRequest: null });
  get = (id: string, includeLive = true): ThreadSnapshot => {
    const value = { ...(this.committed.get(id) || this.empty(id)), ...(includeLive ? this.live.get(id) : {}) };
    const choice = this.modelChoices.get(id);
    if (choice) value.contextStatus = { ...value.contextStatus, ...choice };
    if (!value.session && id) value.session = { threadId: id, source: 'codex', title: '', updatedAt: '', messageCount: null,
      latestUser: '', latestAssistant: '', messages: [] };
    if (value.session && this.completedMessages.has(id)) value.session = { ...value.session,
      messages: mergeMessageList(this.completedMessages.get(id)!, value.session.messages) };
    const pending = this.localPending.get(id);
    if (value.session && pending?.length) value.session = mergePendingOptimisticMessages(value.session, pending);
    value.queueItems = this.visibleQueue(id, value.queueItems).map(item => {
      const sentAt = this.sendingQueue.get(JSON.stringify([id, item.id]));
      const dispatch = sentAt ? this.live.get(id)?.queueItems?.find(queued => queued.id === item.id) : undefined;
      return sentAt && item.state === 'pending' ? { ...item, state: 'dispatching' as const,
        dispatchSubmissionId: dispatch?.dispatchSubmissionId || item.dispatchSubmissionId, sentAt: dispatch?.sentAt || sentAt } : item;
    });
    return value;
  };
  acceptQueuedMessage = (id: string, submissionId: string) => {
    const item = this.get(id).queueItems.find(item => item.submissionId === submissionId || item.dispatchSubmissionId === submissionId);
    this.rememberAccepted(id, submissionId);
    if (item) this.rememberAccepted(id, item.submissionId);
    return item;
  };
  update = (id: string, patch: Patch | ((current: ThreadSnapshot) => Patch), remote = false) => {
    if (!id) return;
    const next = typeof patch === 'function' ? patch(this.get(id)) : patch;
    this.rememberQueue(id, next.queueItems || []);
    if (remote) {
      const current = this.get(id);
      const keys = Object.keys(next) as (keyof Patch)[];
      if (keys.every(key => signature(current[key]) === signature(next[key]))) return;
      this.live.set(id, { ...this.live.get(id), ...next });
      this.notify();
    } else {
      this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
      this.fieldRevisions.set(id, { ...this.fieldRevisions.get(id),
        ...Object.fromEntries(Object.keys(next).map(key => [key, this.revisions.get(id)])) });
      this.committed.set(id, { ...(this.committed.get(id) || this.empty(id)), ...next });
      ++this.persistVersion;
      const live = this.live.get(id);
      if (live) for (const key of Object.keys(next) as (keyof Patch)[]) delete live[key];
      this.notify();
    }
  };
  invalidate = (id: string, notify = true) => {
    this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    this.dirty.add(id);
    if (notify) this.notify();
  };
  request = (id: string) => {
    const promise = new Promise<boolean>(resolve => this.waiters.set(id, [...(this.waiters.get(id) || []), resolve]));
    this.invalidate(id);
    return promise;
  };
  finish = (id: string, error = '') => {
    if (error) this.errors.set(id, error); else this.errors.delete(id);
    for (const resolve of this.waiters.get(id) || []) resolve(!error);
    this.waiters.delete(id);
  };
  read = (id: string, sourceRevision: string, signal: AbortSignal, conversationId?: string) => {
    const pending = this.reads.get(id);
    if (pending && !pending.signal.aborted) return pending.promise;
    const promise = conversationApi.snapshot(id, sourceRevision, signal, conversationId).then(result => {
      const current = this.committed.get(id)?.session;
      const incoming = result.session;
      const session = incoming && current ? current.contentVersion && incoming.contentVersion && current.contentVersion > incoming.contentVersion
        ? current : refreshSession(current, incoming) : incoming || current || null;
      if (!session) throw new Error('对话同步失败，保留已有内容');
      const selectedSettings = this.committed.get(id)?.contextStatus.selectedSettings;
      const saved = selectedSettings || result.context.lastSuccessfulSettings;
      const models = readModelCatalog(), defaults = readModelDefaults();
      const model = saved ? resolveVisibleModel(models, defaults, saved.model, '') : result.context.model;
      const contextStatus = saved ? { ...result.context, model, selectedSettings,
        reasoningEffort: resolveVisibleEffort(models, defaults, model, saved.reasoningEffort) } : result.context;
      return { session: { ...session, ...(incoming && result.historyFormatVersion ? { historyFormatVersion: result.historyFormatVersion } : {}), sourceRevision: result.sourceRevision || session.sourceRevision }, contextStatus,
        executionStatus: result.status, goal: result.goal, queueItems: result.queue, userInputRequest: result.input };
    });
    const entry = { signal, promise };
    this.reads.set(id, entry);
    void promise.finally(() => { if (this.reads.get(id) === entry) this.reads.delete(id); }).catch(() => {});
    return promise;
  };
  commit = (id: string, snapshot: ThreadSnapshot, revision: number) => {
    const previousCommitted = this.committed.get(id);
    const previousPending = this.localPending.get(id);
    const previousLive = signature(this.live.get(id), true);
    const hadError = this.errors.has(id);
    const wasDirty = this.dirty.has(id);
    const wasSynced = this.synced.has(id);
    this.rememberQueue(id, snapshot.queueItems, true);
    for (const message of snapshot.session?.messages || []) if (message.role === 'user' && message.submissionId && !message.id.startsWith('optimistic-')) this.rememberAccepted(id, message.submissionId);
    snapshot = { ...snapshot, queueItems: this.visibleQueue(id, snapshot.queueItems) };
    if (snapshot.goal?.status === 'complete' && this.dismissedGoals.get(id) === goalCompletionKey(snapshot.goal)) snapshot = { ...snapshot, goal: null };
    const latest = this.committed.get(id);
    for (const [key, changedAt] of Object.entries(this.fieldRevisions.get(id) || {}) as [keyof ThreadSnapshot, number][]) {
      if (latest && changedAt > revision) snapshot = { ...snapshot, [key]: latest[key] };
    }
    const current = latest?.session;
    if (current && snapshot.session) snapshot = { ...snapshot, session: refreshSession(current, snapshot.session) };
    const pending = this.localPending.get(id);
    if (pending && snapshot.session) {
      const ids = new Set(snapshot.session.messages.map(message => message.id));
      const merged = mergePendingOptimisticMessages(snapshot.session, pending);
      snapshot = { ...snapshot, session: { ...merged, messages: merged.messages.filter(message => ids.has(message.id)) } };
    }
    this.committed.set(id, snapshot);
    const local = this.localPending.get(id);
    if (local && snapshot.session) {
      const remaining = mergePendingOptimisticMessages(snapshot.session, local).messages.filter(message => message.id.startsWith('optimistic-'));
      if (remaining.length) this.localPending.set(id, remaining); else this.localPending.delete(id);
    }
    const live = this.live.get(id);
    if (live?.contextStatus) live.contextStatus = { ...live.contextStatus,
      model: snapshot.contextStatus.model, reasoningEffort: snapshot.contextStatus.reasoningEffort };
    this.synced.add(id);
    if ((this.revisions.get(id) || 0) === revision) {
      this.live.delete(id); this.dirty.delete(id); this.freshBodies.delete(id);
      const executionStatus = withStreamingStatus(snapshot.executionStatus, live?.executionStatus);
      if (executionStatus !== snapshot.executionStatus) this.live.set(id, { executionStatus });
    }
    this.finish(id);
    const dataChanged = signature(previousCommitted, true) !== signature(this.committed.get(id), true)
      || signature(previousPending, true) !== signature(this.localPending.get(id), true);
    if (!dataChanged && previousCommitted) this.committed.set(id, previousCommitted);
    const stateChanged = hadError !== this.errors.has(id) || wasDirty !== this.dirty.has(id)
      || wasSynced !== this.synced.has(id) || previousLive !== signature(this.live.get(id), true);
    if (dataChanged) ++this.persistVersion;
    return dataChanged || stateChanged;
  };
  addMessage = (id: string, message: SessionMessage) => {
    if ([...(this.committed.get(id)?.session?.messages || []), ...(this.localPending.get(id) || [])].some(item => item.id === message.id || sameSubmission(item, message))) return;
    if (!this.committed.has(id)) this.committed.set(id, this.empty(id));
    this.localPending.set(id, mergeMessageList(this.localPending.get(id) || [], [message]));
    if (message.id.startsWith('optimistic-') && (message.deliveryState === 'failed' || message.deliveryState === 'occupied')) ++this.persistVersion;
    this.notify();
  };
  changeMessages = (id: string, update: (messages: SessionMessage[]) => SessionMessage[]) => {
    const current = this.localPending.get(id) || [], before = persistedPending(current), next = update(current);
    if (current.length === next.length && current.every((message, index) => message === next[index])) return;
    if (before !== persistedPending(next)) ++this.persistVersion;
    if (next.length) this.localPending.set(id, next); else this.localPending.delete(id);
    this.notify();
  };
  setArchived = (id: string, archived: boolean) => {
    this.finish(id);
    const session = this.committed.get(id)?.session;
    if (session) this.update(id, { session: { ...session, archived } }); else this.notify();
  };
  migrate = (from: string, to: string, detail: SessionDetail) => {
    const previous = this.get(from, false), existing = this.get(to, false);
    this.committed.set(to, { ...previous, ...existing, session: detail,
      queueItems: [...new Map([...previous.queueItems, ...existing.queueItems].map(item => [item.id, { ...item, threadId: to }])).values()],
      executionStatus: { ...previous.executionStatus, threadId: to }, contextStatus: { ...previous.contextStatus, threadId: to } });
    this.localPending.set(to, mergeMessageList(this.localPending.get(to) || [], this.localPending.get(from) || []));
    const choice = this.modelChoices.get(from);
    if (choice) this.modelChoices.set(to, choice);
    this.committed.delete(from); this.live.delete(from); this.localPending.delete(from); this.modelChoices.delete(from);
    this.dirty.delete(from); this.revisions.delete(from); this.errors.delete(from); this.synced.delete(from);
    this.fieldRevisions.delete(from); this.freshBodies.delete(from);
    ++this.persistVersion;
    this.notify();
  };
}
