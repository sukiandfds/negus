import { Bot, CalendarDays, CheckSquare, ChevronDown, ContactRound, FileText, Files, Grid2X2, Hash, MessageCircle, Search, Settings, Star, Video, type LucideIcon } from 'lucide-react';
import { Avatar } from './Avatar';
import type { Section } from '../types';

type Props = {
  section: Section;
  connected: boolean;
  onSearch: () => void;
  onSectionChange: (section: Section) => void;
  onSettings: () => void;
};

export function AppRail({ section, connected, onSearch, onSectionChange, onSettings }: Props) {
  const nav: { label: string; icon: LucideIcon; id?: Section }[] = [
    { label: '消息', icon: MessageCircle, id: 'messages' },
    { label: '工作伙伴', icon: Bot, id: 'employees' },
    { label: '任务', icon: CheckSquare, id: 'tasks' },
    { label: '云文档', icon: FileText }, { label: '视频会议', icon: Video },
    { label: '日历', icon: CalendarDays }, { label: '多维表格', icon: Grid2X2 },
    { label: '工作台', icon: Grid2X2 }, { label: '收藏', icon: Star },
    { label: '知识库', icon: Files }, { label: '通讯录', icon: ContactRound, id: 'employees' },
    { label: '应用中心', icon: Hash },
  ];
  return <aside className="app-rail" aria-label="功能导航">
      <div className="rail-profile"><Avatar name="N" /><span>Negus<small>我的工作空间</small></span><ChevronDown size={15} /></div>
      <button className="global-search" onClick={onSearch}><Search size={16} />搜索<span>⌘ K</span></button>
      <nav>{nav.map(({ label, icon: Icon, id }) => <button key={label} className={`rail-item ${id === section ? 'selected' : ''}`} title={id ? label : `${label} · 暂未接入`} disabled={!id}
        onClick={() => { if (id) onSectionChange(id); }}><Icon size={18} /><span>{label}</span></button>)}</nav>
      <div className="rail-bottom"><button className="rail-item" onClick={onSettings}><Settings size={18} />设置</button>
        <span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? '已连接' : '正在连接'}</span></div>
    </aside>;
}
