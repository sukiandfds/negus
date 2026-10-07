import { Activity, Archive, MessageCircle, X } from 'lucide-react';
import { EmployeeCapabilityPanel } from '../../../web-ui/src/features/employee-capabilities/components/EmployeeCapabilityPanel';
import { EmployeeGrowthPanel } from '../../../web-ui/src/features/employee-growth/components/EmployeeGrowthPanel';
import { UsageSummaryControl } from '../../../web-ui/src/features/usage-monitor/components/UsageSummaryControl';
import { IntelligenceEfficiencyControl } from '../../../web-ui/src/features/intelligence-efficiency/components/IntelligenceEfficiencyControl';
import { Avatar } from './Avatar';
import type { ConversationState, UsageState } from '../types';

type Props = { c: ConversationState; usage: UsageState; agentId: string; selectedName: string; onClose: () => void };

export function ConversationDetails({ c, usage, agentId, selectedName, onClose }: Props) {
  return <aside className="detail-panel" aria-label="对话详情"><header><h2>对话详情</h2><button className="icon-button" aria-label="关闭对话详情" onClick={onClose}><X size={18} /></button></header>
          <div className="profile-card"><Avatar name={selectedName} agentId={agentId} size="large" /><h3>{selectedName}</h3><span>{c.session?.title || '尚未选择对话'}</span></div>
          <div className="detail-stats"><span><MessageCircle size={15} />消息记录<strong>{c.session?.messageCount ?? '—'}</strong></span><span><Activity size={15} />连接状态<strong>{c.connected ? '已连接' : '正在连接'}</strong></span></div>
          <div className="detail-controls"><UsageSummaryControl currentModel={c.usageModel} models={c.models} snapshot={usage.snapshot} loading={usage.loading} error={usage.error} onRefresh={() => void usage.refresh(true)} /><IntelligenceEfficiencyControl /></div>
          {agentId && <><EmployeeCapabilityPanel employeeId={agentId} /><EmployeeGrowthPanel /></>}
          {!agentId && c.session && <button className="detail-action" disabled={c.archiveBusyIds.has(c.selectedId)} onClick={() => void (c.session?.archived ? c.unarchiveSession(c.selectedId) : c.archiveSession(c.selectedId))}><Archive size={16} />{c.session.archived ? '恢复对话' : '归档对话'}</button>}
        </aside>;
}
