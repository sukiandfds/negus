import { useEffect, useRef, useState } from 'react';
import { Check, FolderKanban, MessageCircle, PanelRight, Pencil, Share2, UserRound, Users, X } from 'lucide-react';
import { useGroupRoom } from '../../shared/features/group-chat/hooks/useGroupRoom';
import { groupSessionMessage, MessageTimeline } from '../../shared/features/group-chat/components/MessageTimeline';
import { GroupComposer, type GroupComposerCopy } from '../../shared/features/group-chat/components/GroupComposer';
import type { GroupAgent, GroupMember, GroupMessage } from '../../shared/features/group-chat/model/types';
import { ForwardMessageDialog } from '../../shared/features/conversations/components/ForwardMessageDialog';
import { MessageSelectionBar } from '../../shared/features/conversations/components/MessageSelectionBar';
import { composeForwardedMessages } from '../../shared/features/conversations/state/forwardMessages';
import { postJson } from '../../shared/shared/api/http';
import { createClientId } from '../../shared/shared/id/clientId';
import { conversationKey } from '../conversationDirectory';
import type { ChatRoom } from '../useGroupChats';
import type { Conversation } from '../types';
import { ChatHeader } from './ChatHeader';

const feishuGroupComposerCopy: Partial<GroupComposerCopy> = {
  placeholder: '发送消息给运营管理；也可以 @ 指定员工',
  stopLabel: '停止群内全部任务',
  stopDetail: '终止群内正在运行和排队的任务',
};

function GroupDetails({ roomName, projectName, agents, members, messageCount, onClose }: {
  roomName: string;
  projectName: string;
  agents: GroupAgent[];
  members: GroupMember[];
  messageCount: number;
  onClose: () => void;
}) {
  return <aside className="detail-panel" aria-label="群聊详情">
    <header><h2>群聊详情</h2><button className="icon-button" aria-label="关闭群聊详情" onClick={onClose}><X size={18} /></button></header>
    <div className="profile-card"><span className="avatar large" style={{ background: '#7465a6' }}><Users size={28} /></span><h3>{roomName}</h3><span>群聊</span></div>
    <div className="detail-stats">
      <span><FolderKanban size={15} />所属项目<strong>{projectName || '未关联项目'}</strong></span>
      <span><Users size={15} />Agent<strong>{agents.length}</strong></span>
      <span><UserRound size={15} />成员<strong>{members.length}</strong></span>
      <span><MessageCircle size={15} />消息<strong>{messageCount}</strong></span>
    </div>
  </aside>;
}

export function GroupWorkspace({ room, projectName, forwardTargets = [], onOpenTarget, onBack, onShare, onRename }: {
  room: ChatRoom;
  projectName: string;
  forwardTargets?: Conversation[];
  onOpenTarget?: (target: Conversation) => Promise<boolean>;
  onBack: () => void;
  onShare: () => void;
  onRename: (name: string) => Promise<unknown>;
}) {
  const group = useGroupRoom(room.id);
  const [quote, setQuote] = useState<GroupMessage['replyTo']>(null);
  const [sent, setSent] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);
  const [selection, setSelection] = useState<{ roomId: string; ids: Set<string> } | null>(null);
  const [forwardDialog, setForwardDialog] = useState(false);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardError, setForwardError] = useState('');
  const forwardRequestRef = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    group.selectRoom(room.id);
  }, [room.id, group.selectRoom]);
  useEffect(() => {
    setQuote(null);
    setEditingMessage(null);
    setSelection(null);
    setForwardDialog(false);
    setForwardError('');
    setRenaming(false);
    setDetailsOpen(false);
  }, [room.id]);
  const snapshot = group.snapshot?.room.id === room.id ? group.snapshot : null;
  const selectedIds = selection?.roomId === room.id ? selection.ids : null;
  const roomName = room.name || snapshot?.room.name || '未命名群聊';
  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds || []);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelection({ roomId: room.id, ids: next });
  };
  const forward = async (target: Conversation) => {
    if (!snapshot || (!target.roomId && !target.threadId) || !selectedIds?.size || forwardBusy) return;
    const ids = [...selectedIds];
    const requestKey = JSON.stringify([room.id, conversationKey(target), ...ids]);
    if (forwardRequestRef.current?.key !== requestKey) {
      forwardRequestRef.current = { key: requestKey, id: createClientId("group-forward") };
    }
    setForwardBusy(true);
    setForwardError('');
    try {
      if (target.roomId) {
        const accepted = await group.forward(room.id, target.roomId, ids, forwardRequestRef.current.id);
        if (!accepted) {
          setForwardError(group.error || "转发失败，请重试");
          return;
        }
      } else {
        const composed = composeForwardedMessages(
          `${snapshot.room.name}（群聊）`,
          snapshot.messages.map(message => ({ id: message.id, message: groupSessionMessage(message, group.member?.id || '') })),
          selectedIds,
        );
        if (!composed.text) {
          setForwardError("选中的消息没有可转发文字");
          return;
        }
        await postJson("/api/session/message", {
          threadId: target.threadId,
          conversationId: target.conversationId || '',
          text: composed.text,
          attachmentIds: [],
          submissionId: forwardRequestRef.current.id,
        });
      }
      forwardRequestRef.current = null;
      setSelection(null);
      setForwardDialog(false);
      await onOpenTarget?.(target);
    } catch (reason) {
      setForwardError(reason instanceof Error ? reason.message : "转发失败，请重试");
    } finally {
      setForwardBusy(false);
    }
  };
  const saveName = async () => {
    const name = renameDraft.trim();
    if (!name || renameBusy) return;
    setRenameBusy(true);
    setRenameError('');
    try {
      await onRename(name);
      setRenaming(false);
    } catch (reason) {
      setRenameError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRenameBusy(false);
    }
  };
  return <section className="chat-workspace group-workspace" aria-label="群聊工作区">
    <ChatHeader avatar={<span className="avatar small" style={{ background: '#7465a6' }}><Users size={22} /></span>}
      title={roomName} subtitle={[projectName, `${snapshot?.agents.length || 0} 位员工`].filter(Boolean).join(' · ')} onBack={onBack}
      actions={<>
        <button className="icon-button" title="分享当前群聊" aria-label="分享当前群聊" onClick={onShare}><Share2 size={17} /></button>
        <button className="icon-button" title="重命名群聊" aria-label="重命名群聊" disabled={renameBusy} onClick={() => { setRenameDraft(roomName === '未命名群聊' ? '' : roomName); setRenameError(''); setRenaming(true); }}><Pencil size={16} /></button>
        <button className={`icon-button ${detailsOpen ? 'pressed' : ''}`} title="群聊详情" aria-label="群聊详情" aria-expanded={detailsOpen} disabled={!snapshot} onClick={() => setDetailsOpen(open => !open)}><PanelRight size={17} /></button>
      </>} />
    {renaming && <form className="rename-bar" onSubmit={event => { event.preventDefault(); void saveName(); }}>
      <input aria-label="群聊名称" value={renameDraft} maxLength={120} onChange={event => setRenameDraft(event.target.value)} autoFocus />
      <button className="icon-button" aria-label="保存群聊名称" disabled={!renameDraft.trim() || renameBusy}><Check size={17} /></button>
      <button type="button" className="icon-button" aria-label="取消重命名" disabled={renameBusy} onClick={() => setRenaming(false)}><X size={17} /></button>
    </form>}
    {renameError ? <p className="list-error" role="alert">{renameError}</p> : null}
    <div className="chat-content-row">
      <div className="chat-primary">
        {snapshot ? <><div className="chat-messages"><MessageTimeline active={true} roomId={room.id} messages={snapshot.messages} currentMemberId={group.member?.id || ''} streaming={group.streaming} localSendVersion={sent} history={snapshot.history} historyLoading={group.historyLoading} historyNavigation={group.historyNavigation} focusRequest={group.focusRequest} onLoadOlder={group.loadOlder} onLoadNewer={group.loadNewer} onReturnToLatest={group.returnToLatest} onQuote={message => setQuote({ id: message.id, authorName: message.authorName, text: message.text.slice(0, 160), sequence: message.sequence })} onEdit={message => { setEditingMessage(message); setQuote(null); }} editingMessageId={editingMessage?.id || ''} selectedMessages={selectedIds} onSelectMessage={toggleSelection} onRetry={group.retry} retryingMessageId={group.retryingMessageId} unseenLiveCount={group.unseenLiveCount} /></div>
          <div className="chat-composer">
            {selectedIds ? <MessageSelectionBar selectedCount={selectedIds.size} onForward={() => { setForwardError(''); setForwardDialog(true); }} onCancel={() => setSelection(null)} /> : null}
            <GroupComposer copy={feishuGroupComposerCopy} disabled={group.sending} busy={snapshot.agents.some(agent => agent.active)} error={group.error} notice={group.notice} quote={quote} editingMessage={editingMessage}
              onClearQuote={() => setQuote(null)} onCancelEdit={() => { setEditingMessage(null); setQuote(null); }}
              onSend={async (text, attachments, replyTo, finishUpload) => { const accepted = await group.send(text, attachments, replyTo, finishUpload); if (accepted) { setSent(version => version + 1); setQuote(null); } return accepted; }}
              onEdit={async (messageId, text) => {
                const target = editingMessage?.id === messageId ? editingMessage : null;
                if (!target) return false;
                const accepted = await group.edit(target, text);
                if (accepted) setEditingMessage(null);
                return accepted;
              }}
              onInterrupt={group.interrupt} />
          </div>
        </> : <div className="list-empty">{group.error || '正在读取群聊…'}</div>}
      </div>
      {detailsOpen && snapshot ? <GroupDetails roomName={roomName} projectName={projectName} agents={snapshot.agents} members={snapshot.members} messageCount={snapshot.messages.length} onClose={() => setDetailsOpen(false)} /> : null}
    </div>
    <ForwardMessageDialog open={forwardDialog} targets={forwardTargets} sourceId={room.id} busy={forwardBusy} error={forwardError}
      onClose={() => { if (!forwardBusy) setForwardDialog(false); }} onForward={target => void forward(target)} />
  </section>;
}
