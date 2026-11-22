import { StatusPanel } from '../features/status-panel/StatusPanel';
import { Activity, Archive, MessageCircle, X } from 'lucide-react';
import { EmployeeCapabilityPanel } from '../../shared/features/employee-capabilities/components/EmployeeCapabilityPanel';
import { EmployeeGrowthPanel } from '../../shared/features/employee-growth/components/EmployeeGrowthPanel';
import { Avatar } from './Avatar';
import type { ConversationState } from '../types';

type Props = { c: ConversationState; agentId: string; selectedName: string; onClose: () => void };

export function ConversationDetails({ c, agentId, selectedName, onClose }: Props) {
  const information = <>
          <div className="detail-stats"><span><MessageCircle size={15} />消息记录<strong>{c.session?.messageCount ?? '—'}</strong></span><span><Activity size={15} />连接状态<strong>{c.connected ? '已连接' : '正在连接'}</strong></span></div>
          {c.contextStatus.lastSuccessfulSettings && <div className="detail-stats"><span>最后成功发送<strong>{c.contextStatus.lastSuccessfulSettings.providerName || c.contextStatus.lastSuccessfulSettings.modelProviderId || '当前配置'} · {c.contextStatus.lastSuccessfulSettings.model.split('::').at(-1)}</strong></span></div>}
  </>;
  if (!agentId) return <StatusPanel key={c.selectedId} thread={c.selectedId} revision={c.session?.threadId===c.selectedId ? c.session.sourceRevision||c.session.updatedAt : ''} connected={c.connected} status={c.executionStatus} context={c.contextStatus} goal={c.goal} onStop={c.interrupt} name={selectedName} onClose={onClose} controls={<>{information}
          {c.session && <button className="detail-action" disabled={c.archiveBusyIds.has(c.selectedId)} onClick={() => void (c.session?.archived ? c.unarchiveSession(c.selectedId) : c.archiveSession(c.selectedId))}><Archive size={16} />{c.session.archived ? '恢复对话' : '归档对话'}</button>}</>}/>;
  return <aside className="detail-panel" aria-label="对话详情"><header><h2>对话详情</h2><button className="icon-button" aria-label="关闭对话详情" onClick={onClose}><X size={18} /></button></header>
          <div className="profile-card"><Avatar name={selectedName} agentId={agentId} size="large" /><h3>{selectedName}</h3><span>{c.session?.title || '尚未选择对话'}</span></div>
          {information}
          {agentId && <><EmployeeCapabilityPanel employeeId={agentId} /><EmployeeGrowthPanel employeeId={agentId} /></>}

        </aside>;
}
