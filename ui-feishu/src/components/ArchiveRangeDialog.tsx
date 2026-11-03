import { useEffect, useRef, useState } from 'react';
import styles from '../../shared/features/conversations/components/ConversationActions.module.css';
import type { Conversation, ConversationState } from '../types';

const dateOf = (time?: string | null) => {
  const date = new Date(time || '');
  return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
};
const flatten = (items: Conversation[]): Conversation[] => items.flatMap(item => [item, ...flatten(item.children || [])]);

export function ArchiveRangeDialog({ items, archive, onClose }: { items: Conversation[]; archive: ConversationState['archiveSession']; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState(dateOf(new Date().toISOString()));
  const [confirmed, setConfirmed] = useState<Conversation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [result, setResult] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const matches = [...new Map(flatten(items).filter(item => item.threadId && !item.roomId && item.kind !== 'project'
    && !item.pending && dateOf(item.time) && dateOf(item.time) >= start && dateOf(item.time) <= end)
    .map(item => [item.threadId!, item])).values()];
  const submit = async () => {
    if (busy) return;
    if (!confirmed) { setConfirmed(matches); return; }
    setBusy(true);
    let success = 0, next = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(4, confirmed.length) }, async () => {
        while (next < confirmed.length) {
          const item = confirmed[next++];
          if (await archive(item.threadId!)) success++;
          setProcessed(value => value + 1);
        }
      }));
      setResult(`已归档${success}条，失败${confirmed.length - success}条。`);
    } catch (error) { setResult(`已归档${success}条。${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className={styles.dialog} aria-label="按时间归档" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><strong>按时间归档</strong></header>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {result ? <p role="status">{result}</p> : confirmed ? <p>确认归档{start}至{end}的共{confirmed.length}条对话吗？</p> : <>
        <p>按当前列表筛选结果的最后活动日期归档，包含起止当天。群聊不包含在内；运行中的对话沿用现有归档限制。</p>
        <label>开始日期<input aria-label="开始日期" type="date" required max={end} value={start} onChange={event => setStart(event.target.value)} /></label>
        <label>结束日期<input aria-label="结束日期" type="date" required min={start} value={end} onChange={event => setEnd(event.target.value)} /></label>
        <p>共{start && end && start <= end ? matches.length : 0}条对话</p>
      </>}
      <footer><button type="button" disabled={busy} onClick={onClose}>{result ? '关闭' : '取消'}</button>
        {!result && <button type="submit" disabled={busy || !start || !end || start > end || !(confirmed || matches).length}>{busy ? `已处理 ${processed}/${confirmed?.length || 0}` : confirmed ? '确认归档' : '下一步'}</button>}</footer>
    </form>
  </dialog>;
}
