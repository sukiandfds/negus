import { newerExecution, terminalExecution } from '../shared/features/conversations/state/conversationStore';
import { idleStatus } from '../shared/features/execution/hooks/useCodexExecution';
import { conversationStatus } from './presentation';
import { latestMessagePreview, visibleTaskPreview } from './taskNotice';
import type { DirectoryConversation, DirectoryProject, ProjectRuntimeStatus } from '../shared/features/project-directory/model/types';
import type { ConversationStore, ThreadSnapshot } from '../shared/features/conversations/state/conversationStore';
import type { Conversation, ConversationState, DirectoryState } from './types';

type Entry = DirectoryConversation & { role?: string; targetProjectId?: string | null };
export const byLatest = (a: Conversation, b: Conversation) => (Date.parse(b.time || '') || 0) - (Date.parse(a.time || '') || 0);
export const conversationKey = (item: Conversation) => item.roomId ? `group:${item.roomId}` : item.threadId || item.conversationId || item.id;
export const uniqueConversations = (items: Conversation[]) => [...new Map(items.map(item => [conversationKey(item), item])).values()].sort(byLatest);
export const snapshotStatusByThread = (store: Pick<ConversationStore, 'committed' | 'live' | 'get'>,
  _selectedId: string, projects: DirectoryState['projects']) => {
  const statuses: Record<string, ThreadSnapshot['executionStatus']> = {};
  const directoryStatus = new Map<string, ProjectRuntimeStatus>();
  for (const project of projects) for (const item of project.conversations || []) {
    if (item.threadId && item.status) {
      directoryStatus.set(item.threadId, item.status);
      if (terminalExecution(item.status)) statuses[item.threadId] = { ...idleStatus(item.threadId), ...item.status,
        phase: item.status.phase as ThreadSnapshot['executionStatus']['phase'], turnId: item.status.turnId || '' };
    }
  }
  for (const [id, view] of store.committed) {
    const status = view.executionStatus, directory = directoryStatus.get(id);
    if (!directory || (status.active && directory.active && status.turnId && directory.turnId === status.turnId)
      || (terminalExecution(status) && (newerExecution(status, directory)
        || (status.turnId && status.turnId === directory.turnId && !newerExecution(directory, status))))) statuses[id] = status;
  }
  for (const [id, patch] of store.live) {
    const status = patch.executionStatus, directory = directoryStatus.get(id);
    if (status && (!terminalExecution(directory) || !status.active || newerExecution(status, directory!))) statuses[id] = status;
  }
  return statuses;
};

// Directory metadata is authoritative; body loading only supplements messages.
export const mergeDirectoryProjects = (previous: DirectoryState['projects'], next: DirectoryState['projects']) => next.map(project => {
  const old = previous.find(item => item.id === project.id);
  const cached = new Map((old?.conversations || []).map(item => [item.threadId || item.id, item]));
  const children = new Map<string, DirectoryConversation>();
  for (const item of project.conversations || []) {
    const key = item.threadId || item.id;
    const previousItem = cached.get(key);
    children.set(key, previousItem ? { ...previousItem, ...item } : item);
  }
  return { ...old, ...project, conversations: [...children.values()] };
});

// Every view points to the same conversation identity and existing navigation route.
export function buildConversationDirectory(directory: DirectoryState, sessions: ConversationState['sessions'], archived: boolean, projectRoot = '', cachedSessions?: ConversationState['cachedSessions'], archivedByThread: Record<string, boolean> = {}) {
  const withPreview = (summary: typeof sessions[number]) => {
    const cached = cachedSessions?.get(summary.threadId);
    if (!cached) return summary;
    const preview = latestMessagePreview(cached.messages);
    const listedAt = summary.latestMessageAt || summary.updatedAt;
    return { ...summary, cwd: summary.cwd ?? cached.cwd, createdBy: summary.createdBy ?? cached.createdBy,
      ...(preview && (!visibleTaskPreview(summary.latestMessage) || !listedAt || Date.parse(preview.latestMessageAt || '') >= Date.parse(listedAt)) ? preview : {}) };
  };
  sessions = sessions.map(withPreview);
  const summaries = new Map(sessions.map(s => [s.threadId, s]));
  const activityTime = (id: string, time?: string | null) => {
    const compaction = directory.contextTimeByThread?.[id];
    return compaction && Date.parse(compaction) > (Date.parse(time || '') || 0) ? compaction : time;
  };
  const toConversation = (project: DirectoryProject, entry: Entry): Conversation => {
    const listed = summaries.get(entry.threadId || '');
    const cached = cachedSessions?.get(entry.threadId || '');
    const session = listed || (cached && withPreview(cached));
    const isTask = /^(task|handoff)-/.test(entry.conversationId || '');
    const sessionTime = session?.latestMessageAt || session?.updatedAt;
    const directoryTime = entry.latestMessageAt || (visibleTaskPreview(entry.latestMessage) ? entry.lastActivityAt : undefined);
    const directoryIsNewer = Boolean(directoryTime) && (!sessionTime || Date.parse(directoryTime!) > (Date.parse(sessionTime) || 0));
    const status = directory.statusByThread[entry.threadId || ''] || entry.status;
    return {
      id: entry.id, name: entry.main && project.employeeId ? project.name : entry.title || session?.title || entry.id,
      subtitle: project.name, agentId: project.employeeId, threadId: entry.threadId,
      conversationId: entry.conversationId, main: entry.main, pending: entry.pendingOpen,
      origin: isTask || entry.nativeSubagent ? 'assistant' : session?.createdBy || (session && !project.employeeId ? 'codex' : undefined),
      nativeSubagent: entry.nativeSubagent || session?.nativeSubagent,
      projectId: entry.targetProjectId || project.projectId || project.id,
      time: activityTime(entry.threadId || '', directoryIsNewer ? directoryTime : sessionTime || entry.lastActivityAt || entry.updatedAt),
      active: Boolean(status?.active), label: conversationStatus(status, directory.contextByThread[entry.threadId || '']),
      preview: (directoryIsNewer ? visibleTaskPreview(entry.latestMessage) : '') || session?.latestMessage, session,
    };
  };
  const all: Conversation[] = [];
  const employees: Conversation[] = [];
  const projects: Conversation[] = [];
  for (const project of directory.projects) {
    const entries = (project.conversations || []) as Entry[];
    const mainEntry = entries.find(entry => entry.main || entry.threadId === project.mainThreadId);
    const mainArchived = Boolean(mainEntry && (archivedByThread[mainEntry.threadId || ''] ?? mainEntry.archived));
    const available = entries.filter(entry => Boolean(archivedByThread[entry.threadId || ''] ?? entry.archived) === archived);
    const rows = available.filter(entry => entry.role !== 'project').map(entry => toConversation(project, entry));
    const groupRows = available.filter(entry => entry.role === 'project').map(entry => toConversation(project, entry));
    if (project.kind === 'employee') {
      if ((archived && !rows.length) || (!archived && mainArchived)) continue;
      const main = rows.find(row => row.main) || (!archived && !mainArchived ? toConversation(project, {
        id: `${project.id}:main`, title: project.name, main: true,
        threadId: project.mainThreadId, conversationId: project.mainConversationId,
        pendingOpen: !project.mainThreadId, status: project.status,
      }) : null);
      if (!main) continue;
      const mainActive = Boolean((directory.statusByThread[main.threadId || ''] || mainEntry?.status)?.active);
      const workRows = [...rows.filter(row => !row.main), ...groupRows];
      const activeWork = workRows.filter(row => row.active);
      const activeCount = Number(mainActive) + activeWork.length;
      const employee = {
        ...main,
        active: activeCount > 0,
        label: activeCount > 1 ? `正在进行 ${activeCount} 项工作`
          : mainActive ? '正在主对话工作'
            : groupRows.some(row => row.active) ? '正在群聊工作'
              : activeWork.length ? '正在处理后台任务' : '',
        time: (Date.parse(project.lastActivityAt || '') || 0) > (Date.parse(main.time || '') || 0) ? project.lastActivityAt : main.time,
        children: uniqueConversations([...rows.filter(row => !row.main), ...groupRows]),
      };
      employees.push(employee);
      const employeeRows = rows.map(row => row.main
        ? { ...row, active: employee.active, label: employee.label, time: employee.time }
        : row);
      all.push(...employeeRows);
      if (!employeeRows.some(row => conversationKey(row) === conversationKey(main)) && main.threadId) all.push(main);
    } else {
      all.push(...rows);
      const main = rows.find(row => row.main || row.threadId === project.mainThreadId);
      projects.push({ id: `project:${project.id}`, kind: 'project', name: project.name,
        subtitle: '项目', projectId: project.projectId || project.id, time: project.lastActivityAt,
        threadId: main?.threadId, conversationId: main?.conversationId, children: rows.filter(row => row !== main),
      });
    }
  }
  for (const session of sessions) {
    if (Boolean(archivedByThread[session.threadId] ?? session.archived) !== archived) continue;
    if (session.conversationKind === 'group' || all.some(row => row.threadId === session.threadId)) continue;
    all.push({ id: session.threadId, name: session.title || '未命名对话', subtitle: '项目对话',
      threadId: session.threadId, time: activityTime(session.threadId, session.latestMessageAt || session.updatedAt), session,
      origin: session.nativeSubagent ? 'assistant' : session.createdBy || 'codex', nativeSubagent: session.nativeSubagent,
      active: Boolean(directory.statusByThread[session.threadId]?.active),
      label: conversationStatus(directory.statusByThread[session.threadId], directory.contextByThread[session.threadId]), preview: session.latestMessage });
  }
  // Only explicit project bindings establish membership; employee membership alone is insufficient.
  for (const project of projects) {
    project.children = uniqueConversations([...(project.children || []), ...all.filter(row => row.projectId === project.projectId && row.threadId !== project.threadId)]);
    project.time = [project.time, ...project.children.map(row => row.time)].filter(Boolean).sort((a, b) => (Date.parse(b!) || 0) - (Date.parse(a!) || 0))[0];
  }
  return { all: uniqueConversations(all), employees: employees.sort(byLatest), projects: projects.sort(byLatest) };
}
