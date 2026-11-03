import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationState, DirectoryState } from './types';
import { writeConversationSnapshot } from '../shared/features/conversations/data/conversationSnapshot';
import { isPendingThread } from '../shared/features/conversations/model/pendingThread';
import { readConversationBatches } from '../shared/features/conversations/state/conversationBatch';
import { type ThreadSnapshot } from '../shared/features/conversations/state/conversationStore';
import { readModelDefaults, resolveVisibleModel, resolveVisibleEffort } from '../shared/features/models/model/modelDefaults';
import { buildConversationDirectory } from './conversationDirectory';
import { latestMessagePreview } from './taskNotice';

// Empty employee/project entries have no thread to read. Existing threads keep their batch snapshot.
const mergeProjects = (previous: DirectoryState['projects'], next: DirectoryState['projects'], good: Set<string>) => next.map(project => {
  const old = previous.find(item => item.id === project.id);
  const children = new Map((old?.conversations || []).filter(item => project.conversations?.some(next => next.id === item.id && Boolean(next.archived) === Boolean(item.archived))).map(item => [item.threadId || item.id, item]));
  for (const item of project.conversations || []) if (!item.threadId || good.has(item.threadId)) children.set(item.threadId || item.id, item);
  return { ...(old && project.mainThreadId && !good.has(project.mainThreadId) ? old : project),
    status: good.has(project.mainThreadId || '') ? project.status : old?.status,
    conversations: [...children.values()] };
});

// FEAT-001: batch initial reads, then sync changed threads independently into the same store.
export function usePageSnapshot(conversations: ConversationState, directory: DirectoryState) {
  const c = conversations, store = c.store;
  const live = useRef({ conversations, directory });
  live.current = { conversations, directory };
  const [shown, setShown] = useState(() => ({ sessions: c.sessions.map((summary): typeof summary => {
    const cached = c.cachedSessions.get(summary.threadId);
    return { ...summary, cwd: summary.cwd ?? cached?.cwd, createdBy: summary.createdBy ?? cached?.createdBy,
      latestMessage: summary.latestMessage || cached?.latestMessage };
  }), projects: directory.projects, project: c.project, committed: false }));
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
  const revisionKey = JSON.stringify([...store.revisions]);
  const source = useMemo(() => JSON.stringify([c.sessions, directory.projects, revisionKey],
    (key, value) => ['updatedAt', 'lastProbeAt', 'lastEventAt', 'eventEpoch', 'eventSeq', 'durationMs'].includes(key) ? undefined : value),
  [c.sessions, directory.projects, revisionKey]);
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
    if (running.current || !c.initialSyncReady || directory.loading) return;
    const rows = buildConversationDirectory(directory, c.sessions, c.archivedView, c.project?.root, undefined, c.archivedByThread).all
      .filter(row => row.threadId && !row.pending && !isPendingThread(row.threadId));
    // URL/employee navigation can select a thread that has not reached the directory yet.
    if (c.selectedId && !isPendingThread(c.selectedId) && !rows.some(row => row.threadId === c.selectedId)) {
      rows.push({ id: c.selectedId, threadId: c.selectedId, name: '', subtitle: '' });
    }
    const entries = rows.map(row => {
      const id = row.threadId!, revision = store.revisions.get(id) || 0;
      return { id, revision, conversationId: row.conversationId || undefined,
        signature: JSON.stringify([row.name, row.time, row.preview, row.session, revision]) };
    }).filter(entry => observed.current.get(entry.id) !== entry.signature)
      .map((entry, index) => ({ ...entry, priority: index < 10 }));
    for (const id of store.errors.keys()) if (!rows.some(row => row.threadId === id)) store.errors.delete(id);
    for (const [id, read] of independentReads.current) {
      if (!rows.some(row => row.threadId === id)) {
        read.abort.abort(); independentReads.current.delete(id);
      }
    }
    if (!entries.length) {
      initialLoading.current = false;
      setSyncing(false);
      const projects = mergeProjects(shown.projects, directory.projects, new Set());
      if (!shown.committed || JSON.stringify(projects) !== JSON.stringify(shown.projects)
        || shown.sessions.some(item => !c.sessions.some(next => next.threadId === item.threadId))) {
        setShown(previous => ({ ...previous, committed: true, project: c.project, projects,
          sessions: previous.sessions.filter(item => c.sessions.some(next => next.threadId === item.threadId)) }));
      }
      return;
    }
    const synchronize = (batch: typeof entries, abort: AbortController, isCurrent: () => boolean, initial: boolean) => {
      const pendingPriority = new Set(batch.filter(entry => entry.priority).map(entry => entry.id));
      const candidate = new Map<string, ThreadSnapshot>();
      const earlyPublished = new Set<string>();
      const publish = (results: { entry: typeof entries[number]; error: string; retry?: boolean }[]) => {
        if (!mounted.current || abort.signal.aborted || !isCurrent()) return;
        const good = new Set(results.filter(result => !result.error).map(result => result.entry.id));
        for (const { entry, error, retry } of results) if (!error || !retry) pendingPriority.delete(entry.id);
        if (initial) setSyncing(pendingPriority.size > 0);
        for (const { entry, error, retry } of results) {
          if (retry) observed.current.delete(entry.id); else observed.current.set(entry.id, entry.signature);
          if (error) {
            store.finish(entry.id, error);
            console.error('[negus:conversation-sync]', { threadId: entry.id, reason: error, at: new Date().toISOString() });
          } else store.commit(entry.id, candidate.get(entry.id)!, entry.revision);
        }
        setShown(previous => {
          const current = live.current.conversations;
          const sessions = new Map(previous.sessions.filter(session => current.sessions.some(item => item.threadId === session.threadId)).map(session => [session.threadId, session]));
          for (const summary of current.sessions) if (good.has(summary.threadId)) {
            const detail = store.committed.get(summary.threadId)?.session;
            const latestMessage = latestMessagePreview(detail?.messages) || '';
            const { messages: _messages, sourceSignature: _signature, ...fields } = detail || { ...summary, messages: [], sourceSignature: undefined };
            sessions.set(summary.threadId, { ...summary, ...fields, updatedAt: summary.updatedAt, latestMessage });
          }
          return { sessions: [...sessions.values()], committed: true, project: current.project,
            projects: mergeProjects(previous.projects, live.current.directory.projects, good) };
        });
        store.notify();
      };
      const ordered = initial ? [...batch].sort((a, b) => Number(b.id === c.selectedId) - Number(a.id === c.selectedId)) : batch;
      return readConversationBatches(ordered, async (entry, signal) => {
        const cached = store.committed.get(entry.id)?.session;
        const reuse = Boolean(!store.freshBodies.has(entry.id) && cached?.sourceRevision);
        const view = await store.read(entry.id, reuse ? cached!.sourceRevision! : '', signal, entry.conversationId);
        if (signal.aborted) return;
        candidate.set(entry.id, view);
        // FEAT-001: only the open conversation bypasses the initial batch barrier.
        if (initial && entry.id === live.current.conversations.selectedId) {
          publish([{ entry, error: '' }]);
          earlyPublished.add(entry.id);
        }
      }, results => publish(results.filter(result => !earlyPublished.has(result.entry.id))), abort.signal, 10000, batch.filter(entry => entry.priority).length);
    };
    if (!initialLoading.current) {
      setSyncing(false);
      for (const entry of entries) {
        if (independentReads.current.has(entry.id)) continue;
        if (independentReads.current.size >= 4) break;
        const read = { abort: new AbortController() };
        independentReads.current.set(entry.id, read);
        void synchronize([entry], read.abort, () => independentReads.current.get(entry.id) === read, false).finally(() => {
          if (independentReads.current.get(entry.id) !== read) return;
          independentReads.current.delete(entry.id);
          if (mounted.current) wake(value => value + 1);
        });
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

  const selected = store.get(c.selectedId, false), session = selected.session;
  // FEAT-001: execution events render immediately, independently of history reads.
  const executionStatus = store.get(c.selectedId).executionStatus;
  const model = resolveVisibleModel(c.models, readModelDefaults(), selected.contextStatus.model, session?.model || '');
  const effort = resolveVisibleEffort(c.models, readModelDefaults(), model, selected.contextStatus.reasoningEffort);
  const states = [...store.committed];
  const display = { ...c, ...selected, session, executionStatus, goal: selected.goal || (c.goal?.status === 'complete' ? c.goal : null), visibleModel: model, visibleEffort: effort, usageModel: selected.executionStatus.active ? c.usageModel : model,
    streamingText: executionStatus.streamingText || '', commentaryText: executionStatus.commentary || '',
    syncing,
    project: shown.project, sessions: shown.sessions,
    sessionError: store.errors.get(c.selectedId) || c.sessionError,
    listError: c.listError || (store.errors.size ? `${store.errors.size} 个对话同步失败，保留已有内容；可刷新重试。` : ''),
    loadingSession: c.loadingSession,
    refresh: () => {
      controller.current?.abort(); ++generation.current; running.current = false; observed.current.clear(); cancelIndependent();
      return c.refresh();
    } };
  useEffect(() => {
    if (!shown.committed || isPendingThread(c.selectedId)) return;
    // FEAT-001: persist the same directory-backed summaries that the list displays.
    const sessions = buildConversationDirectory({ ...directory, projects: shown.projects }, shown.sessions,
      c.archivedView, shown.project?.root, c.cachedSessions, c.archivedByThread).all.flatMap(row => {
      if (!row.session || row.pending || isPendingThread(row.session.threadId)) return [];
      const { messages: _messages, sourceSignature: _signature, ...summary } = row.session as NonNullable<typeof session>;
      return [{ ...summary, latestMessage: row.preview }];
    });
    writeConversationSnapshot({ selectedId: c.selectedId, sessions, session, cachedSessions: c.cachedSessions,
      presentation: Object.fromEntries(states.map(([id, { session: _session, ...view }]) => [id, { ...view, visibleModel: '', visibleEffort: '', usageModel: '', streamingText: '', commentaryText: '' }])) });
  }, [shown, c.selectedId, store.getPersistSnapshot()]);
  return { committed: shown.committed, conversations: display, directory: { ...directory, projects: shown.projects,
    statusByThread: Object.fromEntries(states.map(([id, view]) => [id, view.executionStatus])),
    contextByThread: Object.fromEntries(states.map(([id, view]) => [id, view.contextStatus.phase])),
    goalByThread: Object.fromEntries(states.map(([id, view]) => [id, view.goal])) } };
}
