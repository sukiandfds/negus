import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useGroupRoom } from '../../../web-ui/src/features/group-chat/hooks/useGroupRoom';
import { MessageTimeline } from '../../../web-ui/src/features/group-chat/components/MessageTimeline';
import { GroupComposer } from '../../../web-ui/src/features/group-chat/components/GroupComposer';
import { MemberDialog } from '../../../web-ui/src/features/group-chat/components/MemberDialog';
import { MemberProfileDrawer } from '../../../web-ui/src/features/group-chat/components/MemberProfileDrawer';
import { useArtifacts } from '../../../web-ui/src/features/artifacts/hooks/useArtifacts';
import type { GroupMessage, GroupProfile } from '../../../web-ui/src/features/group-chat/model/types';
import type { ChatRoom } from '../useGroupChats';
import { ChatHeader } from './ChatHeader';
import { TaskPanel } from './TaskPanel';

export function GroupWorkspace({ room, projectName, onBack }: { room: ChatRoom; projectName: string; onBack: () => void }) {
  const group = useGroupRoom();
  const [profile, setProfile] = useState<GroupProfile | null>(null);
  const [quote, setQuote] = useState<GroupMessage['replyTo']>(null);
  const [mention, setMention] = useState<{ nonce: number; name: string } | null>(null);
  const [sent, setSent] = useState(0);
  useEffect(() => { group.selectRoom(room.id); setQuote(null); }, [room.id, group.selectRoom]);
  const snapshot = group.snapshot?.room.id === room.id ? group.snapshot : null;
  const artifacts = useArtifacts(snapshot?.messages.flatMap(message => message.artifactIds || []) || [], group.artifactEvent);
  return <section className="chat-workspace group-workspace" aria-label="群聊工作区">
    <ChatHeader avatar={<span className="avatar small" style={{ background: '#7465a6' }}><Users size={22} /></span>}
      title={room.name} subtitle={[projectName, `${snapshot?.agents.length || 0} 位员工`].filter(Boolean).join(' · ')} onBack={onBack} />
    <TaskPanel key={room.id} roomId={room.id} />
    {snapshot ? <div className="chat-primary"><div className="chat-messages"><MessageTimeline active={true} roomId={room.id} messages={snapshot.messages} agents={snapshot.agents} members={snapshot.members} currentMemberId={group.member?.id || ''} streaming={group.streaming} artifacts={artifacts.artifacts} artifactLoadErrors={artifacts.loadErrors} reviewingArtifactIds={artifacts.reviewingIds} reviewerName={group.member?.name || '我'} onRetryArtifact={artifacts.loadOne} onReviewArtifact={artifacts.review} onOpenProfile={setProfile} localSendVersion={sent} history={snapshot.history} historyLoading={group.historyLoading} historyNavigation={group.historyNavigation} focusRequest={group.focusRequest} onLoadOlder={group.loadOlder} onLoadNewer={group.loadNewer} onReturnToLatest={group.returnToLatest} onQuote={message => setQuote({ id: message.id, authorName: message.authorName, text: message.text.slice(0, 160), sequence: message.sequence })} onMentionAgent={agent => setMention({ nonce: Date.now(), name: agent.name })} onRevealReply={reply => { void group.revealMessage(reply); }} onRetryAgent={(agentId, replyTo) => { const agent = snapshot.agents.find(item => item.id === agentId); if (agent) void group.send(`@${agent.name} 请重试刚才没有完成的任务。`, [], replyTo || null); }} onRetrySend={message => { void group.retrySend(message); }} retryDisabled={group.sending} unseenLiveCount={group.unseenLiveCount} /></div>
      <div className="chat-composer"><GroupComposer agents={snapshot.agents} members={snapshot.members} disabled={!group.member || group.sending} busy={snapshot.agents.some(agent => agent.active)} error={group.error} notice={group.notice} quote={quote} mentionRequest={mention} onClearQuote={() => setQuote(null)} onSend={async (text, attachments, replyTo) => { const accepted = await group.send(text, attachments, replyTo); if (accepted) { setSent(version => version + 1); setQuote(null); } return accepted; }} onInterrupt={group.interrupt} /></div>
    </div> : <div className="list-empty">{group.error || '正在读取群聊…'}</div>}
    <MemberDialog initialName={group.member?.name || ''} open={!group.member && Boolean(snapshot)} onSubmit={group.join} />
    <MemberProfileDrawer profile={profile} roomId={room.id} onClose={() => setProfile(null)} onAgentUpdated={agent => setProfile({ kind: 'agent', profile: agent })} />
  </section>;
}
