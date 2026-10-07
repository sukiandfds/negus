import type { DirectoryConversation, DirectoryProject } from '../../web-ui/src/features/project-directory/model/types';
import type { Conversation, ConversationState, DirectoryState } from './types';

type Entry = DirectoryConversation & { role?: string; targetProjectId?: string | null };
export const byLatest = (a: Conversation, b: Conversation) => (Date.parse(b.time || '') || 0) - (Date.parse(a.time || '') || 0);
export const conversationKey = (item: Conversation) => item.roomId ? `group:${item.roomId}` : item.threadId || item.conversationId || item.id;
export const uniqueConversations = (items: Conversation[]) => [...new Map(items.map(item => [conversationKey(item), item])).values()].sort(byLatest);

// Every view points to the same conversation identity and existing navigation route.
export function buildConversationDirectory(directory: DirectoryState, sessions: ConversationState['sessions'], archived: boolean) {
  const summaries = new Map(sessions.map(s => [s.threadId, s]));
  const toConversation = (project: DirectoryProject, entry: Entry): Conversation => {
    const session = summaries.get(entry.threadId || '');
    const status = directory.statusByThread[entry.threadId || ''] || entry.status;
    return {
      id: entry.id, name: entry.main && project.employeeId ? project.name : entry.title,
      subtitle: project.name, agentId: project.employeeId, threadId: entry.threadId,
      conversationId: entry.conversationId, main: entry.main, pending: entry.pendingOpen,
      projectId: entry.targetProjectId || project.projectId || project.id,
      time: entry.lastActivityAt || entry.updatedAt || session?.updatedAt,
      active: Boolean(status?.active), label: status?.label, session,
    };
  };
  const all: Conversation[] = [];
  const employees: Conversation[] = [];
  const projects: Conversation[] = [];
  for (const project of directory.projects) {
    const entries = (project.conversations || []) as Entry[];
    // Project group execution is outside this UI phase.
    const available = entries.filter(entry => entry.role !== 'project' && Boolean(entry.archived) === archived);
    const rows = available.map(entry => toConversation(project, entry));
    if (project.kind === 'employee') {
      if (archived) continue;
      const main = rows.find(row => row.main) || toConversation(project, {
        id: `${project.id}:main`, title: project.name, main: true,
        threadId: project.mainThreadId, conversationId: project.mainConversationId,
        pendingOpen: !project.mainThreadId, status: project.status,
      });
      employees.push({ ...main, time: project.lastActivityAt || main.time, children: uniqueConversations(rows.filter(row => !row.main)) });
      all.push(...rows);
      if (!rows.some(row => conversationKey(row) === conversationKey(main)) && main.threadId) all.push(main);
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
    if (session.conversationKind === 'group' || all.some(row => row.threadId === session.threadId)) continue;
    all.push({ id: session.threadId, name: session.title || '未命名对话', subtitle: '项目对话',
      threadId: session.threadId, time: session.updatedAt, session,
      active: Boolean(directory.statusByThread[session.threadId]?.active) });
  }
  // Only explicit project bindings establish membership; employee membership alone is insufficient.
  for (const project of projects) {
    project.children = uniqueConversations([...(project.children || []), ...all.filter(row => row.projectId === project.projectId && row.threadId !== project.threadId)]);
    project.time = [project.time, ...project.children.map(row => row.time)].filter(Boolean).sort((a, b) => (Date.parse(b!) || 0) - (Date.parse(a!) || 0))[0];
  }
  return { all: uniqueConversations(all), employees: employees.sort(byLatest), projects: projects.sort(byLatest) };
}
