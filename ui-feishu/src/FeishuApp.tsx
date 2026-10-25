import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useProjectConversations } from '../shared/features/conversations/hooks/useProjectConversations';
import { useProjectDirectory } from '../shared/features/project-directory/hooks/useProjectDirectory';
import { UserInputDialog } from '../shared/features/conversations/components/UserInputDialog';
import { openAgentConversation } from '../shared/features/agent-sharing/navigation/openAgentConversation';
import { SettingsPage } from '../shared/features/settings/SettingsPage';
import { ShareConversationDialog } from '../shared/features/conversation-sharing/components/ShareConversationDialog';
import { useUsageMonitor } from '../shared/features/usage-monitor/hooks/useUsageMonitor';
import { useDeviceInfo } from '../shared/features/device/hooks/useDeviceInfo';
import { ChatSkin } from './ChatSkin';
import { AppRail } from './components/AppRail';
import { ConversationList } from './components/ConversationList';
import { ChatWorkspace } from './components/ChatWorkspace';
import { avatarColor } from './presentation';
import { buildConversationDirectory, byLatest } from './conversationDirectory';
import { usePinnedConversations, sortPinned } from './usePinnedConversations';
import { useGroupChats } from './useGroupChats';
import { usePageSnapshot } from './usePageSnapshot';
import { CreateGroupDialog } from './components/CreateGroupDialog';
import { GroupWorkspace } from './components/GroupWorkspace';
import type { ChatTab, Conversation, ConversationFilter, Section } from './types';

function readRoute() {
  const params = new URLSearchParams(location.search);
  return {
    view: params.get('view') || '',
    roomId: params.get('roomId') || '',
    agentId: params.get('agent') || params.get('employeeId') || '',
    hasChat: Boolean(params.get('thread') || params.get('roomId') || params.get('conversation') || params.get('agent') || params.get('employeeId')),
  };
}

export function FeishuApp() {
  const initialRoute = readRoute();
  const initialView = initialRoute.view;
  const c = useProjectConversations();
  const directory = useProjectDirectory(c.executionStatus, c.contextStatus);
  const page = usePageSnapshot(c, directory);
  const viewC = page.conversations;
  const viewDirectory = page.directory;
  const usage = useUsageMonitor(c.executionStatus);
  const device = useDeviceInfo(c.connected);
  const [section, setSection] = useState<Section>(initialView === 'employees' ? 'employees' : initialView === 'tasks' ? 'tasks' : 'messages');
  const groups = useGroupChats();
  const pins = usePinnedConversations();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [roomId, setRoomId] = useState(initialRoute.roomId);
  const [agentId, setAgentId] = useState(initialRoute.agentId);
  const [legacyGroup, setLegacyGroup] = useState(initialView === 'group');
  const singleChat = useRef(viewC);
  if (!roomId) singleChat.current = viewC;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [opening, setOpening] = useState('');
  const [openError, setOpenError] = useState('');
  const [details, setDetails] = useState(false);
  const [settings, setSettings] = useState(initialView === 'settings');
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<ChatTab>('messages');
  const [mobileChat, setMobileChat] = useState(initialRoute.hasChat);
  const [railOpen, setRailOpen] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const employee = viewDirectory.projects.find(p => p.employeeId === agentId);
  const autoOpenedAgent = useRef('');
  const selectedName = employee?.name || 'Negus 助手';
  const closeSettings = () => {
    const url = new URL(location.href);
    if (url.searchParams.get('view') === 'settings') {
      url.searchParams.delete('settings');
      url.searchParams.set('view', 'conversation');
      history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
    setSettings(false);
  };
  useEffect(() => {
    const navigate = () => {
      const next = readRoute();
      setRoomId(next.roomId);
      setAgentId(next.agentId);
      setLegacyGroup(next.view === 'group');
      setSettings(next.view === 'settings');
      if (next.view === 'employees') setSection('employees');
      else if (next.view === 'tasks') setSection('tasks');
      else if (next.view === 'group' || next.view === 'conversation' || next.agentId) setSection('messages');
      setTab('messages'); setDetails(false); setMobileChat(next.hasChat || next.view === 'group');
    };
    window.addEventListener('negus:navigate', navigate);
    window.addEventListener('popstate', navigate);
    return () => { window.removeEventListener('negus:navigate', navigate); window.removeEventListener('popstate', navigate); };
  }, []);
  useEffect(() => {
    if (!legacyGroup || roomId || !groups.rooms.length) return;
    const fallback = groups.rooms[0];
    setRoomId(fallback.id);
    const url = new URL(location.href);
    url.searchParams.set('view', 'group');
    url.searchParams.set('roomId', fallback.id);
    history.replaceState({}, '', `${url.pathname}${url.search}`);
  }, [groups.rooms, legacyGroup, roomId]);
  useEffect(() => {
    if (!agentId || new URLSearchParams(location.search).get('thread') || autoOpenedAgent.current === agentId) return;
    const target = viewDirectory.projects.find(project => project.employeeId === agentId);
    if (!target) return;
    autoOpenedAgent.current = agentId;
    void openAgentConversation({
      agentId,
      threadId: target.mainThreadId || '',
      conversationId: target.mainConversationId || '',
    }).catch(() => { autoOpenedAgent.current = ''; });
  }, [agentId, viewDirectory.projects]);
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
  const roster = useMemo(() => {
    const base = buildConversationDirectory(viewDirectory, viewC.sessions, viewC.archivedView, viewC.project?.root);
    if (viewC.archivedView) return base;
    const rooms: Conversation[] = groups.rooms.map(room => ({ id: `group:${room.id}`, kind: 'group', roomId: room.id, name: room.name, subtitle: viewDirectory.projects.find(project => project.projectId === room.projectId)?.name || '群聊', projectId: room.projectId, time: room.lastActivityAt }));
    return { ...base, all: [...base.all, ...rooms], projects: base.projects.map(project => {
      const children = [...(project.children || []), ...rooms.filter(room => room.projectId === project.projectId)].sort(byLatest);
      return { ...project, time: children[0]?.time || project.time, children };
    }).sort(byLatest) };
  }, [viewDirectory.projects, viewDirectory.statusByThread, viewDirectory.contextByThread, viewC.sessions, viewC.archivedView, viewC.project?.root, groups.rooms]);
  const visibleRoster = filter === 'employees' ? roster.employees : filter === 'projects' ? roster.projects : sortPinned(roster.all, pins.pinned);
  const selected = roster.all.find(v => v.threadId === viewC.selectedId);
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
  return <div className={`feishu-app ${mobileChat ? 'show-chat' : ''} ${railOpen ? 'rail-open' : ''}`} onTouchStart={event => {
    const touch = event.touches[0];
    swipeStart.current = !mobileChat && event.touches.length === 1 && window.matchMedia('(max-width:760px), (max-width:1100px) and (orientation:portrait)').matches && event.target instanceof Element && Boolean(event.target.closest('.message-list, .app-rail')) ? { x: touch.clientX, y: touch.clientY } : null;
  }} onTouchEnd={event => {
    const start = swipeStart.current;
    swipeStart.current = null;
    const touch = event.changedTouches[0];
    if (start && touch && Math.abs(touch.clientX - start.x) > Math.max(60, Math.abs(touch.clientY - start.y) * 2)) setRailOpen(touch.clientX > start.x);
  }} onTouchCancel={() => { swipeStart.current = null; }} style={{ '--agent-initial': JSON.stringify(selectedName.slice(0, 1)), '--agent-color': avatarColor(agentId) } as CSSProperties}>
    <ChatSkin />
    <AppRail section={section} connected={c.connected} open={railOpen && !mobileChat} onClose={() => setRailOpen(false)}
      onSearch={() => { setSection('messages'); setMobileChat(false); document.getElementById('conversation-search')?.focus(); }}
      onSectionChange={next => { setSection(next); setMobileChat(false); setFilter(next === 'employees' ? 'employees' : 'all'); setOpenError(''); }} onSettings={() => setSettings(true)} />
    <ConversationList c={viewC} section={section} query={query} filter={filter} onOpenNavigation={() => setRailOpen(true)}
      opening={opening} openError={openError} hasRoster={Boolean(roster.all.length)} initialReady={page.committed} visibleRoster={visibleRoster}
      onQueryChange={setQuery} onFilterChange={next => { setFilter(next); setSection('messages'); setOpenError(''); }} onRefresh={() => { void c.refresh(); void directory.refresh(undefined, true); void groups.refresh(); }}
      onCreate={create} onCreateGroup={() => setCreatingGroup(true)} pinned={pins.pinned} onTogglePin={pins.toggle} selectedRoomId={roomId} onOpen={item => void open(item)} />
    <div className="chat-surface" style={{ display: roomId ? 'none' : undefined }}><ChatWorkspace visible={mobileChat || window.innerWidth > 760} c={singleChat.current} usage={usage} initialReady={page.committed} tab={tab} setTab={setTab}
      details={details} setDetails={setDetails} agentId={agentId} selectedName={selectedName} selected={selected}
      onBack={() => setMobileChat(false)} onShare={() => setSharing(true)} /></div>
    {roomId && <GroupWorkspace key={roomId} room={groups.rooms.find(room => room.id === roomId) || { id: roomId, name: '群聊', projectId: '' }} projectName={directory.projects.find(project => project.projectId === groups.rooms.find(room => room.id === roomId)?.projectId)?.name || ''} onBack={() => setMobileChat(false)} />}
    {creatingGroup && <CreateGroupDialog directory={directory} onClose={() => setCreatingGroup(false)} onCreated={room => { setCreatingGroup(false); void groups.refresh(); setSection('messages'); setFilter('all'); void open({ id: `group:${room.id}`, name: room.name, subtitle: '群聊', kind: 'group', roomId: room.id }); }} />}
    <ShareConversationDialog open={sharing} title={c.session?.title || selectedName} onClose={() => setSharing(false)} />
    <UserInputDialog request={c.userInputRequest} busy={c.userInputBusy} error={c.userInputError} onSubmit={c.answerUserInput} />
    {settings && <div className="settings-overlay"><SettingsPage onClose={closeSettings} connected={c.connected} device={device} projectId={directory.projects.find(project => project.kind === 'personal')?.projectId || ''} projectRoot={c.project?.root || ''} /></div>}
  </div>;
}
