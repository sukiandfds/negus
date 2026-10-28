import { Archive, CheckSquare, Square, ListFilter, Menu, Plus, RefreshCw, Search, MessageCircle, Users } from 'lucide-react';
import { ConversationRows } from './ConversationRows';
import { DropdownMenu } from './DropdownMenu';
import type { Conversation, ConversationFilter, ConversationState, Section } from '../types';

type Props = {
  c: ConversationState;
  section: Section;
  query: string;
  filter: ConversationFilter;
  origins: string[];
  onOriginsChange: (origins: string[]) => void;
  opening: string;
  openError: string;
  hasRoster: boolean;
  initialReady: boolean;
  visibleRoster: Conversation[];
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: ConversationFilter) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onCreateGroup: () => void;
  pinned: ReadonlySet<string>;
  onTogglePin: (item: Conversation) => void;
  selectedRoomId: string;
  onOpen: (item: Conversation) => void;
  onOpenNavigation: () => void;
};

export function ConversationList({ c, section, query, filter, origins, onOriginsChange, opening, openError, hasRoster, initialReady, visibleRoster, onQueryChange, onFilterChange, onRefresh, onCreate, onCreateGroup, pinned, onTogglePin, selectedRoomId, onOpen, onOpenNavigation }: Props) {
  return <aside className="message-list" aria-label="员工、项目和任务对话列表">
      <header className="list-heading"><button className="icon-button mobile-navigation" aria-label="打开功能菜单" onClick={onOpenNavigation}><Menu size={21} /></button><h2>{section === 'employees' ? '工作伙伴' : section === 'tasks' ? '任务' : '消息'}</h2><div>
        <button className="icon-button" title="刷新会话" aria-label="刷新会话" onClick={onRefresh}><RefreshCw size={16} /></button>
        <DropdownMenu label="添加" icon={<Plus size={19} />} items={[{ label: '新建对话', icon: <MessageCircle />, onClick: onCreate, disabled: c.creating }, { label: '创建群聊', icon: <Users />, onClick: onCreateGroup }]} /></div></header>
      <label className="list-search"><Search size={15} /><input id="conversation-search" placeholder="搜索联系人、对话" value={query} onChange={e => onQueryChange(e.target.value)} /></label>
      {section !== 'tasks' && <div className="list-filters"><DropdownMenu label="筛选会话" title="展示会话" align="start" icon={<ListFilter size={15} />} items={[
        { label: '全部会话', icon: origins.length === 3 ? <CheckSquare size={15} /> : <Square size={15} />, checked: origins.length === 3, onClick: () => onOriginsChange(origins.length === 3 ? [] : ['user', 'assistant', 'employee']) },
        ...([['user', '来自用户'], ['assistant', '来自助手'], ['employee', '员工会话']] as const).map(([id, label]) => ({ label, icon: origins.includes(id) ? <CheckSquare size={15} /> : <Square size={15} />, checked: origins.includes(id), onClick: () => onOriginsChange(origins.includes(id) ? origins.filter(value => value !== id) : [...origins, id]) })),
      ]} />{([['all', '全部'], ['employees', '员工'], ['projects', '项目'], ['background', '后台']] as const).map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => onFilterChange(id)}>{label}</button>)}
        <button className={`archive-filter ${c.archivedView ? 'active' : ''}`} title={c.archivedView ? '返回活动对话' : '查看已归档对话'} aria-label={c.archivedView ? '返回活动对话' : '查看已归档对话'} onClick={() => void c.setArchiveViewMode(!c.archivedView)}><Archive size={15} /></button></div>}
      <div className="contacts-scroll">
        {openError ? <div className="list-error" role="alert">{openError}</div> : null}
        {(initialReady || hasRoster) ? <ConversationRows items={visibleRoster} c={c} opening={opening} query={query} onOpen={onOpen} pinned={filter === 'all' || filter === 'background' ? pinned : undefined} onTogglePin={filter === 'all' || filter === 'background' ? onTogglePin : undefined} selectedRoomId={selectedRoomId} /> : null}

      </div>
      <footer className="list-footer"><ListFilter size={14} />{c.archivedView ? '已归档对话' : '聊天'}<span>{visibleRoster.length}</span></footer>
    </aside>;
}
