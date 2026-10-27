import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ConversationState, DirectoryState } from './types';
import { conversationReads } from '../shared/shared/state/conversationReads';
import { writeConversationSnapshot } from '../shared/features/conversations/data/conversationSnapshot';
import { isPendingThread } from '../shared/features/conversations/model/pendingThread';

const conversationKeys = ['project', 'sessions', 'session', 'executionStatus', 'contextStatus', 'visibleModel', 'visibleEffort',
  'usageModel', 'models', 'goal', 'queueItems', 'userInputRequest'] as const;
const directoryKeys = ['projects', 'statusByThread', 'contextByThread', 'goalByThread'] as const;
const pick = <T, K extends keyof T>(value: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map(key => [key, value[key]])) as Pick<T, K>;

// Restore the browser snapshot once; live use must never return to an older view.
export function usePageSnapshot(conversations: ConversationState, directory: DirectoryState) {
  useSyncExternalStore(conversationReads.subscribe, conversationReads.getSnapshot);
  const synced = conversations.initialSyncReady && conversations.contextReady && !conversationReads.pending()
    && !conversations.syncing && !conversations.loadingSession && !conversations.modelsLoading && !directory.loading;
  const committed = useRef(false);
  const ready = committed.current || synced || conversations.localSendVersion > 0;
  const cached = useRef({ id: conversations.selectedId, data: pick(conversations, conversationKeys) });
  const cachedDirectory = useRef(pick(directory, directoryKeys));
  const current = pick(conversations, conversationKeys);
  const shown = ready || cached.current.id !== conversations.selectedId ? current : cached.current.data;
  useLayoutEffect(() => {
    if (ready || cached.current.id !== conversations.selectedId) cached.current = { id: conversations.selectedId, data: shown };
    if (ready) { committed.current = true; cachedDirectory.current = pick(directory, directoryKeys); }
  });

  useEffect(() => {
    if (!synced || !conversations.selectedId || !shown.session || isPendingThread(conversations.selectedId)) return;
    const timer = window.setTimeout(() => writeConversationSnapshot({
      selectedId: conversations.selectedId, sessions: shown.sessions, session: shown.session,
      cachedSessions: conversations.cachedSessions,
    }), 250);
    return () => window.clearTimeout(timer);
  }, [synced, conversations.selectedId, shown.sessions, shown.session, conversations.cachedSessions]);

  return {
    committed: committed.current || ready,
    conversations: { ...conversations, ...shown },
    directory: { ...directory, ...(ready ? pick(directory, directoryKeys) : cachedDirectory.current) },
  };
}
