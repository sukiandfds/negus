import { createRoot } from 'react-dom/client';
import { Message } from '../shared/features/conversations/components/ConversationView';
import { ConversationComposer } from '../shared/features/conversations/components/ConversationComposer';
import { MessageTimeline } from '../shared/features/group-chat/components/MessageTimeline';
import { GroupComposer } from '../shared/features/group-chat/components/GroupComposer';
import { ChatSkin } from '../src/ChatSkin';
import '../shared/styles/tokens.css';
import '../shared/styles/global.css';
import '../src/style.css';

const date = '2026-11-04T12:00:00Z';
const messages = [
  { id: 'a', type: 'human', authorId: 'user', authorName: '我', text: '请检查这个问题。', createdAt: date, sequence: 1, attachments: [] },
  { id: 'b', type: 'agent', authorId: 'developer', agentId: 'developer', authorName: '技术研发', text: '已完成检查，结果正常。', createdAt: date, sequence: 2, attachments: [] },
  { id: 'c', type: 'agent', authorId: 'manager', agentId: 'manager', authorName: '运营管理', workId: 'pending', pending: true, text: '', createdAt: date, sequence: 3, attachments: [] },
] as any;
const background = new URLSearchParams(location.search).has('background');
const noop = async () => true;
createRoot(document.getElementById('root')!).render(<div className="feishu-app" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}><ChatSkin />
  <style>{'.background-messages { flex: 1; padding: 30px; } .background-content { width: min(var(--content-width), 100%); margin: 0 auto; } @media (max-width: 760px) { .background-messages { padding: 22px 15px 24px; } }'}</style>
  {background ? <div className="background-messages"><div className="background-content">
    <Message message={{ id: 'a', role: 'user', text: messages[0].text, createdAt: date, authorName: '我' } as any} onFork={noop} onEdit={() => {}} />
    <Message message={{ id: 'b', role: 'assistant', text: messages[1].text, createdAt: date, authorName: '技术研发' } as any} onFork={noop} onEdit={() => {}} />
  </div></div> : <div style={{ flex: 1, minHeight: 0 }}><MessageTimeline active roomId="fixture" messages={messages} currentMemberId="user" streaming={{}} localSendVersion={0} historyLoading={false} historyNavigation={{ version: 0, align: 'bottom' }} onLoadOlder={noop} onLoadNewer={noop} onReturnToLatest={noop} /></div>}
  {background ? <ConversationComposer {...({ connected: true, selected: true, archived: false, status: { active: false }, contextStatus: {}, shownModel: '', shownEffort: '', models: [], modelsLoading: false, modelChanging: false, modelError: '', onSend: noop, onQueue: noop, queueing: false, editingMessage: null, onCancelEdit: () => {}, onInterrupt: noop, onReview: noop, goal: null, goalBusy: false, goalError: '', goalResumePrompt: false, onDismissGoalResumePrompt: () => {}, onChangeGoalStatus: noop, onClearGoal: noop, onSetGoal: noop, onEditGoal: noop, onCompactContext: noop, onAutoCompactThresholdChange: noop, onModelChange: noop, onReasoningEffortChange: noop } as any)} /> : <GroupComposer disabled={false} error="" onSend={noop} onInterrupt={noop} />}
</div>);
