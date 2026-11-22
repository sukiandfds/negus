import type { SessionMessage } from '../../../shared/features/conversations/model/types';
import { ContentRenderer } from '../../../shared/features/conversations/rendering/ContentRenderer';
import {usePanelRows} from './panelCache';

// Use the conversation's own renderer so previews and downloads retain their existing access checks.
export function WorkOutputs({ thread, turn, revision }: { thread: string; turn: string; revision:string }) {
  const {data:messages=[],error}=usePanelRows<SessionMessage>(thread,'outputs',revision,turn);
  if(error)return <p role="alert">读取产物失败：{error}</p>;
  return messages.length ? <section aria-label="本次产物"><h4>本次产物</h4>{messages.map(message=><ContentRenderer key={message.id} threadId={thread} message={message}/>)}</section> : null;
}
