import type { Conversation } from '../types';

export function ConversationOrigin({ origin, nativeSubagent }: Pick<Conversation, 'origin' | 'nativeSubagent'>) {
  return origin || nativeSubagent ? <span className="conversation-origin">{nativeSubagent ? 'Codex 子代理' : `来自${origin === 'assistant' ? '助手' : '用户'}`}</span> : null;
}
