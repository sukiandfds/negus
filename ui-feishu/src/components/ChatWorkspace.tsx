import { useMemo, useRef, useState } from 'react';
import { Check, Files, PanelRight, Pencil, Share2, X } from 'lucide-react';
import { FollowUpQueue } from '../../shared/features/conversations/components/FollowUpQueue';
import { ConversationView } from '../../shared/features/conversations/components/ConversationView';
import { ConversationComposer, type ConversationComposerHandle } from '../../shared/features/conversations/components/ConversationComposer';
import { ContentRenderer } from '../../shared/features/conversations/rendering/ContentRenderer';
import { ChatHeader } from './ChatHeader';
import { ConversationOrigin } from './ConversationOrigin';
import { Avatar } from './Avatar';
import { ConversationDetails } from './ConversationDetails';
import { compactTime, conversationStatus } from '../presentation';
import { taskNotice } from '../taskNotice';
import type { ChatTab, Conversation, ConversationState, UsageState } from '../types';

type Props = {
  visible: boolean;
  c: ConversationState; usage: UsageState;
  initialReady: boolean;
  tab: ChatTab; setTab: (tab: ChatTab) => void;
  details: boolean; setDetails: (open: boolean) => void;
  agentId: string; selectedName: string; selected?: Conversation;
  onBack: () => void; onShare: () => void;
};

export function ChatWorkspace({ visible, c, usage, initialReady, tab, setTab, details, setDetails, agentId, selectedName, selected, onBack, onShare }: Props) {
  const composerRef = useRef<ConversationComposerHandle>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const projectRoot = c.session?.cwd || selected?.session?.cwd || c.project?.root;
  const displaySession = useMemo(() => c.session ? {
    ...c.session, messages: c.session.messages.filter(m => !m.submissionId || !c.queueItems.some(item => m.submissionId === item.submissionId || m.submissionId === item.dispatchSubmissionId)).map(taskNotice).map(m => ({ ...m, authorName: m.authorName || (m.role === 'user' ? '我' : selectedName) })),
  } : null, [c.session, c.queueItems, selectedName]);
  const files = c.session?.messages.filter(m => m.blocks?.some(b => b.type !== 'markdown' && b.type !== 'options')) || [];
  const saveName = async () => {
    if (await c.renameSession(renameDraft.trim())) setRenaming(false);
  };
  return <section className="chat-workspace" aria-label="聊天工作区">
      <ChatHeader avatar={<Avatar name={selectedName} projectRoot={projectRoot} agentId={agentId} active={c.executionStatus.active} size="small" />}
        title={<><ConversationOrigin origin={selected?.origin} /><span>{agentId ? selectedName : selected?.name || c.session?.title || selectedName}</span></>}
        subtitle={selected?.label || conversationStatus(c.executionStatus, c.contextStatus.threadId === c.selectedId ? c.contextStatus.phase : undefined, projectRoot || '未关联')}
        onBack={onBack} tab={tab} onTabChange={setTab} fileCount={files.length}
        actions={<>
          <button className="icon-button" title="分享当前对话" aria-label="分享当前对话" disabled={!c.session} onClick={onShare}><Share2 size={17} /></button>
          <button className="icon-button" title="重命名对话" aria-label="重命名对话" disabled={!c.session} onClick={() => { setRenameDraft(c.session?.title || ''); setRenaming(true); }}><Pencil size={16} /></button>
          <button className={`icon-button ${details ? 'pressed' : ''}`} title="对话详情" aria-label="对话详情" aria-expanded={details} onClick={() => setDetails(!details)}><PanelRight size={17} /></button>
        </>} />
      {renaming && <form className="rename-bar" onSubmit={e => { e.preventDefault(); void saveName(); }}><input aria-label="对话名称" value={renameDraft} maxLength={120} onChange={e => setRenameDraft(e.target.value)} autoFocus /><button className="icon-button" aria-label="保存对话名称" disabled={!renameDraft.trim() || c.renaming}><Check size={17} /></button><button type="button" className="icon-button" aria-label="取消重命名" onClick={() => setRenaming(false)}><X size={17} /></button></form>}
      <div className="chat-content-row">
        <div className="chat-primary">
          <div className="chat-messages" style={{ display: tab === 'messages' ? undefined : 'none' }}>
            <ConversationView queue={c.queueItems.length || c.queueError ? <FollowUpQueue items={c.queueItems} busy={c.queueBusy} error={c.queueError}
              onEdit={item => composerRef.current?.editQueuedMessage(item, c.removeQueueItem) ?? Promise.resolve(false)} onRemove={c.removeQueueItem} onMove={c.moveQueueItem} onRetry={c.retryQueueItem} onSendNow={c.sendQueueItem} /> : null} session={displaySession} key={c.composerKey || 'conversation'} active={visible && tab === 'messages'}
              assistantName={selectedName} completedGoal={c.goal?.status === 'complete' ? c.goal : null}
              loading={c.loadingSession} contentSyncState={c.contentSyncState} loadingOlder={c.loadingOlder}
              error={c.sessionError} listAvailable={initialReady && !c.listError} streamingText={c.streamingText}
              executionStatus={c.executionStatus} contextStatus={c.contextStatus} onLoadOlder={c.loadOlder}
              onForkMessage={c.forkFromMessage} forkingMessageId={c.forkingMessageId} onEditMessage={c.beginEditMessage}
              onQuoteMessage={c.session?.readOnly ? undefined : message => composerRef.current?.quoteMessage(message)}
              editingMessageId={c.editingMessageId} onRetryMessage={c.retryPendingMessage} retryingMessageId={c.retryingMessageId} />
          </div>
          {tab === 'files' && <div className="content-panel"><div className="panel-title"><Files size={22} /><h2>对话文件</h2></div>{files.length ? files.map(m => <div className="file-row" key={m.id}><small>{compactTime(m.createdAt)}</small><ContentRenderer threadId={c.selectedId} message={{ ...m, blocks: m.blocks?.filter(b => b.type !== 'markdown' && b.type !== 'options') }} /></div>) : <div className="files-empty"><Files size={40} /><strong>此对话暂无附件</strong><span>聊天中发送或生成的文件会显示在这里</span></div>}</div>}
          <div className="chat-composer" style={{ display: tab === 'messages' ? undefined : 'none' }}>
            {!c.session?.readOnly && <ConversationComposer ref={composerRef} key={c.composerKey} connected={c.connected} selected={Boolean(c.selectedId)} archived={Boolean(c.session?.archived)}
              status={c.executionStatus} contextStatus={c.contextStatus}
              shownModel={c.visibleModel} shownEffort={c.visibleEffort} models={c.models} modelsLoading={c.modelsLoading} modelChanging={c.modelChanging} modelError={c.modelError}
              onSend={c.sendMessage} onQueue={c.queueMessage} queueing={c.queueBusy}
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
