import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationState, DirectoryState } from './types';
import { writeConversationSnapshot } from '../shared/features/conversations/data/conversationSnapshot';
import { isPendingThread } from '../shared/features/conversations/model/pendingThread';
import { readConversationBatches } from '../shared/features/conversations/state/conversationBatch';
import { withStreamingStatus, type ThreadSnapshot } from '../shared/features/conversations/state/conversationStore';
import { readModelDefaults, resolveVisibleModel, resolveVisibleEffort } from '../shared/features/models/model/modelDefaults';
import { buildConversationDirectory } from './conversationDirectory';
import { isVisibleTaskMessage } from './taskNotice';

// Empty employee/project entries have no thread to read. Existing threads keep their batch snapshot.
const mergeProjects = (previous: DirectoryState['projects'], next: DirectoryState['projects'], good: Set<string>) => next.map(project => {
  const old = previous.find(item => item.id === project.id);
  const children = new Map((old?.conversations || []).filter(item => project.conversations?.some(next => next.id === item.id && Boolean(next.archived) === Boolean(item.archived))).map(item => [item.threadId || item.id, item]));
  for (const item of project.conversations || []) if (!item.threadId || good.has(item.threadId)) children.set(item.threadId || item.id, item);
  return { ...(old && project.mainThreadId && !good.has(project.mainThreadId) ? old : project),
    status: good.has(project.mainThreadId || '') ? project.status : old?.status,
    conversations: [...children.values()] };
});

// FEAT-001: batch scheduling commits directly to the action store; it owns no detail cache.
export function usePageSnapshot(conversations: ConversationState, directory: DirectoryState) {
  const c = conversations, store = c.store;
  const live = useRef({ conversations, directory });
  live.current = { conversations, directory };
  const [shown, setShown] = useState(() => ({ sessions: c.sessions, projects: directory.projects, project: c.project, committed: false }));
  const observed = useRef(new Map<string, string>());
  const running = useRef(false), priorityPublished = useRef(false), activeSource = useRef('');
  const priorityIds = useRef(new Set<string>());
  const [syncing, setSyncing] = useState(true);
  const mounted = useRef(true), generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [wakeVersion, wake] = useState(0);
  const revisionKey = JSON.stringify([...store.revisions]);
  const source = useMemo(() => JSON.stringify([c.sessions, directory.projects, revisionKey],
    (key, value) => ['updatedAt', 'lastProbeAt', 'lastEventAt', 'eventEpoch', 'eventSeq', 'durationMs'].includes(key) ? undefined : value),
  [c.sessions, directory.projects, revisionKey]);
  const archiveView = useRef(c.archivedView);
  if (archiveView.current !== c.archivedView) { archiveView.current = c.archivedView; observed.current.clear(); }
  const editRevision = useRef(c.historyEdit);
  useEffect(() => {
    if (editRevision.current === c.historyEdit) return;
    editRevision.current = c.historyEdit;
    controller.current?.abort(); ++generation.current; running.current = false;
    if (c.historyEdit) observed.current.delete(c.historyEdit.threadId);
  }, [c.historyEdit]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);

  useEffect(() => {
    if (running.current && priorityPublished.current && activeSource.current !== source) {
      controller.current?.abort(); ++generation.current; running.current = false;
    }
    if (running.current || !c.initialSyncReady || directory.loading) return;
    const rows = buildConversationDirectory(directory, c.sessions, c.archivedView, c.project?.root, undefined, c.archivedByThread).all
      .filter(row => row.threadId && !row.pending && !isPendingThread(row.threadId));
    // URL/employee navigation can select a thread that has not reached the directory yet.
    if (c.selectedId && !isPendingThread(c.selectedId) && !rows.some(row => row.threadId === c.selectedId)) {
      rows.push({ id: c.selectedId, threadId: c.selectedId, name: '', subtitle: '' });
    }
    priorityIds.current = new Set(rows.slice(0, 10).map(row => row.threadId!));
    const entries = rows.map(row => {
      const id = row.threadId!, revision = store.revisions.get(id) || 0;
      return { id, revision, conversationId: row.conversationId || undefined, priority: priorityIds.current.has(id),
        sourceRevision: row.session?.sourceRevision || '', sourceSignature: row.session?.sourceRevision ? JSON.stringify(row.session) : '',
        signature: JSON.stringify([row.name, row.time, row.preview, row.session, revision]) };
    }).filter(entry => observed.current.get(entry.id) !== entry.signature);
    if (!entries.length) {
      setSyncing(false);
      const projects = mergeProjects(shown.projects, directory.projects, new Set());
      if (!shown.committed || JSON.stringify(projects) !== JSON.stringify(shown.projects)
        || shown.sessions.some(item => !c.sessions.some(next => next.threadId === item.threadId))) {
        setShown(previous => ({ ...previous, committed: true, project: c.project, projects,
          sessions: previous.sessions.filter(item => c.sessions.some(next => next.threadId === item.threadId)) }));
      }
      return;
    }
    running.current = true; activeSource.current = source; priorityPublished.current = false;
    const pendingPriority = new Set(entries.filter(entry => entry.priority).map(entry => entry.id));
    setSyncing(pendingPriority.size > 0);
    const run = ++generation.current, abort = new AbortController();
    controller.current = abort;
    const candidate = new Map<string, ThreadSnapshot>();
    void readConversationBatches(entries, async (entry, signal) => {
      const cached = store.committed.get(entry.id)?.session;
      const reuse = Boolean(!store.freshBodies.has(entry.id) && entry.sourceSignature && cached?.sourceSignature === entry.sourceSignature);
      const view = await store.read(entry.id, reuse ? entry.sourceRevision : '', signal, entry.conversationId);
      if (signal.aborted) return;
      candidate.set(entry.id, { ...view,
        session: view.session ? { ...view.session, sourceSignature: view.session.sourceRevision === entry.sourceRevision ? entry.sourceSignature : '' } : null });
    }, results => {
      if (!mounted.current || generation.current !== run) return;
      priorityPublished.current = true;
      const good = new Set(results.filter(result => !result.error).map(result => result.entry.id));
      for (const { entry, error, retry } of results) if (!error || !retry) pendingPriority.delete(entry.id);
      setSyncing(pendingPriority.size > 0);
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
          const last = detail?.messages.filter(isVisibleTaskMessage).at(-1);
          const latestMessage = last ? `${last.authorName || (last.role === 'user' ? '用户' : '助手')}：${last.text || '[附件]'}`.replace(/\s+/g, ' ').slice(0, 260) : '';
          const { messages: _messages, sourceSignature: _signature, ...fields } = detail || { ...summary, messages: [], sourceSignature: undefined };
          sessions.set(summary.threadId, { ...summary, ...fields, latestMessage });
        }
        return { sessions: [...sessions.values()], committed: true, project: current.project,
          projects: mergeProjects(previous.projects, live.current.directory.projects, good) };
      });
      store.notify();
    }, abort.signal, 10000, entries.filter(entry => entry.priority).length).finally(() => {
      if (generation.current !== run) return;
      running.current = false;
      if (mounted.current) wake(value => value + 1);
    });
  }, [source, wakeVersion, c.initialSyncReady, directory.loading, c.selectedId, c.archivedView, c.historyEdit, c.archivedByThread, c.project]);

  const selected = store.get(c.selectedId, false), session = selected.session;
  const executionStatus = withStreamingStatus(selected.executionStatus, c.executionStatus);
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
      controller.current?.abort(); ++generation.current; running.current = false; observed.current.clear();
      return c.refresh();
    } };
  useEffect(() => {
    if (!shown.committed || !c.selectedId || !session || isPendingThread(c.selectedId)) return;
    writeConversationSnapshot({ selectedId: c.selectedId, sessions: shown.sessions, session, cachedSessions: c.cachedSessions,
      presentation: Object.fromEntries(states.map(([id, { session: _session, ...view }]) => [id, { ...view, visibleModel: '', visibleEffort: '', usageModel: '', streamingText: '', commentaryText: '' }])) });
  }, [shown, c.selectedId, store.getPersistSnapshot()]);
  return { committed: shown.committed, conversations: display, directory: { ...directory, projects: shown.projects,
    statusByThread: Object.fromEntries(states.map(([id, view]) => [id, view.executionStatus])),
    contextByThread: Object.fromEntries(states.map(([id, view]) => [id, view.contextStatus.phase])),
    goalByThread: Object.fromEntries(states.map(([id, view]) => [id, view.goal])) } };
}
