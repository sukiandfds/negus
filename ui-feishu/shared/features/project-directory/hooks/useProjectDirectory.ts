import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { projectDirectoryApi, projectDirectoryResource } from '../data/projectDirectoryApi';
import type { DirectoryProject } from '../model/types';
import type { ConversationStore } from '../../conversations/state/conversationStore';

const emptyProjects: DirectoryProject[] = [];
// Conversation events are consumed once, by useConversationEvents. Directory membership is a shared resource.
export function useProjectDirectory(store: ConversationStore) {
  const [goalRecovery, setGoalRecovery] = useState(0);
  const cached = useSyncExternalStore(projectDirectoryResource.subscribe, projectDirectoryResource.getSnapshot);
  const projects = cached.data ?? emptyProjects;
  const refresh = useCallback(async (signal?: AbortSignal, invalidate = false) => {
    try { await projectDirectoryApi.list(signal, invalidate); } catch { /* Shared resource retains its last good value. */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const changed = () => { void refresh(controller.signal, true); };
    const recovered = () => setGoalRecovery(value => value + 1);
    window.addEventListener('negus:realtime-recovered', recovered);
    window.addEventListener('negus:directory-changed', changed);
    return () => { window.removeEventListener('negus:realtime-recovered', recovered); controller.abort(); window.removeEventListener('negus:directory-changed', changed); };
  }, [refresh]);
  const entries = [...store.committed.keys()].map(id => [id, store.get(id)] as const);
  return { projects, goalRecovery, loading: cached.data === null && !cached.error, error: cached.error, refresh,
    statusByThread: Object.fromEntries(entries.map(([id, view]) => [id, view.executionStatus])),
    contextByThread: Object.fromEntries(entries.map(([id, view]) => [id, view.contextStatus.phase])),
    goalByThread: Object.fromEntries(entries.map(([id, view]) => [id, view.goal])) };
}
