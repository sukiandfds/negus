import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ConversationState, DirectoryState } from './types';
import { conversationReads } from '../shared/shared/state/conversationReads';
import { writeConversationSnapshot } from '../shared/features/conversations/data/conversationSnapshot';
import { mergeMessageList } from '../shared/features/conversations/state/conversationMerge';
import { isPendingThread } from '../shared/features/conversations/model/pendingThread';

const conversationKeys = ['project', 'sessions', 'session', 'executionStatus', 'contextStatus', 'visibleModel', 'visibleEffort',
  'usageModel', 'models', 'goal', 'queueItems', 'userInputRequest'] as const;
const directoryKeys = ['projects', 'statusByThread', 'contextByThread', 'goalByThread'] as const;
const pick = <T, K extends keyof T>(value: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map(key => [key, value[key]])) as Pick<T, K>;

// Keep each conversation's cached view until its existing reads have all settled.
export function usePageSnapshot(conversations: ConversationState, directory: DirectoryState) {
  useSyncExternalStore(conversationReads.subscribe, conversationReads.getSnapshot);
  const ready = conversations.initialSyncReady && conversations.contextReady && !conversationReads.pending()
    && !conversations.syncing && !conversations.loadingSession && !conversations.modelsLoading && !directory.loading;
  const committed = useRef(false);
  const cached = useRef({ id: conversations.selectedId, data: pick(conversations, conversationKeys) });
  const cachedDirectory = useRef(pick(directory, directoryKeys));
  const current = pick(conversations, conversationKeys);
  const shown = ready || cached.current.id !== conversations.selectedId ? current : cached.current.data;
  useLayoutEffect(() => {
    if (ready || cached.current.id !== conversations.selectedId) cached.current = { id: conversations.selectedId, data: shown };
    if (ready) { committed.current = true; cachedDirectory.current = pick(directory, directoryKeys); }
  });

  useEffect(() => {
    if (!ready || !conversations.selectedId || !shown.session || isPendingThread(conversations.selectedId)) return;
    const timer = window.setTimeout(() => writeConversationSnapshot({
      selectedId: conversations.selectedId, sessions: shown.sessions, session: shown.session,
      cachedSessions: conversations.cachedSessions,
    }), 250);
    return () => window.clearTimeout(timer);
  }, [ready, conversations.selectedId, shown.sessions, shown.session, conversations.cachedSessions]);

  // Local sends remain immediate while a background read is in flight.
  const optimistic = conversations.session?.messages.filter(message => message.id.startsWith('optimistic-')) || [];
  const session = shown.session && shown.session !== conversations.session && optimistic.length
    ? { ...shown.session, messages: mergeMessageList(shown.session.messages, optimistic) } : shown.session;
  return {
    committed: committed.current || ready,
    conversations: { ...conversations, ...shown, session },
    directory: { ...directory, ...(ready ? pick(directory, directoryKeys) : cachedDirectory.current) },
  };
}
