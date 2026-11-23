import { useEffect, useMemo, useRef, useState } from 'react';
import { HttpError } from '../shared/shared/api/http';
import type { ConversationState, DirectoryState } from './types';
import { writeConversationSnapshot } from '../shared/features/conversations/data/conversationSnapshot';
import { isPendingThread } from '../shared/features/conversations/model/pendingThread';
import { readConversationBatches } from '../shared/features/conversations/state/conversationBatch';
import { terminalExecution, type ThreadSnapshot } from '../shared/features/conversations/state/conversationStore';
import { buildConversationDirectory, mergeDirectoryProjects, snapshotStatusByThread } from './conversationDirectory';

// FEAT-001: batch initial reads, then sync changed threads independently into the same store.
export function usePageSnapshot(conversations: ConversationState, directory: DirectoryState) {
  const c = conversations, store = c.store;
  const live = useRef({ conversations, directory });
  live.current = { conversations, directory };
  const [shown, setShown] = useState(() => ({ projects: directory.projects, project: c.project, committed: false }));
  const observed = useRef(new Map<string, string>());
  const running = useRef(false);
  const initialLoading = useRef(true);
  const independentReads = useRef(new Map<string, { abort: AbortController }>());
  const cancelIndependent = () => {
    for (const read of independentReads.current.values()) read.abort.abort();
    independentReads.current.clear();
  };
  const [syncing, setSyncing] = useState(true);
  const mounted = useRef(true), generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [wakeVersion, wake] = useState(0);
  useEffect(() => {
    const resume = () => {
      const id = live.current.conversations.selectedId;
      if (document.visibilityState === 'visible' && store.errors.has(id) && observed.current.delete(id)) wake(v => v + 1);
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [store]);
  const revisionKey = JSON.stringify([...store.bodyRevisions]);
  const source = useMemo(() => JSON.stringify([c.sessions, c.sessions.map(item => [item.threadId, item.title, item.updatedAt]), directory.projects, revisionKey],
    (key, value) => ['updatedAt', 'lastProbeAt', 'lastEventAt', 'eventEpoch', 'eventSeq', 'durationMs'].includes(key) ? undefined : value),
  [c.sessions, c.sessions.map(item => [item.threadId, item.title, item.updatedAt]), directory.projects, revisionKey]);
  const selectedThread = useRef(c.selectedId);
  if (selectedThread.current !== c.selectedId) {
    selectedThread.current = c.selectedId;
    const cached = store.committed.get(c.selectedId);
    const missingContext = !cached?.contextStatus.updatedAt
      || (cached.contextStatus.usedTokens == null && Boolean(cached.session?.messages.length));
    if (!cached?.session || store.errors.has(c.selectedId)
      || (missingContext && cached?.contextStatus.usageSourceRevision !== (cached?.session?.sourceRevision || ''))
      || store.dirty.has(c.selectedId) || store.freshBodies.has(c.selectedId)) observed.current.delete(c.selectedId);
  }
  const archiveView = useRef(c.archivedView);
  if (archiveView.current !== c.archivedView) {
    archiveView.current = c.archivedView; observed.current.clear(); cancelIndependent();
    controller.current?.abort(); ++generation.current; running.current = false;
  }
  const editRevision = useRef(c.historyEdit);
  useEffect(() => {
    if (editRevision.current === c.historyEdit) return;
    editRevision.current = c.historyEdit;
    controller.current?.abort(); ++generation.current; running.current = false;
    if (c.historyEdit) {
      observed.current.delete(c.historyEdit.threadId);
      independentReads.current.get(c.historyEdit.threadId)?.abort.abort();
      independentReads.current.delete(c.historyEdit.threadId);
    }
  }, [c.historyEdit]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); cancelIndependent(); }; }, []);

  useEffect(() => {
    // FEAT-001: finish in-flight reads; captured signatures leave newer changes pending.
    const listReady = c.initialSyncReady && !directory.loading;
    const rows = buildConversationDirectory(directory, c.sessions, c.archivedView, c.project?.root, undefined, c.archivedByThread).all
      .filter(row => row.threadId && !row.pending && !isPendingThread(row.threadId));
    // URL/employee navigation can select a thread that has not reached the directory yet.
    if (c.selectedId && !isPendingThread(c.selectedId) && !rows.some(row => row.threadId === c.selectedId)) {
      rows.push({ id: c.selectedId, threadId: c.selectedId, name: '', subtitle: '' });
    }
    // FEAT-001: synchronize the latest 20 conversations and the open conversation.
    const eligible = new Set(rows.slice(0, listReady && !c.archivedView ? 20 : 0).map(row => row.threadId!));
    if (c.selectedId) eligible.add(c.selectedId);
    const priority = new Set(rows.slice(0, 10).map(row => row.threadId!));
    const candidates = rows.filter(row => eligible.has(row.threadId!)).map(row => {
      const id = row.threadId!, revision = store.revisions.get(id) || 0;
      return { id, revision, conversationId: row.conversationId || undefined,
        signature: JSON.stringify([row.session?.sourceRevision, row.session?.messageCount, row.preview,
          store.bodyRevisions.get(id) || 0]), priority: priority.has(id) };
    }).filter(entry => observed.current.get(entry.id) !== entry.signature);
    for (const id of store.errors.keys()) if (!rows.some(row => row.threadId === id)) store.errors.delete(id);
    for (const [id, read] of independentReads.current) {
      if (!eligible.has(id) || !rows.some(row => row.threadId === id)) {
        read.abort.abort(); independentReads.current.delete(id);
      }
    }
    // Directory membership is visible immediately; body reads fill the same row later.
    setShown(previous => {
      const projects = mergeDirectoryProjects(previous.projects, directory.projects);
      return JSON.stringify(projects) === JSON.stringify(previous.projects) ? previous : { ...previous, projects };
    });
    const synchronize = (batch: typeof candidates, abort: AbortController, isCurrent: () => boolean, initial: boolean) => {
      const pendingPriority = new Set(batch.filter(entry => entry.priority).map(entry => entry.id));
      const candidate = new Map<string, ThreadSnapshot>();
      const earlyPublished = new Set<string>();
      const publish = (results: { entry: typeof candidates[number]; error: string }[]) => {
        if (!mounted.current || abort.signal.aborted || !isCurrent()) return;
        let changed = false;
        for (const { entry } of results) pendingPriority.delete(entry.id);
        if (initial) setSyncing(pendingPriority.size > 0);
        for (const { entry, error } of results) {
          observed.current.set(entry.id, entry.signature);
          if (error) {
            if (store.errors.get(entry.id) !== error) changed = true;
            store.finish(entry.id, error);
            console.error('[negus:conversation-sync]', { threadId: entry.id, reason: error, at: new Date().toISOString() });
          } else changed = store.commit(entry.id, candidate.get(entry.id)!, entry.revision) || changed;
        }
        setShown(previous => {
          const current = live.current.conversations;
          const projects = mergeDirectoryProjects(previous.projects, live.current.directory.projects);
          if (previous.committed && JSON.stringify(previous.project) === JSON.stringify(current.project)
            && JSON.stringify(previous.projects) === JSON.stringify(projects)) return previous;
          return { committed: true, project: current.project, projects };
        });
        if (changed) store.notify();
      };
      return readConversationBatches(batch, async (entry, signal) => {
        const cached = store.committed.get(entry.id)?.session;
        const reuse = Boolean(!store.freshBodies.has(entry.id) && cached?.sourceRevision);
        let view: ThreadSnapshot;
        for (let attempt = 0; ; attempt++) {
          try {
            view = await store.read(entry.id, reuse ? cached!.sourceRevision! : '', signal, entry.conversationId);
            break;
          } catch (error) {
            const transient = error instanceof TypeError || (error instanceof HttpError
              && (error.status === 409 || error.status === 408 || error.status >= 500));
            if (!transient || attempt >= 3 || signal.aborted || entry.id !== live.current.conversations.selectedId) throw error;
            await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
            if (signal.aborted || entry.id !== live.current.conversations.selectedId) throw error;
          }
        }
        if (signal.aborted) return;
        candidate.set(entry.id, view);
        // FEAT-001: only the open conversation bypasses the initial batch barrier.
        if (initial && entry.id === live.current.conversations.selectedId) {
          publish([{ entry, error: '' }]);
          earlyPublished.add(entry.id);
        }
      }, results => publish(results.filter(result => !earlyPublished.has(result.entry.id))), abort.signal, 10000, batch.filter(entry => entry.priority).length);
    };
    const start = (entry: typeof candidates[number]) => {
      if (independentReads.current.has(entry.id)) return;
      const read = { abort: new AbortController() };
      independentReads.current.set(entry.id, read);
      void synchronize([entry], read.abort, () => independentReads.current.get(entry.id) === read, false).finally(() => {
        if (independentReads.current.get(entry.id) !== read) return;
        independentReads.current.delete(entry.id);
        if (mounted.current) wake(value => value + 1);
      });
    };
    const selected = candidates.find(entry => entry.id === c.selectedId);
    if (selected) start(selected);
    if (!listReady || running.current) return;
    const entries = candidates.filter(entry => !independentReads.current.has(entry.id));
    if (!entries.length) {
      initialLoading.current = false;
      setSyncing(false);
      const projects = mergeDirectoryProjects(shown.projects, directory.projects);
      if (!shown.committed || JSON.stringify(projects) !== JSON.stringify(shown.projects)) {
        setShown({ committed: true, project: c.project, projects });
      }
      return;
    }
    if (!initialLoading.current) {
      setSyncing(false);
      for (const entry of entries) {
        if (independentReads.current.size >= 4) break;
        start(entry);
      }
      return;
    }
    running.current = true;
    setSyncing(true);
    const run = ++generation.current, abort = new AbortController();
    controller.current = abort;
    void synchronize(entries, abort, () => generation.current === run, true).finally(() => {
      if (generation.current !== run) return;
      running.current = false;
      if (!abort.signal.aborted) initialLoading.current = false;
      if (mounted.current) wake(value => value + 1);
    });
  }, [source, wakeVersion, c.initialSyncReady, directory.loading, c.selectedId, c.archivedView, c.historyEdit, c.archivedByThread, c.project]);

  const selected = store.get(c.selectedId, false), summary = c.sessions.find(item => item.threadId === c.selectedId);
  const session = selected.session && summary
    && (selected.session.title !== summary.title || selected.session.updatedAt !== summary.updatedAt)
    ? { ...selected.session, title: summary.title, updatedAt: summary.updatedAt } : selected.session;
  // FEAT-001: execution events render immediately, independently of history reads.
  const statusByThread = snapshotStatusByThread(store, c.selectedId, shown.projects);
  const executionStatus = statusByThread[c.selectedId] || store.get(c.selectedId).executionStatus;
  useEffect(() => {
    // The same authoritative terminal also clears the state used by send/queue controls.
    for (const [id, status] of Object.entries(statusByThread)) {
      if (terminalExecution(status) && store.get(id).executionStatus.active) store.update(id, { executionStatus: status });
    }
  }, [store, shown.projects, store.getSnapshot()]);
  const states = [...store.committed];
  const display = { ...c, ...selected, queueItems: c.queueItems, session, executionStatus, goal: c.goal || selected.goal, userInputRequest: c.userInputRequest,
    streamingText: executionStatus.streamingText || '', commentaryText: executionStatus.commentary || '',
    syncing,
    project: shown.project,
    sessionError: store.errors.get(c.selectedId) || c.sessionError,
    listError: c.listError || (store.errors.size ? `${store.errors.size} 个对话同步失败，保留已有内容；可刷新重试。` : ''),
    loadingSession: c.loadingSession || Boolean(c.selectedId && !isPendingThread(c.selectedId) && !store.committed.get(c.selectedId)?.session && !session?.messages.length && !store.errors.has(c.selectedId)),
    refresh: () => {
      controller.current?.abort(); ++generation.current; running.current = false; observed.current.clear(); cancelIndependent();
      wake(value => value + 1);
      return c.refresh();
    } };
  useEffect(() => {
    if (!c.initialSyncReady || directory.loading || isPendingThread(c.selectedId)) return;
    // FEAT-001: persist the same directory-backed summaries that the list displays.
    const sessions = buildConversationDirectory({ ...directory, projects: shown.projects }, display.sessions,
      c.archivedView, shown.project?.root, c.cachedSessions, c.archivedByThread).all.flatMap(row => {
      if (!row.session || row.pending || isPendingThread(row.session.threadId)) return [];
      const { messages: _messages, sourceSignature: _signature, ...summary } = row.session as NonNullable<typeof session>;
      return [{ ...summary, latestMessage: row.preview }];
    });
    writeConversationSnapshot({ selectedId: c.selectedId, sessions, session: c.cachedSessions.get(c.selectedId) || null, cachedSessions: c.cachedSessions,
      presentation: Object.fromEntries(states.map(([id, { session: _session, ...view }]) => [id, { ...view, visibleModel: '', visibleEffort: '', usageModel: '', streamingText: '', commentaryText: '' }])) });
  }, [shown, c.initialSyncReady, directory.loading, c.sessions, c.selectedId, store.getPersistSnapshot()]);
  return { committed: shown.committed, conversations: display, directory: { ...directory, projects: shown.projects,
    statusByThread,
    contextByThread: Object.fromEntries(states.map(([id, view]) => [id, view.contextStatus.phase])),
    contextTimeByThread: Object.fromEntries(states.map(([id, view]) => [id, view.contextStatus.compactionUpdatedAt])),
    goalByThread: Object.fromEntries(states.map(([id, view]) => [id, view.goal])) } };
}
