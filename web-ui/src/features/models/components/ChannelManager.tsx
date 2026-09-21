import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Pencil, Plus, RefreshCw, Save, X } from 'lucide-react';
import { fetchJson, postJson } from '../../../shared/api/http';
import styles from './ChannelManager.module.css';

type Channel = { id: string; name: string; baseUrl?: string; model?: string; multiplier?: string; editable: boolean; switchable?: boolean; priceRatio?: number; priceGroup?: string };
export function ChannelManager({ onClose, currentModel, disabled, onSwitch }: { onClose: () => void; currentModel: string; disabled: boolean; onSwitch: (model: string) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', baseUrl: '', model: '', apiKey: '', multiplier: '1.0' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    setBusy(true); setError('');
    try { setChannels((await fetchJson<{ channels: Channel[] }>('/api/model-channels')).channels); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '读取失败'); }
    finally { setBusy(false); }
  };
  useEffect(() => { dialog.current?.showModal(); void load(); }, []);
  const choose = (id: string) => {
    const entry = channels.find((item) => item.id === id);
    setSelected(id); setError(''); setNotice('');
    setEditing(true);
    setDraft({ name: entry?.name || '', baseUrl: entry?.baseUrl || '', model: entry?.model || '', apiKey: '', multiplier: entry?.multiplier || '1.0' });
  };
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await postJson<{ notice: string }>('/api/model-channels', { ...draft, id: selected || undefined });
      setDraft((value) => ({ ...value, apiKey: '' }));
      setNotice(result.notice);
      await load();
      setEditing(false);
      window.dispatchEvent(new Event('negus-channels-updated'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const switchChannel = async (entry: Channel) => {
    if (disabled || busy || !entry.switchable) return;
    setBusy(true); setError('');
    try {
      if (await onSwitch(`ccswitch_${entry.id}::${entry.model}`)) onClose();
      else setError('渠道未切换成功，请重试');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '切换失败'); }
    finally { setBusy(false); }
  };
  const unsupported = Boolean(selected && channels.find((item) => item.id === selected)?.editable === false);
  return createPortal(<dialog ref={dialog} className={styles.dialog} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <header>{editing ? <button type="button" title="返回渠道列表" aria-label="返回渠道列表" disabled={busy} onClick={() => { setEditing(false); setError(''); setDraft({ ...draft, apiKey: '' }); }}><ArrowLeft size={18} /></button> : null}<h2>{editing ? selected ? '编辑渠道' : '添加渠道' : '切换渠道'}</h2><button type="button" title="关闭" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {!editing ? <>
      <div className={styles.toolbar}><span>{busy ? '读取中…' : `${channels.length} 个渠道`}</span><button type="button" title="添加渠道" aria-label="添加渠道" disabled={busy} onClick={() => choose('')}><Plus size={18} /></button><button type="button" title="刷新渠道" aria-label="刷新渠道" disabled={busy} onClick={() => void load()}><RefreshCw size={18} /></button></div>
      <div className={styles.channels}>{channels.map((entry) => {
        const active = currentModel === `ccswitch_${entry.id}::${entry.model}`;
        return <div key={entry.id} className={styles.channel} data-active={active}>
          <button type="button" className={styles.switchButton} disabled={busy || disabled || !entry.switchable || active} onClick={() => void switchChannel(entry)}>
            <span className={styles.channelInfo}><strong>{entry.name}</strong><small>{entry.model || '认证暂不支持'}</small></span>
            <span className={styles.ratio}><strong>{entry.priceRatio !== undefined ? `${entry.priceRatio.toFixed(2)}×` : entry.multiplier ? `${Number(entry.multiplier).toFixed(2)}×` : '--'}</strong><small>{entry.priceRatio !== undefined ? entry.priceGroup : '配置倍率'}</small></span>
            {active ? <Check size={18} aria-label="当前使用" /> : null}
          </button>
          <button type="button" title={`编辑 ${entry.name}`} aria-label={`编辑 ${entry.name}`} disabled={busy || !entry.editable} onClick={() => choose(entry.id)}><Pencil size={15} /></button>
        </div>;
      })}</div>
      {disabled ? <p>任务结束后可切换渠道。</p> : null}
      {!busy && !channels.length && !error ? <p>暂无渠道</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    </> : <>
    <div className={styles.toolbar}>
      <select aria-label="渠道" value={selected} disabled={busy} onChange={(event) => choose(event.target.value)}>
        <option value="">新渠道</option>{channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <button type="button" title="添加渠道" aria-label="添加渠道" disabled={busy} onClick={() => choose('')}><Plus size={18} /></button>
      <button type="button" title="刷新渠道" aria-label="刷新渠道" disabled={busy} onClick={() => void load()}><RefreshCw size={18} /></button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || unsupported}>
        <label>名称<input required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>API 地址<input required type="url" value={draft.baseUrl} placeholder="https://example.com/v1" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
        <label>模型<input required maxLength={120} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
        <label>API Key<input type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required={!selected} value={draft.apiKey} placeholder={selected ? '留空保留原 Key' : ''} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} /></label>
        <label>配置倍率<input required type="number" min="0.001" step="any" value={draft.multiplier} onChange={(event) => setDraft({ ...draft, multiplier: event.target.value })} /></label>
      </fieldset>
      {unsupported ? <p>此渠道使用的认证方式暂不支持编辑。</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <footer><button type="submit" disabled={busy || unsupported}><Save size={16} />{busy ? '处理中…' : '保存'}</button></footer>
    </form></>}
  </dialog>, document.body);
}
