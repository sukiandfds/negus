import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationState, DirectoryState } from './types';

/**
 * Commits the first server read as one UI snapshot. Cached values remain
 * visible while that read is in flight; an uncached page stays empty until
 * the first snapshot is ready.
 */
export function usePageSnapshot(conversations: ConversationState, directory: DirectoryState) {
  const initial = useRef({
    sessions: conversations.sessions,
    session: conversations.session,
    selectedId: conversations.selectedId,
    projects: directory.projects,
    statusByThread: directory.statusByThread,
    goalByThread: directory.goalByThread,
    contextByThread: directory.contextByThread,
    contextStatus: conversations.contextStatus,
    executionStatus: conversations.executionStatus,
  });
  const [committed, setCommitted] = useState(false);

  useEffect(() => {
    const modelsReady = !conversations.modelsLoading || conversations.models.length > 0;
    if (!committed && conversations.initialSyncReady && conversations.contextReady && !directory.loading && modelsReady) setCommitted(true);
  }, [committed, conversations.contextReady, conversations.initialSyncReady, conversations.models, conversations.modelsLoading, directory.loading]);

  const snapshot = committed ? {
    sessions: conversations.sessions,
    session: conversations.session,
    selectedId: conversations.selectedId,
    projects: directory.projects,
    statusByThread: directory.statusByThread,
    goalByThread: directory.goalByThread,
    contextByThread: directory.contextByThread,
    contextStatus: conversations.contextStatus,
    executionStatus: conversations.executionStatus,
  } : initial.current;

  const displayConversations = useMemo<ConversationState>(() => {
    if (committed) return conversations;
    return {
      ...conversations,
      sessions: snapshot.sessions,
      session: snapshot.session,
      selectedId: snapshot.selectedId,
      contextStatus: snapshot.contextStatus,
      executionStatus: snapshot.executionStatus,
      loadingList: false,
      loadingSession: false,
      syncing: false,
      contentSyncState: 'stable',
      listError: '',
      sessionError: '',
      modelsLoading: false,
      modelError: '',
    };
  }, [committed, conversations, snapshot.selectedId, snapshot.session, snapshot.sessions, snapshot.contextStatus, snapshot.executionStatus]);

  const displayDirectory = useMemo<DirectoryState>(() => {
    if (committed) return directory;
    return {
      ...directory,
      projects: snapshot.projects,
      statusByThread: snapshot.statusByThread,
      goalByThread: snapshot.goalByThread,
      contextByThread: snapshot.contextByThread,
      loading: false,
      error: '',
    };
  }, [committed, directory, snapshot.contextByThread, snapshot.goalByThread, snapshot.projects, snapshot.statusByThread]);

  return { committed, conversations: displayConversations, directory: displayDirectory };
}
