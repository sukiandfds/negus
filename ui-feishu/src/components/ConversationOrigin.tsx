import type { Conversation } from '../types';

export function ConversationOrigin({ origin }: Pick<Conversation, 'origin'>) {
  return origin ? <span className="conversation-origin">来自{origin === 'assistant' ? '助手' : '用户'}</span> : null;
}
