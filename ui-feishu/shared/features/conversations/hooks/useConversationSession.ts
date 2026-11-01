import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { InitialConversationState } from '../state/initialConversation';
import { conversationApi } from '../data/conversationApi';
import { mergeOlderMessages } from '../state/conversationMerge';
import { isPendingThread } from '../model/pendingThread';
import type { SessionDetail, SessionMessage } from '../model/types';
import { ConversationStore } from '../state/conversationStore';

export const presentConversationError = (reason: unknown) => {
  const detail = reason instanceof Error ? reason.message : String(reason);
  if (/thread not loaded|no rollout found|session not found|rollout path missing/i.test(detail)) return '会话记录暂时无法读取，请稍后重试';
  return detail.includes('同步超时') ? '同步较慢，正在重试' : detail;
};
export type ConversationSession = ReturnType<typeof useConversationSession>;

export function useConversationSession(initial: InitialConversationState) {
  const [store] = useState(() => new ConversationStore(initial));
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [selectedId, setSelectedId] = useState(initial.selectedId);
  const selectedIdRef = useRef(initial.selectedId);
  const [composerKey, setComposerKey] = useState(initial.selectedId);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderRequests = useRef(new Map<string, AbortController>());
  const [sessionError, setSessionError] = useState('');

  const loadSession = useCallback(async (id: string, options: { older?: boolean; retry?: boolean; recovery?: boolean; prefetch?: boolean; conversationId?: string } = {}) => {
    if (!id || isPendingThread(id)) return false;
    if (!options.older) { if (options.recovery) store.freshBodies.add(id); return store.request(id); }
    const cached = store.get(id, false).session;
    if (!cached?.hasMore || (!cached.nextCursor && cached.nextBefore == null) || olderRequests.current.has(id)) return false;
    const controller = new AbortController();
    olderRequests.current.set(id, controller);
    setLoadingOlder(true);
    try {
      const response = await conversationApi.session(id, { cursor: cached.nextCursor || undefined,
        before: cached.nextCursor ? undefined : cached.nextBefore ?? undefined }, controller.signal, options.conversationId);
      if (controller.signal.aborted || !('messages' in response)) return false;
      const current = store.get(id, false).session;
      if (current) store.update(id, { session: { ...current, hasMore: response.hasMore, nextBefore: response.nextBefore,
        nextCursor: response.nextCursor, messages: mergeOlderMessages(response.messages, current.messages) } });
      return true;
    } catch (reason) {
      if (!controller.signal.aborted) { store.errors.set(id, presentConversationError(reason)); store.notify(); }
      return false;
    } finally {
      olderRequests.current.delete(id);
      setLoadingOlder(olderRequests.current.has(selectedIdRef.current));
    }
  }, [store]);
  const updateRoute = useCallback((id: string) => {
    const params = new URLSearchParams(window.location.search);
    if (id && !isPendingThread(id)) params.set('thread', id); else params.delete('thread');
    for (const key of ['agent', 'employee', 'employeeId', 'conversation']) params.delete(key);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);
  const selectSession = useCallback((id: string, writeRoute = true) => {
    selectedIdRef.current = id; setSelectedId(id); setComposerKey(id); setSessionError('');
    setLoadingOlder(olderRequests.current.has(id));
    if (writeRoute) updateRoute(id);
    // Selection reads committed state. The batch coordinator loads absent/failed records.
    if (store.errors.has(id)) store.invalidate(id);
  }, [store, updateRoute]);
  const adoptSelection = useCallback(async (id: string) => { selectSession(id, false); return true; }, [selectSession]);
  const clearSelection = useCallback(() => selectSession(''), [selectSession]);
  const cacheCreatedSession = useCallback((detail: SessionDetail, previousId = '') => {
    if (isPendingThread(previousId) && store.committed.has(previousId)) store.migrate(previousId, detail.threadId, detail);
    else store.update(detail.threadId, { session: detail });
  }, [store]);
  const setCreatedSession = useCallback((detail: SessionDetail, preserveComposer = false) => {
    const previous = selectedIdRef.current;
    const replacing = isPendingThread(previous) && !isPendingThread(detail.threadId);
    if (replacing && store.committed.has(previous)) store.migrate(previous, detail.threadId, detail); else cacheCreatedSession(detail);
    selectedIdRef.current = detail.threadId; setSelectedId(detail.threadId);
    if (!replacing && !preserveComposer) setComposerKey(detail.threadId);
    setSessionError(''); updateRoute(detail.threadId);
  }, [store, cacheCreatedSession, updateRoute]);
  const updateCurrentSession = useCallback((id: string, update: (current: SessionDetail) => SessionDetail) => {
    const current = store.committed.get(id)?.session;
    if (current) store.update(id, { session: update(current) });
  }, [store]);
  const removeOptimisticMessage = useCallback((id: string, messageId: string) => store.changeMessages(id, messages => messages.filter(message => message.id !== messageId)), [store]);
  const updateOptimisticMessage = useCallback((id: string, messageId: string, patch: Partial<SessionMessage>) => store.changeMessages(id, messages => messages.map(message => message.id === messageId ? { ...message, ...patch } : message)), [store]);
  const session = store.get(selectedId, false).session;
  return { store, selectedId, selectedIdRef, composerKey, session,
    cachedSessions: new Map([...store.committed.keys()].flatMap(id => { const detail = store.get(id, false).session; return detail ? [[id, detail] as const] : []; })),
    sessionErrors: store.errors, sessionError: sessionError || store.errors.get(selectedId) || '', setSessionError,
    loadingSession: Boolean(selectedId && !store.committed.get(selectedId)?.session), loadingOlder,
    syncing: store.dirty.has(selectedId), contentSyncState: store.errors.has(selectedId) ? 'degraded' as const : !store.synced.has(selectedId) && initial.partialSessionIds.includes(selectedId) ? 'recovering' as const : store.dirty.has(selectedId) ? 'syncing' as const : 'stable' as const,
    selectSession, adoptSelection, clearSelection, loadSession, setCreatedSession, cacheCreatedSession,
    updateCurrentSession, addOptimisticMessage: store.addMessage, removeOptimisticMessage, updateOptimisticMessage,
    cancelSessionLoad: (id: string) => { olderRequests.current.get(id)?.abort(); store.invalidate(id); },
    loadOlder: async () => { await loadSession(selectedIdRef.current, { older: true }); } };
}
