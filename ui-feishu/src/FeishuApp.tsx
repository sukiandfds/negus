import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useProjectConversations } from '../../web-ui/src/features/conversations/hooks/useProjectConversations';
import { useProjectDirectory } from '../../web-ui/src/features/project-directory/hooks/useProjectDirectory';
import { UserInputDialog } from '../../web-ui/src/features/conversations/components/UserInputDialog';
import { openAgentConversation } from '../../web-ui/src/features/agent-sharing/navigation/openAgentConversation';
import { SettingsPage } from '../../web-ui/src/features/settings/SettingsPage';
import { ShareConversationDialog } from '../../web-ui/src/features/conversation-sharing/components/ShareConversationDialog';
import { useUsageMonitor } from '../../web-ui/src/features/usage-monitor/hooks/useUsageMonitor';
import { fetchJson } from '../../web-ui/src/shared/api/http';
import type { SessionDetail } from '../../web-ui/src/features/conversations/model/types';
import { ChatSkin } from './ChatSkin';
import { AppRail } from './components/AppRail';
import { ConversationList } from './components/ConversationList';
import { ChatWorkspace } from './components/ChatWorkspace';
import { avatarColor } from './presentation';
import { buildConversationDirectory, byLatest } from './conversationDirectory';
import { useTaskConversations } from './useTaskConversations';
import { usePinnedConversations, sortPinned } from './usePinnedConversations';
import { useGroupChats } from './useGroupChats';
import { CreateGroupDialog } from './components/CreateGroupDialog';
import { GroupWorkspace } from './components/GroupWorkspace';
import type { ChatTab, Conversation, ConversationFilter, Section } from './types';

export function FeishuApp() {
  const c = useProjectConversations();
  const directory = useProjectDirectory(c.executionStatus);
  const usage = useUsageMonitor(c.executionStatus);
  const [section, setSection] = useState<Section>('messages');
  const groups = useGroupChats();
  const pins = usePinnedConversations();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [roomId, setRoomId] = useState(new URLSearchParams(location.search).get('roomId') || '');
  const singleChat = useRef(c);
  if (!roomId) singleChat.current = c;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [opening, setOpening] = useState('');
  const [openError, setOpenError] = useState('');
  const [details, setDetails] = useState(false);
  const [settings, setSettings] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<ChatTab>('messages');
  const [mobileChat, setMobileChat] = useState(Boolean(new URLSearchParams(location.search).get('thread') || new URLSearchParams(location.search).get('roomId')));
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const agentId = new URLSearchParams(location.search).get('agent') || '';
  const employee = directory.projects.find(p => p.employeeId === agentId);
  const selectedName = employee?.name || 'Negus 助手';
  useEffect(() => {
    const navigate = () => { setRoomId(new URLSearchParams(location.search).get('roomId') || ''); setTab('messages'); setDetails(false); setMobileChat(true); };
    window.addEventListener('negus:navigate', navigate);
    window.addEventListener('popstate', navigate);
    return () => { window.removeEventListener('negus:navigate', navigate); window.removeEventListener('popstate', navigate); };
  }, []);
  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setSection('messages'); setMobileChat(false);
        requestAnimationFrame(() => document.getElementById('conversation-search')?.focus());
      }
    };
    window.addEventListener('keydown', search);
    return () => window.removeEventListener('keydown', search);
  }, []);
  useEffect(() => {
    if (c.session) setPreviews(prev => ({ ...prev, [c.session!.threadId]: c.session!.latestAssistant || c.session!.latestUser || '' }));
  }, [c.session?.threadId, c.session?.updatedAt, c.session?.latestAssistant]);
  const roster = useMemo(() => {
    const base = buildConversationDirectory(directory, c.sessions, c.archivedView);
    if (c.archivedView) return base;
    const rooms: Conversation[] = groups.rooms.map(room => ({ id: `group:${room.id}`, kind: 'group', roomId: room.id, name: room.name, subtitle: directory.projects.find(project => project.projectId === room.projectId)?.name || '群聊', projectId: room.projectId, time: room.lastActivityAt }));
    return { ...base, all: [...base.all, ...rooms], projects: base.projects.map(project => {
      const children = [...(project.children || []), ...rooms.filter(room => room.projectId === project.projectId)].sort(byLatest);
      return { ...project, time: children[0]?.time || project.time, children };
    }).sort(byLatest) };
  }, [directory.projects, directory.statusByThread, c.sessions, c.archivedView, groups.rooms]);
  const previewVersions = useRef(new Map<string, string>());
  const previewRequests = JSON.stringify(roster.all.filter(item => item.threadId).map(item => ({ threadId: item.threadId!, conversationId: item.conversationId, version: item.time || '' })));
  useEffect(() => {
    const controller = new AbortController();
    const queue = (JSON.parse(previewRequests) as { threadId: string; conversationId?: string; version: string }[]).filter(item => previewVersions.current.get(item.threadId) !== item.version);
    void Promise.allSettled(Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length && !controller.signal.aborted) {
        const item = queue.shift()!;
        const params = new URLSearchParams({ threadId: item.threadId, limit: '1' });
        if (item.conversationId) params.set('conversationId', item.conversationId);
        try {
          const session = await fetchJson<SessionDetail>(`/api/session?${params}`, controller.signal);
          if (controller.signal.aborted) return;
          previewVersions.current.set(item.threadId, item.version);
          setPreviews(previous => ({ ...previous, [item.threadId]: session.latestAssistant || session.latestUser || '' }));
        } catch { /* A missing preview does not prevent entering the real conversation. */ }
      }
    }));
    return () => controller.abort();
  }, [previewRequests]);
  const taskConversations = useTaskConversations(directory, roster.all, section === 'tasks');
  const visibleRoster = filter === 'employees' ? roster.employees : filter === 'projects' ? roster.projects : sortPinned(roster.all, pins.pinned);
  const selected = roster.all.find(v => v.threadId === c.selectedId);
  const open = async (item: Conversation) => {
    if (opening) return;
    if (item.roomId) {
      const url = new URL(location.href);
      for (const key of ['thread', 'agent', 'conversation', 'employee', 'employeeId', 'archived', 'managerProjectId', 'managerProjectTitle', 'managerProjectPhase', 'managerProjectGoal']) url.searchParams.delete(key);
      url.searchParams.set('roomId', item.roomId); url.searchParams.set('view', 'group');
      history.pushState({}, '', `${url.pathname}${url.search}`);
      window.dispatchEvent(new Event('negus:navigate'));
      setOpenError(''); return;
    }
    if (!item.threadId && item.kind) {
      setOpenError(item.kind === 'project' ? '此项目尚无总群聊，请展开查看已有对话。' : '此定期任务尚无关联对话，请展开查看执行记录。');
      return;
    }
    setOpening(item.id); setOpenError('');
    try {
      if (item.agentId) {
        const clean = new URL(location.href); clean.searchParams.delete('roomId'); history.replaceState({}, '', `${clean.pathname}${clean.search}`);
        await openAgentConversation({ agentId: item.agentId, threadId: item.pending ? '' : item.threadId, conversationId: item.pending ? '' : item.conversationId });
      } else if (item.threadId) {
        const url = new URL(location.href);
        for (const key of ['roomId', 'agent', 'conversation', 'employee', 'employeeId', 'managerProjectId', 'managerProjectTitle', 'managerProjectPhase', 'managerProjectGoal']) url.searchParams.delete(key);
        url.searchParams.set('thread', item.threadId); url.searchParams.set('view', 'conversation');
        history.pushState({}, '', `${url.pathname}${url.search}`);
        window.dispatchEvent(new Event('negus:navigate'));
      }
      setTab('messages'); setMobileChat(true); setDetails(false);
    } catch (reason) { setOpenError(reason instanceof Error ? reason.message : '暂时无法进入对话'); }
    finally { setOpening(''); }
  };
  const create = () => {
    const root = directory.projects.find(p => p.kind === 'personal')?.root || c.project?.root || '';
    const url = new URL(location.href);
    for (const key of ['roomId', 'agent', 'conversation', 'thread', 'employee', 'employeeId', 'managerProjectId', 'managerProjectTitle', 'managerProjectPhase', 'managerProjectGoal']) url.searchParams.delete(key);
    url.searchParams.set('view', 'conversation'); history.pushState({}, '', `${url.pathname}${url.search}`);
    c.openNewSession(root, '', '', { deferred: true }); setRoomId(''); setMobileChat(true); setSection('messages'); setTab('messages');
  };
  return <div className={`feishu-app ${mobileChat ? 'show-chat' : ''}`} style={{ '--agent-initial': JSON.stringify(selectedName.slice(0, 1)), '--agent-color': avatarColor(agentId) } as CSSProperties}>
    <ChatSkin />
    <AppRail section={section} connected={c.connected}
      onSearch={() => { setSection('messages'); setMobileChat(false); document.getElementById('conversation-search')?.focus(); }}
      onSectionChange={next => { setSection(next); setMobileChat(false); setFilter(next === 'employees' ? 'employees' : 'all'); setOpenError(''); }} onSettings={() => setSettings(true)} />
    <ConversationList c={c} directory={directory} section={section} query={query} filter={filter}
      opening={opening} openError={openError} hasRoster={Boolean(roster.all.length)} visibleRoster={visibleRoster} previews={previews}
      taskSections={taskConversations.sections} taskError={taskConversations.error} tasksLoading={taskConversations.loading}
      onQueryChange={setQuery} onFilterChange={next => { setFilter(next); setSection('messages'); setOpenError(''); }} onRefresh={() => { void c.refresh(); void directory.refresh(undefined, true); void groups.refresh(); if (section === 'tasks') taskConversations.refresh(); }}
      onCreate={create} onCreateGroup={() => setCreatingGroup(true)} pinned={pins.pinned} onTogglePin={pins.toggle} selectedRoomId={roomId} onOpen={item => void open(item)} />
    <div className="chat-surface" style={{ display: roomId ? 'none' : undefined }}><ChatWorkspace c={singleChat.current} usage={usage} tab={tab} setTab={setTab}
      details={details} setDetails={setDetails} agentId={agentId} selectedName={selectedName} selected={selected}
      onBack={() => setMobileChat(false)} onShare={() => setSharing(true)} /></div>
    {roomId && <GroupWorkspace key={roomId} room={groups.rooms.find(room => room.id === roomId) || { id: roomId, name: '群聊', projectId: '' }} projectName={directory.projects.find(project => project.projectId === groups.rooms.find(room => room.id === roomId)?.projectId)?.name || ''} onBack={() => setMobileChat(false)} />}
    {creatingGroup && <CreateGroupDialog directory={directory} onClose={() => setCreatingGroup(false)} onCreated={room => { setCreatingGroup(false); void groups.refresh(); setSection('messages'); setFilter('all'); void open({ id: `group:${room.id}`, name: room.name, subtitle: '群聊', kind: 'group', roomId: room.id }); }} />}
    <ShareConversationDialog open={sharing} title={c.session?.title || selectedName} onClose={() => setSharing(false)} />
    <UserInputDialog request={c.userInputRequest} busy={c.userInputBusy} error={c.userInputError} onSubmit={c.answerUserInput} />
    {settings && <div className="settings-overlay"><SettingsPage onClose={() => setSettings(false)} /></div>}
  </div>;
}
