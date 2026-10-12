import { Archive, ListFilter, Plus, RefreshCw, Search, MessageCircle, Users } from 'lucide-react';
import { ConversationRows } from './ConversationRows';
import { DropdownMenu } from './DropdownMenu';
import type { ConversationSection } from '../useTaskConversations';
import type { Conversation, ConversationFilter, ConversationState, Section } from '../types';

type Props = {
  c: ConversationState;
  section: Section;
  query: string;
  filter: ConversationFilter;
  opening: string;
  openError: string;
  hasRoster: boolean;
  initialReady: boolean;
  visibleRoster: Conversation[];
  taskSections: ConversationSection[];
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: ConversationFilter) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onCreateGroup: () => void;
  pinned: ReadonlySet<string>;
  onTogglePin: (item: Conversation) => void;
  selectedRoomId: string;
  onOpen: (item: Conversation) => void;
};

export function ConversationList({ c, section, query, filter, opening, openError, hasRoster, initialReady, visibleRoster, taskSections, onQueryChange, onFilterChange, onRefresh, onCreate, onCreateGroup, pinned, onTogglePin, selectedRoomId, onOpen }: Props) {
  return <aside className="message-list" aria-label="员工、项目和任务对话列表">
      <header className="list-heading"><h2>{section === 'employees' ? '工作伙伴' : section === 'tasks' ? '任务' : '消息'}</h2><div>
        <button className="icon-button" title="刷新会话" aria-label="刷新会话" onClick={onRefresh}><RefreshCw size={16} /></button>
        <DropdownMenu label="添加" icon={<Plus size={19} />} items={[{ label: '新建对话', icon: <MessageCircle />, onClick: onCreate, disabled: c.creating }, { label: '创建群聊', icon: <Users />, onClick: onCreateGroup }]} /></div></header>
      <label className="list-search"><Search size={15} /><input id="conversation-search" placeholder="搜索联系人、对话" value={query} onChange={e => onQueryChange(e.target.value)} /></label>
      {section !== 'tasks' && <div className="list-filters">{([['all', '全部'], ['employees', '员工'], ['projects', '项目']] as const).map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => onFilterChange(id)}>{label}</button>)}
        <button className={`archive-filter ${c.archivedView ? 'active' : ''}`} title={c.archivedView ? '返回活动对话' : '查看已归档对话'} aria-label={c.archivedView ? '返回活动对话' : '查看已归档对话'} onClick={() => void c.setArchiveViewMode(!c.archivedView)}><Archive size={15} /></button></div>}
      <div className="contacts-scroll">
        {openError ? <div className="list-error" role="alert">{openError}</div> : null}
        {section === 'tasks' ? <>
          {initialReady && taskSections.map(group => <section className="task-conversation-section" key={group.title} aria-label={group.title}><h3>{group.title}<span>{group.items.length}</span></h3><ConversationRows items={group.items} c={c} opening={opening} query={query} onOpen={onOpen} /></section>)}
        </> : (initialReady || hasRoster) ? <ConversationRows items={visibleRoster} c={c} opening={opening} query={query} onOpen={onOpen} pinned={filter === 'all' ? pinned : undefined} onTogglePin={filter === 'all' ? onTogglePin : undefined} selectedRoomId={selectedRoomId} /> : null}

      </div>
      <footer className="list-footer"><ListFilter size={14} />{section === 'tasks' ? '任务对话' : c.archivedView ? '已归档对话' : '聊天'}<span>{section === 'tasks' ? taskSections.reduce((sum, group) => sum + group.items.length, 0) : visibleRoster.length}</span></footer>
    </aside>;
}
