import { useMemo, useState } from 'react';
import { Check, Files, PanelRight, Pencil, Share2, X } from 'lucide-react';
import { ConversationView } from '../../../web-ui/src/features/conversations/components/ConversationView';
import { ConversationComposer } from '../../../web-ui/src/features/conversations/components/ConversationComposer';
import { ContentRenderer } from '../../../web-ui/src/features/conversations/rendering/ContentRenderer';
import { ChatHeader } from './ChatHeader';
import { Avatar } from './Avatar';
import { ConversationDetails } from './ConversationDetails';
import { compactTime } from '../presentation';
import { taskNotice } from '../taskNotice';
import { TaskPanel } from './TaskPanel';
import type { ChatTab, Conversation, ConversationState, UsageState } from '../types';

type Props = {
  c: ConversationState; usage: UsageState;
  tab: ChatTab; setTab: (tab: ChatTab) => void;
  details: boolean; setDetails: (open: boolean) => void;
  agentId: string; selectedName: string; selected?: Conversation;
  onBack: () => void; onShare: () => void;
};

export function ChatWorkspace({ c, usage, tab, setTab, details, setDetails, agentId, selectedName, selected, onBack, onShare }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const displaySession = useMemo(() => c.session ? {
    ...c.session, messages: c.session.messages.map(taskNotice).map(m => ({ ...m, authorName: m.authorName || (m.role === 'user' ? '我' : selectedName) })),
  } : null, [c.session, selectedName]);
  const files = c.session?.messages.filter(m => m.blocks?.some(b => b.type !== 'markdown' && b.type !== 'options')) || [];
  const saveName = async () => {
    if (await c.renameSession(renameDraft.trim())) setRenaming(false);
  };
  return <section className="chat-workspace" aria-label="聊天工作区">
      <ChatHeader avatar={<Avatar name={selectedName} agentId={agentId} active={c.executionStatus.active} size="small" />}
        title={agentId ? selectedName : c.session?.title || selectedName}
        subtitle={`${agentId ? '工作伙伴' : '项目对话'}${selected?.agentId && !selected.main ? ` · ${selected.name}` : ''}`}
        onBack={onBack} tab={tab} onTabChange={setTab} fileCount={files.length}
        actions={<>
          <button className="icon-button" title="分享当前对话" aria-label="分享当前对话" disabled={!c.session} onClick={onShare}><Share2 size={17} /></button>
          <button className="icon-button" title="重命名对话" aria-label="重命名对话" disabled={!c.session} onClick={() => { setRenameDraft(c.session?.title || ''); setRenaming(true); }}><Pencil size={16} /></button>
          <button className={`icon-button ${details ? 'pressed' : ''}`} title="对话详情" aria-label="对话详情" aria-expanded={details} onClick={() => setDetails(!details)}><PanelRight size={17} /></button>
        </>} />
      {renaming && <form className="rename-bar" onSubmit={e => { e.preventDefault(); void saveName(); }}><input aria-label="对话名称" value={renameDraft} maxLength={120} onChange={e => setRenameDraft(e.target.value)} autoFocus /><button className="icon-button" aria-label="保存对话名称" disabled={!renameDraft.trim() || c.renaming}><Check size={17} /></button><button type="button" className="icon-button" aria-label="取消重命名" onClick={() => setRenaming(false)}><X size={17} /></button></form>}
      <TaskPanel key={c.selectedId || ''} threadId={c.selectedId || undefined} />
      <div className="chat-content-row">
        <div className="chat-primary">
          <div className="chat-messages" style={{ display: tab === 'messages' ? undefined : 'none' }}>
            <ConversationView session={displaySession} key={c.composerKey || 'conversation'} active={tab === 'messages'}
              completedGoal={c.goal?.status === 'complete' ? c.goal : null}
              loading={c.loadingSession} contentSyncState={c.contentSyncState} loadingOlder={c.loadingOlder}
              error={c.sessionError} listAvailable={!c.listError} streamingText={c.streamingText}
              executionStatus={c.executionStatus} contextStatus={c.contextStatus} onLoadOlder={c.loadOlder}
              onForkMessage={c.forkFromMessage} forkingMessageId={c.forkingMessageId} onEditMessage={c.beginEditMessage}
              editingMessageId={c.editingMessageId} onRetryMessage={c.retryPendingMessage} retryingMessageId={c.retryingMessageId} localSendVersion={c.localSendVersion} />
          </div>
          {tab === 'files' && <div className="content-panel"><div className="panel-title"><Files size={22} /><h2>对话文件</h2></div>{files.length ? files.map(m => <div className="file-row" key={m.id}><small>{compactTime(m.createdAt)}</small><ContentRenderer threadId={c.selectedId} message={{ ...m, blocks: m.blocks?.filter(b => b.type !== 'markdown' && b.type !== 'options') }} /></div>) : <div className="files-empty"><Files size={40} /><strong>此对话暂无附件</strong><span>聊天中发送或生成的文件会显示在这里</span></div>}</div>}
          <div className="chat-composer" style={{ display: tab === 'messages' ? undefined : 'none' }}>
            {!c.session?.readOnly && <ConversationComposer key={c.composerKey} connected={c.connected} selected={Boolean(c.selectedId)} archived={Boolean(c.session?.archived)}
              sending={c.sending} sendingSlow={c.sendingSlow} status={c.executionStatus} commentary={c.commentaryText} contextStatus={c.contextStatus}
              shownModel={c.visibleModel} shownEffort={c.visibleEffort} models={c.models} modelsLoading={c.modelsLoading} modelChanging={c.modelChanging} modelError={c.modelError}
              onSend={c.sendMessage} onQueue={c.queueMessage} queueing={c.queueBusy} queueItems={c.queueItems} queueError={c.queueError}
              onEditQueueItem={c.editQueueItem} onRemoveQueueItem={c.removeQueueItem} onMoveQueueItem={c.moveQueueItem} onRetryQueueItem={c.retryQueueItem} onSendQueueItem={c.sendQueueItem}
              editingMessage={c.editingMessage} onCancelEdit={c.cancelEditMessage} onInterrupt={c.interrupt} onReview={c.review}
              goal={c.goal} goalBusy={c.goalBusy} goalError={c.goalError} goalResumePrompt={c.goalResumePrompt} onDismissGoalResumePrompt={c.dismissGoalResumePrompt}
              onChangeGoalStatus={c.changeGoalStatus} onClearGoal={c.clearGoal} onSetGoal={c.setGoal} onEditGoal={c.editGoal}
              onCompactContext={c.compactContext} onAutoCompactThresholdChange={c.setAutoCompactThreshold} onModelChange={c.changeModel} onReasoningEffortChange={c.changeReasoningEffort} />}
          </div>
        </div>
        {details && <ConversationDetails c={c} usage={usage} agentId={agentId} selectedName={selectedName} onClose={() => setDetails(false)} />}
      </div>
    </section>;
}
