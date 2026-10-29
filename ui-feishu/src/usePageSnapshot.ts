import { useEffect, useRef, useState } from 'react';
import type { ConversationState, DirectoryState } from './types';
import { conversationReads } from '../shared/shared/state/conversationReads';
import { readConversationSnapshot, writeConversationSnapshot } from '../shared/features/conversations/data/conversationSnapshot';
import { isPendingThread } from '../shared/features/conversations/model/pendingThread';
import { mergeMessageList } from '../shared/features/conversations/state/conversationMerge';
import { readConversationBatches } from '../shared/features/conversations/state/conversationBatch';
import { idleStatus } from '../shared/features/execution/hooks/useCodexExecution';
import { emptyStatus } from '../shared/features/context-management/hooks/useContextManagement';
import { contextApi } from '../shared/features/context-management/data/contextApi';
import { executionApi } from '../shared/features/execution/data/executionApi';
import { goalApi } from '../shared/features/goals/data/goalApi';
import { followUpQueueApi } from '../shared/features/conversations/data/followUpQueueApi';
import { readModelDefaults, resolveVisibleModel, resolveVisibleEffort } from '../shared/features/models/model/modelDefaults';
import { buildConversationDirectory, byLatest } from './conversationDirectory';

const keys = ['session', 'executionStatus', 'contextStatus', 'visibleModel', 'visibleEffort', 'usageModel',
  'models', 'goal', 'queueItems', 'userInputRequest', 'streamingText', 'commentaryText'] as const;
type ThreadView = Pick<ConversationState, typeof keys[number]>;
const pick = (value: ConversationState): ThreadView => Object.fromEntries(keys.map(key => [key, value[key]])) as ThreadView;
const directoryView = (value: DirectoryState) => ({ projects: value.projects, statusByThread: value.statusByThread,
  contextByThread: value.contextByThread, goalByThread: value.goalByThread });

// Empty employee/project entries have no thread to read. Existing threads keep their batch snapshot.
const mergeProjects = (previous: DirectoryState['projects'], next: DirectoryState['projects'], good: Set<string>) => next.map(project => {
  const old = previous.find(item => item.id === project.id);
  const children = new Map((old?.conversations || []).filter(item => project.conversations?.some(next => next.id === item.id && Boolean(next.archived) === Boolean(item.archived))).map(item => [item.threadId || item.id, item]));
  for (const item of project.conversations || []) if (!item.threadId || good.has(item.threadId)) children.set(item.threadId || item.id, item);
  return { ...(old && project.mainThreadId && !good.has(project.mainThreadId) ? old : project),
    status: good.has(project.mainThreadId || '') ? project.status : old?.status,
    conversations: [...children.values()] };
});

// FEAT-001 2026-10-30: this is the sole display commit point, not another data reader.
// Source hooks own actions/protocol state; all remote display fields cross this batch boundary together.
export function usePageSnapshot(conversations: ConversationState, directory: DirectoryState) {
  const live = useRef({ conversations, directory });
  live.current = { conversations, directory };
  const [restored] = useState(readConversationSnapshot);
  // A missing cache must never borrow the previously selected conversation's metadata.
  const seed = (id: string, cache = conversations.cachedSessions): ThreadView => ({
    session: cache.get(id) || null, models: conversations.models,
    executionStatus: idleStatus(id), contextStatus: emptyStatus(id),
    visibleModel: cache.get(id)?.model || '', visibleEffort: '', usageModel: '',
    goal: null, queueItems: [], userInputRequest: null, streamingText: '', commentaryText: '',
    ...restored?.presentation?.[id],
  });
  const [shown, setShown] = useState(() => ({
    sessions: conversations.sessions, cachedSessions: new Map(conversations.cachedSessions),
    directory: directoryView(directory), project: conversations.project,
    threads: new Map<string, ThreadView>([...conversations.cachedSessions].filter(([id]) => id === conversations.selectedId || restored?.presentation?.[id]).map(([id, session]) => [id, { ...seed(id), session }])),
    errors: new Map<string, string>(), committed: false,
  }));
  const observed = useRef(new Map<string, string>());
  const running = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const archiveView = useRef(conversations.archivedView);
  if (archiveView.current !== conversations.archivedView) {
    archiveView.current = conversations.archivedView;
    observed.current.clear();
  }
  const [, wake] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const optimistic = useRef(new Map<string, ThreadView['session']>());
  const selectedId = conversations.selectedId;
  const seeds = useRef(new Map<string, ThreadView>());
  if (!seeds.current.has(selectedId)) seeds.current.set(selectedId, seed(selectedId, shown.cachedSessions));
  const selectedView = shown.threads.get(selectedId) || seeds.current.get(selectedId)!;
  const editRevision = useRef(conversations.historyEdit);
  useEffect(() => {
    if (editRevision.current === conversations.historyEdit) return;
    editRevision.current = conversations.historyEdit;
    const edit = conversations.historyEdit;
    if (!edit) return;
    controller.current?.abort();
    ++generation.current;
    observed.current.delete(edit.threadId);
    optimistic.current.delete(edit.threadId);
    setShown(previous => {
      const threads = new Map(previous.threads), cachedSessions = new Map(previous.cachedSessions);
      const detail = conversations.cachedSessions.get(edit.threadId);
      if (detail) cachedSessions.set(edit.threadId, detail);
      if (conversations.selectedId === edit.threadId) threads.set(edit.threadId, pick(conversations));
      return { ...previous, threads, cachedSessions };
    });
  }, [conversations.historyEdit]);
  // Keep locally submitted messages visible even after their native acknowledgement arrives mid-batch.
  const localMessages = conversations.session?.messages.filter(message => message.id.startsWith('optimistic-')) || [];
  if (conversations.session && localMessages.length) {
    const previous = optimistic.current.get(selectedId);
    optimistic.current.set(selectedId, { ...conversations.session,
      messages: mergeMessageList(previous?.messages || [], localMessages) });
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  useEffect(() => {
    if (running.current || !conversations.initialSyncReady || directory.loading) return;
    const c = conversations;
    const rows = buildConversationDirectory(directory, c.sessions, c.archivedView, c.project?.root, c.cachedSessions, c.archivedByThread).all.sort(byLatest);
    const entries = rows.filter(row => row.threadId && !row.pending && !isPendingThread(row.threadId)).map(row => {
      const id = row.threadId!;
      const session = c.cachedSessions.get(id);
      // Read/probe timestamps are not new content; comparing them would trigger the same read again.
      return { id, conversationId: row.conversationId || undefined, signature: JSON.stringify([
        row.name, row.time, row.preview, row.session, directory.statusByThread[id], directory.contextByThread[id],
        directory.goalByThread[id], session?.contentVersion,
        id === c.selectedId ? pick(c) : null,
      ], (key, value) => ['updatedAt', 'lastProbeAt', 'lastEventAt', 'eventEpoch', 'eventSeq', 'durationMs'].includes(key) ? undefined : value) };
    }).filter(entry => observed.current.get(entry.id) !== entry.signature);
    if (!entries.length) {
      const projects = mergeProjects(shown.directory.projects, directory.projects, new Set());
      if (!shown.committed || JSON.stringify(projects) !== JSON.stringify(shown.directory.projects)
        || shown.sessions.some(item => !c.sessions.some(next => next.threadId === item.threadId))) {
        setShown(previous => ({ ...previous, committed: true, project: c.project,
          directory: { ...previous.directory, projects },
          sessions: previous.sessions.filter(item => c.sessions.some(next => next.threadId === item.threadId)) }));
      }
      return;
    }
    running.current = true;
    const run = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    const ready = new Map<string, ThreadView>();
    // Membership and timeout are fixed. New source changes are noticed by the following run.
    void readConversationBatches(entries, async entry => {
      // Selected-thread hooks already read all its resources and receive live events.
      // Reuse those reads rather than launching six extra requests per progress event.
      if (entry.id === c.selectedId) {
        if (!await c.prefetchSession(entry.id, entry.conversationId)) throw new Error('对话同步失败，保留已有内容');
        await conversationReads.wait(new Set([entry.id]));
        await new Promise(resolve => window.setTimeout(resolve, 0));
        const latest = live.current.conversations;
        if (latest.selectedId === entry.id) {
          if (latest.sessionError || latest.modelError) throw new Error(latest.sessionError || latest.modelError);
          ready.set(entry.id, { ...pick(latest), session: latest.cachedSessions.get(entry.id) || null });
          return;
        }
      }
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]);
      const [loaded, context, status, goal, queue, input] = await Promise.all([
        c.prefetchSession(entry.id, entry.conversationId),
        contextApi.status(entry.id, signal, entry.conversationId),
        executionApi.status(entry.id, signal, false, entry.conversationId),
        goalApi.get(entry.id, signal, entry.conversationId),
        followUpQueueApi.list(entry.id, signal),
        executionApi.pendingUserInput(entry.id, signal, entry.conversationId),
      ]);
      if (!loaded) throw new Error('对话同步失败，保留已有内容');
      await conversationReads.wait(new Set([entry.id]));
      await new Promise(resolve => window.setTimeout(resolve, 0));
      const latest = live.current.conversations;
      const detail = latest.cachedSessions.get(entry.id) || null;
      const defaults = readModelDefaults();
      const model = resolveVisibleModel(latest.models, defaults, context.model, detail?.model || '');
      ready.set(entry.id, { session: detail, contextStatus: context, executionStatus: status, goal: goal.goal,
        queueItems: queue.items, userInputRequest: input.request, models: latest.models,
        visibleModel: model, visibleEffort: resolveVisibleEffort(latest.models, defaults, model, context.reasoningEffort),
        usageModel: model, streamingText: '', commentaryText: status.commentary || '' });
      if (latest.selectedId === entry.id) {
        if (latest.sessionError) throw new Error(latest.sessionError);
        ready.set(entry.id, { ...pick(latest), session: detail });
      }
    }, results => {
      if (!mounted.current || generation.current !== run) return;
      const source = { conversations: c, directory };
      const good = new Set(results.filter(result => !result.error).map(result => result.entry.id));
      for (const { entry, error } of results) {
        observed.current.set(entry.id, entry.signature);
        if (error) console.error('[negus:conversation-sync]', { threadId: entry.id, reason: error, at: new Date().toISOString() });
      }
      setShown(previous => {
        const cachedSessions = new Map(previous.cachedSessions);
        const threads = new Map(previous.threads);
        const errors = new Map(previous.errors);
        for (const { entry, error } of results) {
          if (error) { errors.set(entry.id, error); continue; }
          errors.delete(entry.id);
          const detail = ready.get(entry.id)?.session;
          if (detail) cachedSessions.set(entry.id, detail);
          const view = ready.get(entry.id);
          if (view) threads.set(entry.id, view);
          else if (threads.has(entry.id) && detail) threads.set(entry.id, { ...threads.get(entry.id)!, session: detail });
          const local = optimistic.current.get(entry.id);
          if (local && detail) {
            const remaining = local.messages.filter(message => !detail.messages.some(item => item.id === message.id || (message.submissionId && item.submissionId === message.submissionId)));
            if (remaining.length) optimistic.current.set(entry.id, { ...local, messages: remaining });
            else optimistic.current.delete(entry.id);
          }
        }
        const mergeRecord = <T,>(old: Record<string, T>, next: Record<string, T>) => ({ ...old,
          ...Object.fromEntries([...good].filter(id => id in next).map(id => [id, next[id]])) });
        const sessions = new Map(previous.sessions.filter(session => live.current.conversations.sessions.some(item => item.threadId === session.threadId)).map(session => [session.threadId, session]));
        for (const session of source.conversations.sessions) if (good.has(session.threadId) && live.current.conversations.sessions.some(item => item.threadId === session.threadId)) sessions.set(session.threadId, session);
        const projects = mergeProjects(previous.directory.projects, source.directory.projects, good);
        return { sessions: [...sessions.values()], cachedSessions, threads, errors, committed: true,
          project: source.conversations.project, directory: { projects,
            statusByThread: mergeRecord(previous.directory.statusByThread, { ...source.directory.statusByThread, ...Object.fromEntries([...ready].map(([id, view]) => [id, view.executionStatus])) }),
            contextByThread: mergeRecord(previous.directory.contextByThread, { ...source.directory.contextByThread, ...Object.fromEntries([...ready].map(([id, view]) => [id, view.contextStatus.phase])) }),
            goalByThread: mergeRecord(previous.directory.goalByThread, { ...source.directory.goalByThread, ...Object.fromEntries([...ready].map(([id, view]) => [id, view.goal])) }) } };
      });
    }, abort.signal).finally(() => {
      running.current = false;
      if (mounted.current) wake(value => value + 1);
    });
  });

  const frozen = selectedView;
  const local = optimistic.current.get(selectedId);
  const base = frozen.session;
  const session = local ? { ...(base || local), messages: mergeMessageList(base?.messages || [], local.messages) } : base;
  const pending = isPendingThread(selectedId);
  const error = shown.errors.get(selectedId) || '';
  const display = { ...conversations, ...(pending ? {} : frozen), session: pending ? conversations.session : session,
    project: shown.project, sessions: shown.sessions, cachedSessions: shown.cachedSessions,
    sessionError: error || conversations.sessionError,
    listError: conversations.listError || [...shown.errors].map(([id, message]) => `${id}：${message}`).join('；'),
    loadingSession: !session && conversations.loadingSession,
    refresh: () => { controller.current?.abort(); ++generation.current; observed.current.clear(); return conversations.refresh(); } };
  useEffect(() => {
    if (!shown.committed || !selectedId || !session || pending) return;
    writeConversationSnapshot({ selectedId, sessions: shown.sessions, session, cachedSessions: shown.cachedSessions,
      presentation: Object.fromEntries([...shown.threads].map(([id, { session: _session, models: _models, ...view }]) => [id, view])) });
  }, [shown, selectedId, session, pending]);
  return { committed: shown.committed, conversations: display, directory: { ...directory, ...shown.directory } };
}
