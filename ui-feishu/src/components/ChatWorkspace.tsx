import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Files, PanelRight, Pencil, Share2, X } from 'lucide-react';
import { FollowUpQueue } from '../../shared/features/conversations/components/FollowUpQueue';
import { ConversationView, type ConversationViewHandle } from '../../shared/features/conversations/components/ConversationView';
import { ConversationComposer, type ConversationComposerHandle } from '../../shared/features/conversations/components/ConversationComposer';
import { ContentRenderer } from '../../shared/features/conversations/rendering/ContentRenderer';
import { ChatHeader } from './ChatHeader';
import { ConversationOrigin } from './ConversationOrigin';
import { Avatar } from './Avatar';
import { ConversationDetails } from './ConversationDetails';
import { compactTime, conversationStatus } from '../presentation';
import { isInternalTaskResult, isVisibleTaskMessage } from '../taskNotice';
import type { ChatTab, Conversation, ConversationState, UsageState } from '../types';
import { conversationApi } from '../../shared/features/conversations/data/conversationApi';
import dialogStyles from '../../shared/features/conversations/components/ConversationActions.module.css';

type Props = {
  visible: boolean;
  c: ConversationState; usage: UsageState;
  initialReady: boolean;
  tab: ChatTab; setTab: (tab: ChatTab) => void;
  details: boolean; setDetails: (open: boolean) => void;
  agentId: string; selectedName: string; selected?: Conversation;
  onBack: () => void; onShare: () => void;
  targets: Conversation[]; onOpenTarget: (item: Conversation) => Promise<boolean>;
};

export function ChatWorkspace({ visible, c, usage, initialReady, tab, setTab, details, setDetails, agentId, selectedName, selected, onBack, onShare, targets, onOpenTarget }: Props) {
  const composers = useRef(new Map<string, { threadId: string; state: ConversationState }>());
  const composerRefs = useRef(new Map<string, ConversationComposerHandle>());
  const viewRef = useRef<ConversationViewHandle>(null);
  const [selection, setSelection] = useState<{ threadId: string; ids: Set<string> } | null>(null);
  const [forwardDialog, setForwardDialog] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [forwardError, setForwardError] = useState('');
  const [forwardBusy, setForwardBusy] = useState(false);
  const [pendingForward, setPendingForward] = useState<{ threadId: string; text: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const currentThread = useRef(c.selectedId);
  currentThread.current = c.selectedId;
  const selectedIds = selection?.threadId === c.selectedId ? selection.ids : null;
  const composerKey = [...composers.current.entries()].find(([, entry]) => entry.threadId === c.selectedId)?.[0] || c.composerKey || c.selectedId;
  if (c.selectedId && c.session?.threadId === c.selectedId && !c.session.readOnly) composers.current.set(composerKey, { threadId: c.selectedId, state: c });
  const activeComposer = () => composerRefs.current.get(composerKey);
  useEffect(() => {
    if (forwardDialog) dialogRef.current?.showModal();
  }, [forwardDialog]);
  useEffect(() => {
    if (!pendingForward || pendingForward.threadId !== c.selectedId || c.loadingSession) return;
    if (c.sessionError && c.session?.threadId !== c.selectedId) {
      setForwardError('无法读取目标对话，未填入转发内容');
      setPendingForward(null);
      return;
    }
    if (c.session?.threadId !== c.selectedId) return;
    if (c.session.archived || c.session.readOnly || !c.connected) {
      setForwardError('目标对话不可发送，未填入转发内容');
      setPendingForward(null);
      return;
    }
    const composer = activeComposer();
    if (c.executionStatus.threadId !== c.selectedId) return;
    if (c.executionStatus.phase === 'recovering' || c.executionStatus.phase === 'unknown') {
      setForwardError('目标对话暂不可发送，未填入转发内容');
      setPendingForward(null);
      return;
    }
    if (!composer) return;
    if (!composer.insertForward(pendingForward.text)) setForwardError('请先处理输入框中的草稿，再转发消息');
    else setSelection(null);
    setPendingForward(null);
  }, [pendingForward, c.selectedId, c.session, c.sessionError, c.loadingSession, c.connected, c.executionStatus.threadId, c.executionStatus.phase]);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const projectRoot = c.session?.cwd || selected?.session?.cwd || c.project?.root;
  const displaySession = useMemo(() => c.session ? {
    ...c.session, messages: c.session.messages.filter(m => isVisibleTaskMessage(m) && (!m.submissionId || !c.queueItems.some(item => m.submissionId === item.submissionId || m.submissionId === item.dispatchSubmissionId))).map(m => ({ ...m, authorName: m.authorName || (m.role === 'user' ? '我' : selectedName) })),
  } : null, [c.session, c.queueItems, selectedName]);
  const files = c.session?.messages.filter(m => m.blocks?.some(b => b.type !== 'markdown' && b.type !== 'options')) || [];
  const saveName = async () => {
    if (await c.renameSession(renameDraft.trim())) setRenaming(false);
  };
  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds || []);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelection({ threadId: c.selectedId, ids: next });
  };
  const forward = async () => {
    const sourceId = c.selectedId;
    const target = targets.find(item => item.threadId === targetId);
    const composed = viewRef.current?.composeForward(`${selected?.subtitle || '对话'} / ${selected?.name || c.session?.title || selectedName} (${sourceId})`, selectedIds || new Set());
    if (!target?.threadId || !composed?.text || !c.connected) return;
    setForwardBusy(true); setForwardError('');
    try {
      const session = await conversationApi.session(target.threadId, {}, undefined, target.conversationId || '');
      if (currentThread.current !== sourceId) throw new Error('来源对话已变化，请重新选择消息');
      if (!('messages' in session) || session.threadId !== target.threadId || session.archived || session.readOnly || target.pending) throw new Error('目标对话不可发送或已归档');
      const existing = [...composers.current.entries()].find(([, entry]) => entry.threadId === target.threadId);
      if (existing && composerRefs.current.get(existing[0])?.hasDraft()) throw new Error('请先处理输入框中的草稿，再转发消息');
      setPendingForward({ threadId: target.threadId, text: composed.text });
      if (!await onOpenTarget(target)) {
        setPendingForward(null);
        throw new Error('无法打开目标对话，未填入转发内容');
      }
      setForwardDialog(false);
    } catch (error) {
      setForwardError(error instanceof Error ? error.message : '无法打开目标对话');
    } finally { setForwardBusy(false); }
  };
  return <section className="chat-workspace" aria-label="聊天工作区">
      <ChatHeader avatar={<Avatar name={selectedName} projectRoot={projectRoot} agentId={agentId} active={c.executionStatus.active && c.executionStatus.phase !== 'submitted'} size="small" />}
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
            <ConversationView ref={viewRef} selectedMessages={selectedIds} onSelectMessage={toggleSelection} queue={c.queueItems.length || c.queueError ? <FollowUpQueue items={c.queueItems} isHidden={item => isInternalTaskResult(item.text)} busy={c.queueBusy} error={c.queueError}
              onEdit={item => activeComposer()?.editQueuedMessage(item, c.removeQueueItem) ?? Promise.resolve(false)} onRemove={c.removeQueueItem} onMove={c.moveQueueItem} onRetry={c.retryQueueItem} onSendNow={c.sendQueueItem} /> : null} session={displaySession} key={c.composerKey || 'conversation'} active={visible && tab === 'messages'}
              assistantName={selectedName} completedGoal={c.goal?.status === 'complete' ? c.goal : null}
              loading={c.loadingSession} contentSyncState={c.contentSyncState} loadingOlder={c.loadingOlder}
              error={c.sessionError} listAvailable={initialReady && !c.listError} streamingText={c.streamingText}
              executionStatus={c.executionStatus} contextStatus={c.contextStatus} onLoadOlder={c.loadOlder}
              onForkMessage={c.forkFromMessage} forkingMessageId={c.forkingMessageId} onEditMessage={c.beginEditMessage}
              onQuoteMessage={c.session?.readOnly ? undefined : message => activeComposer()?.quoteMessage(message)}
              editingMessageId={c.editingMessageId} onRetryMessage={c.retryPendingMessage} retryingMessageId={c.retryingMessageId} />
          </div>
          {tab === 'files' && <div className="content-panel"><div className="panel-title"><Files size={22} /><h2>对话文件</h2></div>{files.length ? files.map(m => <div className="file-row" key={m.id}><small>{compactTime(m.createdAt)}</small><ContentRenderer threadId={c.selectedId} message={{ ...m, blocks: m.blocks?.filter(b => b.type !== 'markdown' && b.type !== 'options') }} /></div>) : <div className="files-empty"><Files size={40} /><strong>此对话暂无附件</strong><span>聊天中发送或生成的文件会显示在这里</span></div>}</div>}
          <div className="chat-composer" style={{ display: tab === 'messages' ? undefined : 'none' }}>
            {selectedIds && <div className="message-selection-bar"><button type="button" disabled={!selectedIds.size} onClick={() => { setTargetId(''); setForwardError(''); setForwardDialog(true); }}>转发消息 ({selectedIds.size})</button><button type="button" onClick={() => setSelection(null)}>取消</button></div>}
            {forwardError && !forwardDialog ? <p role="alert">{forwardError}</p> : null}
            {[...composers.current.entries()].map(([key, entry]) => <div key={key} style={{ display: key === composerKey && !c.session?.readOnly ? undefined : 'none' }}>
              <ConversationComposer ref={instance => { if (instance) composerRefs.current.set(key, instance); else composerRefs.current.delete(key); }} connected={entry.state.connected} selected={Boolean(entry.state.selectedId)} archived={Boolean(entry.state.session?.archived)}
              status={entry.state.executionStatus} contextStatus={entry.state.contextStatus}
              shownModel={entry.state.visibleModel} shownEffort={entry.state.visibleEffort} models={entry.state.models} modelsLoading={entry.state.modelsLoading} modelChanging={entry.state.modelChanging} modelError={entry.state.modelError}
              onSend={entry.state.sendMessage} onQueue={entry.state.queueMessage} queueing={entry.state.queueBusy}
              editingMessage={entry.state.editingMessage} onCancelEdit={entry.state.cancelEditMessage} onInterrupt={entry.state.interrupt} onReview={entry.state.review}
              goal={entry.state.goal} goalBusy={entry.state.goalBusy} goalError={entry.state.goalError} goalResumePrompt={entry.state.goalResumePrompt} onDismissGoalResumePrompt={entry.state.dismissGoalResumePrompt}
              onChangeGoalStatus={entry.state.changeGoalStatus} onClearGoal={entry.state.clearGoal} onSetGoal={entry.state.setGoal} onEditGoal={entry.state.editGoal}
              onCompactContext={entry.state.compactContext} onAutoCompactThresholdChange={entry.state.setAutoCompactThreshold} onModelChange={entry.state.changeModel} onReasoningEffortChange={entry.state.changeReasoningEffort} />
            </div>)}
          </div>
        </div>
        {details && <ConversationDetails c={c} usage={usage} agentId={agentId} selectedName={selectedName} onClose={() => setDetails(false)} />}
      </div>
      {forwardDialog && createPortal(<dialog ref={dialogRef} className={dialogStyles.dialog} aria-label="转发消息" onCancel={event => { event.preventDefault(); if (!forwardBusy) setForwardDialog(false); }}>
        <header><strong>转发消息</strong><button type="button" aria-label="关闭" disabled={forwardBusy} onClick={() => setForwardDialog(false)}><X /></button></header>
        <p>仅转发文字，附件不会转发。</p>
        <label>目标对话<select aria-label="目标对话" value={targetId} disabled={forwardBusy} onChange={event => setTargetId(event.target.value)}>
          <option value="">选择目标对话</option>
          {targets.filter(item => item.threadId && item.threadId !== c.selectedId && !item.roomId && !item.pending && !item.session?.archived && !item.session?.readOnly).map(item => <option key={item.threadId} value={item.threadId || ''}>{item.subtitle} · {item.name}</option>)}
        </select></label>
        {forwardError ? <p role="alert" className={dialogStyles.error}>{forwardError}</p> : null}
        <footer><button type="button" disabled={!targetId || forwardBusy} onClick={() => void forward()}>转发</button><button type="button" disabled={forwardBusy} onClick={() => setForwardDialog(false)}>取消</button></footer>
      </dialog>, document.body)}
    </section>;
}
