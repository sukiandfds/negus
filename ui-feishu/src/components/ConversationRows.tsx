import { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Clock3, Pin, Users } from 'lucide-react';
import { ConversationActions } from './ConversationActions';
import { Avatar } from './Avatar';
import { compactTime } from '../presentation';
import { conversationKey } from '../conversationDirectory';
import { pinKey } from '../usePinnedConversations';
import type { Conversation, ConversationState } from '../types';

type Props = { items: Conversation[]; c: Pick<ConversationState, 'selectedId' | 'archivedView' | 'archiveBusyIds' | 'archiveSession' | 'unarchiveSession'>; opening: string; previews: Record<string, string>; query: string; onOpen: (item: Conversation) => void; pinned?: ReadonlySet<string>; onTogglePin?: (item: Conversation) => void; selectedRoomId?: string };

// Shared flat/tree rows for recent chats, employees, projects and task conversations.
export function ConversationRows({ items, c, opening, previews, query, onOpen, pinned, onTogglePin, selectedRoomId }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const matches = (item: Conversation): boolean => `${item.name} ${item.subtitle} ${item.preview || ''} ${previews[item.threadId || ''] || ''}`.toLowerCase().includes(query.toLowerCase()) || Boolean(item.children?.some(matches));
  const render = (item: Conversation) => {
    if (!matches(item)) return null;
    const key = item.taskId || (item.kind ? item.id : conversationKey(item));
    const isExpanded = expanded.has(key) || Boolean(query && item.children?.some(matches));
    const expandable = item.children !== undefined;
    return <div className="conversation-branch" key={key}>
      <div className={`contact-row ${expandable ? 'expandable' : ''} ${(item.roomId ? item.roomId === selectedRoomId : !selectedRoomId && item.threadId && item.threadId === c.selectedId) ? 'current' : ''}`}>
        <button className="contact-main" disabled={Boolean(opening)} onClick={() => onOpen(item)} aria-label={`打开${item.name}${item.main ? '单聊' : ''}`} aria-current={item.threadId && item.threadId === c.selectedId ? 'true' : undefined}>
          {item.kind ? <span className="avatar" aria-hidden="true" style={{ background: item.kind === 'project' ? '#54778b' : '#7465a6' }}>{item.kind === 'project' ? <Folder size={21} /> : item.kind === 'group' ? <Users size={21} /> : <Clock3 size={21} />}</span> : <Avatar name={item.name} agentId={item.agentId} active={item.active} />}
          <span className="contact-text"><span className="contact-top"><strong>{item.name}</strong>{item.main && <em>Agent</em>}{pinned?.has(pinKey(item)) && <Pin size={12} aria-label="已置顶" />}<time>{compactTime(item.time)}</time></span>
            <span className="contact-preview">{opening === item.id ? '正在进入…' : item.preview || (item.active ? item.label || '正在回复…' : previews[item.threadId || '']?.replace(/\s+/g, ' ') || item.session?.latestAssistant || item.session?.latestUser || (item.main ? '点击开始交流' : item.subtitle))}</span>
          </span>
        </button>
        {expandable && <button className="icon-button contact-expand" aria-label={`${isExpanded ? '折叠' : '展开'}${item.name}`} aria-expanded={isExpanded} onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>}
        {!expandable && (item.session || onTogglePin) && <ConversationActions session={item.session ? { ...item.session, title: item.name } : { threadId: item.threadId || item.id, title: item.name, source: 'codex', updatedAt: item.time || '', messageCount: null, latestUser: '', latestAssistant: '' }} pinOnly={!item.session} pinned={pinned?.has(pinKey(item))} onTogglePin={onTogglePin ? () => onTogglePin(item) : undefined} archived={c.archivedView} disabled={c.archiveBusyIds.has(item.threadId || '')} className="contact-more" onArchive={() => void (c.archivedView ? c.unarchiveSession(item.threadId!) : c.archiveSession(item.threadId!))} />}
      </div>
      {expandable && isExpanded && <div className="conversation-children" aria-label={`${item.name}的关联对话`}>{item.children!.length ? item.children!.map(render) : <p className="branch-empty">{item.main ? '暂无外派对话' : '暂无关联对话'}</p>}</div>}
    </div>;
  };
  return <>{items.some(matches) ? items.map(render) : <div className="list-empty">{query ? '没有匹配的对话' : '暂无对话'}</div>}</>;
}
