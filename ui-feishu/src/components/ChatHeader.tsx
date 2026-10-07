import type { ReactNode } from 'react';
import { ArrowLeft, FileText, Files, MessageCircle, Plus } from 'lucide-react';
import type { ChatTab } from '../types';

export function ChatHeader({ avatar, title, subtitle, actions, onBack, tab = 'messages', onTabChange, fileCount = 0 }: {
  avatar: ReactNode; title: string; subtitle: string; actions?: ReactNode;
  onBack: () => void; tab?: ChatTab; onTabChange?: (tab: ChatTab) => void; fileCount?: number;
}) {
  return <header className="chat-header">
    <div className="chat-title-row">
      <button className="icon-button mobile-back" aria-label="返回消息列表" onClick={onBack}><ArrowLeft size={20} /></button>
      {avatar}
      <div className="chat-title"><h1>{title}</h1><span>{subtitle}</span></div>
      {actions && <div className="header-tools">{actions}</div>}
    </div>
    <nav className="chat-tabs" aria-label="对话内容">
      <button className={tab === 'messages' ? 'active' : ''} onClick={() => onTabChange?.('messages')}><MessageCircle size={14} />消息</button>
      <button disabled title="云文档暂未接入"><FileText size={14} />云文档</button>
      <button className={tab === 'files' ? 'active' : ''} disabled={!onTabChange} title={onTabChange ? undefined : '群聊文件页签暂未接入，附件可在消息中查看'} onClick={() => onTabChange?.('files')}><Files size={14} />文件{fileCount ? <span>{fileCount}</span> : null}</button>
      <button disabled title="扩展页签暂未接入" aria-label="添加页签"><Plus size={15} /></button>
    </nav>
  </header>;
}
