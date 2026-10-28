import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ConversationState, DirectoryState } from './types';
import { conversationReads } from '../shared/shared/state/conversationReads';
import { writeConversationSnapshot } from '../shared/features/conversations/data/conversationSnapshot';
import { isPendingThread } from '../shared/features/conversations/model/pendingThread';

// Restore the browser snapshot once; live use must never return to an older view.
export function usePageSnapshot(conversations: ConversationState, directory: DirectoryState) {
  useSyncExternalStore(conversationReads.subscribe, conversationReads.getSnapshot);
  const synced = conversations.initialSyncReady && conversations.contextReady && !conversationReads.pending()
    && !conversations.syncing && !conversations.loadingSession && !conversations.modelsLoading && !directory.loading;
  const committed = useRef(false);
  const ready = committed.current || synced || conversations.localSendVersion > 0;
  useLayoutEffect(() => { if (ready) committed.current = true; });

  useEffect(() => {
    if (!synced || !conversations.selectedId || !conversations.session || isPendingThread(conversations.selectedId)) return;
    const timer = window.setTimeout(() => writeConversationSnapshot({
      selectedId: conversations.selectedId, sessions: conversations.sessions, session: conversations.session,
      cachedSessions: conversations.cachedSessions,
    }), 250);
    return () => window.clearTimeout(timer);
  }, [synced, conversations.selectedId, conversations.sessions, conversations.session, conversations.cachedSessions]);

  return {
    committed: committed.current || ready,
    conversations,
    directory,
  };
}
