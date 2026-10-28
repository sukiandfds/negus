import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatWorkspace } from '../src/components/ChatWorkspace';
import { openAgentConversation } from '../shared/features/agent-sharing/navigation/openAgentConversation';
import '../src/style.css';

const messages = [
  { id: 'first', role: 'user', text: '第一条', createdAt: '2026-10-28T01:02:03Z', authorName: '研发员工', displaySourceAgentId: 'developer' },
  { id: 'middle', role: 'assistant', text: '跳过' },
  { id: 'last', role: 'assistant', text: '最后一条', blocks: [{ id: 'text', type: 'markdown', text: '最后一条' }, { id: 'image', type: 'image', source: '/image' }] },
  { id: 'file', role: 'user', text: '', blocks: [{ id: 'attachment', type: 'file', source: '/file', name: 'file.txt' }] },
];
const targets = ['source', 'target', 'employee', 'task', 'readonly', 'archived'].map(threadId => ({ id: threadId, threadId, name: threadId, subtitle: '项目', agentId: threadId === 'employee' || threadId === 'task' ? 'agent-one' : '', conversationId: threadId === 'task' ? 'task-conversation' : threadId === 'employee' ? 'employee-conversation' : '', session: { archived: threadId === 'archived', readOnly: false } }));
const ok = async () => true;
const noop = () => {};
let sendResult = true;
let submissions: unknown[] = [];

function Fixture() {
  const [threadId, setThreadId] = useState('source');
  const [tab, setTab] = useState<'messages' | 'files'>('messages');
  const [details, setDetails] = useState(false);
  const session = { threadId, title: threadId, source: 'codex', messages: threadId === 'source' ? messages : [], archived: false, readOnly: false };
  const executionStatus = { type: 'execution_status', threadId, turnId: '', phase: 'idle', active: false, activities: [], startedAt: null, label: '', detail: '', commentary: '', updatedAt: null };
  const contextStatus = { type: 'context_status', threadId, model: '', reasoningEffort: '', usedTokens: null, contextWindow: null, percentage: null, autoCompactThreshold: null, phase: 'idle', message: '', updatedAt: null };
  const send = async (text: string, attachments: unknown[]) => { submissions.push({ threadId, text, attachments }); return sendResult; };
  const c = { session, selectedId: threadId, composerKey: threadId, connected: true, executionStatus, contextStatus, queueItems: [], queueError: '', queueBusy: false,
    loadingSession: false, contentSyncState: 'stable', loadingOlder: false, sessionError: '', listError: '', streamingText: '', goal: null,
    visibleModel: '', visibleEffort: '', models: [], modelsLoading: false, modelChanging: false, modelError: '', editingMessage: null,
    editingMessageId: '', forkingMessageId: '', retryingMessageId: '', goalBusy: false, goalError: '', goalResumePrompt: false,
    removeQueueItem: ok, moveQueueItem: ok, retryQueueItem: ok, sendQueueItem: ok, loadOlder: async () => {}, forkFromMessage: ok,
    beginEditMessage: noop, retryPendingMessage: ok, sendMessage: send, queueMessage: send, cancelEditMessage: noop, interrupt: ok,
    review: ok, dismissGoalResumePrompt: noop, changeGoalStatus: ok, clearGoal: ok, setGoal: ok, editGoal: ok, compactContext: ok,
    setAutoCompactThreshold: ok, changeModel: ok, changeReasoningEffort: ok, renameSession: ok };
  (window as any).fixture = { select: setThreadId, fail: (value: boolean) => { sendResult = !value; }, submissions: () => submissions, clear: () => { submissions = []; } };
  return <><nav>{targets.map(item => <button key={item.id} onClick={() => setThreadId(item.id)}>打开 {item.id}</button>)}</nav>
    <div className="fixture-workspace show-chat"><ChatWorkspace visible c={c as any} usage={{} as any} initialReady tab={tab} setTab={setTab} details={details} setDetails={setDetails}
      agentId="" selectedName="助手" selected={targets.find(item => item.threadId === threadId) as any} onBack={noop} onShare={noop}
      targets={targets as any} onOpenTarget={async item => { if (item.agentId) await openAgentConversation({ agentId: item.agentId, threadId: item.threadId, conversationId: item.conversationId }); else history.pushState({}, '', `?thread=${item.threadId}`); setThreadId(item.threadId!); return true; }} /></div></>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
