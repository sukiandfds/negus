import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Image, Plus, RefreshCw, Search, Settings2, Trash2 } from 'lucide-react';
import { fetchJson, postJson } from '../../shared/api/http';
import { ProviderFields } from './SettingsFields';
import { providerDraft, type ProviderDraft, type SettingsSnapshot } from './settingsTypes';
import styles from './SettingsPage.module.css';

const endpoint = '/api/settings/image-generation';
const blankSnapshot: SettingsSnapshot = { revision: '', defaultId: '', configurations: [] };
const categories = [{ id: 'image', label: '图片生成', icon: Image }, { id: 'model', label: '模型设置', icon: Settings2 }] as const;
function ProviderSettings({ preview, onDirty }: { preview: boolean; onDirty: (dirty: boolean) => void }) {
  const [snapshot, setSnapshot] = useState(blankSnapshot);
  const [draft, setDraft] = useState<ProviderDraft>(() => ({ ...providerDraft(), ...(preview ? {} : {
    name: '流光绘境', website: 'https://api.happyevering.xyz', baseUrl: 'https://api.happyevering.xyz/v1', model: 'gpt-image-2',
  }) }));
  const [initial, setInitial] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const dirty = Boolean(initial) && JSON.stringify(draft) !== initial;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const select = (next: ProviderDraft) => { setDraft(next); setInitial(JSON.stringify(next)); setModels([]); setError(''); setNotice(''); };
  const applySnapshot = (next: SettingsSnapshot, selectedId = draft.id) => {
    setSnapshot(next);
    const entry = next.configurations.find(item => item.id === selectedId)
      || next.configurations.find(item => item.id === next.defaultId) || next.configurations[0];
    select(entry ? providerDraft(entry) : { ...providerDraft(), name: '流光绘境', website: 'https://api.happyevering.xyz', baseUrl: 'https://api.happyevering.xyz/v1', model: 'gpt-image-2' });
  };
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    if (preview) setInitial(JSON.stringify(draft));
    else {
      setBusy('load');
      void fetchJson<SettingsSnapshot>(endpoint, abort.signal).then(next => {
        if (!alive.current) return;
        applySnapshot(next); setReady(true);
      }).catch(reason => { if (alive.current && !abort.signal.aborted) setError(reason instanceof Error ? reason.message : '读取失败'); })
        .finally(() => { if (alive.current) setBusy(''); });
    }
    return () => { alive.current = false; abort.abort(); onDirty(false); };
  }, []);
  const discard = () => !dirty || window.confirm('放弃未保存的修改？');
  const change = (next: ProviderDraft) => {
    if (next.baseUrl !== draft.baseUrl || next.groupKey !== draft.groupKey || next.groupKeyMode !== draft.groupKeyMode) setModels([]);
    setDraft(next); setNotice(''); setError('');
  };
  const run = async (action: 'save' | 'discover' | 'test' | 'delete' | 'default' | 'load') => {
    if (preview || busy) return;
    if (action === 'delete' && !window.confirm('删除「' + (draft.name || '未命名配置') + '」？')) return;
    if ((action === 'load' || action === 'default') && !discard()) return;
    if (action === 'test' && !window.confirm('使用当前配置生成 1 张测试图片，可能产生费用。继续？')) return;
    setBusy(action); setError(''); setNotice('');
    try {
      if (action === 'load') {
        const next = await fetchJson<SettingsSnapshot>(endpoint, AbortSignal.timeout(15000));
        if (!alive.current) return;
        applySnapshot(next); setReady(true);
      } else if (action === 'discover') {
        const result = await postJson<{ models: string[] }>(endpoint, { ...draft, action }, AbortSignal.timeout(20000));
        if (!alive.current) return;
        setModels(result.models); setNotice(result.models.length ? '已找到 ' + result.models.length + ' 个模型，可在模型框中选择或输入。' : '当前 Key 未查询到模型。');
      } else if (action === 'test') {
        const result = await postJson<{ count: number }>(endpoint, { ...draft, action }, AbortSignal.timeout(200000));
        if (alive.current) setNotice('测试成功，已生成并保存 ' + result.count + ' 张图片。');
      } else {
        const next = await postJson<SettingsSnapshot>(endpoint, { ...draft, action, revision: snapshot.revision });
        if (!alive.current) return;
        const selectedId = action === 'save' && !draft.id ? next.configurations.find(item => !snapshot.configurations.some(old => old.id === item.id))?.id : draft.id;
        applySnapshot(next, selectedId); setNotice(action === 'delete' ? '已删除' : '已保存');
      }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { if (alive.current) setBusy(''); }
  };
  return <>
    <header className={styles.contentHeader}><div><h1>{preview ? '模型设置' : '图片生成'}</h1>
      <p>{preview ? '前端预览 · 暂不保存或应用到聊天模型' : '管理图片生成的供应商、凭证与模型'}</p></div>
      <button className={styles.save} type="button" disabled={preview || !ready || Boolean(busy)} onClick={() => void run('save')}>
        {busy === 'save' ? '保存中…' : '保存配置'}
      </button>
    </header>
    <div className={styles.toolbar}>
      <select aria-label={preview ? "选择模型配置" : "选择图片配置"} disabled={Boolean(busy) || preview || !ready} value={draft.id} onChange={event => {
        if (discard()) select(providerDraft(snapshot.configurations.find(entry => entry.id === event.target.value)));
      }}><option value="">新配置</option>{snapshot.configurations.map(entry => <option key={entry.id} value={entry.id}>{entry.name || '未命名配置'}{entry.id === snapshot.defaultId ? ' · 默认' : ''}</option>)}</select>
      {draft.id && draft.id === snapshot.defaultId ? <span className={styles.badge}><Check size={12} />默认配置</span> : null}
      <div className={styles.tools}>
        <button type="button" title="添加配置" aria-label="添加配置" disabled={Boolean(busy) || (!preview && !ready)} onClick={() => { if (discard()) select(providerDraft()); }}><Plus size={17} /></button>
        <button type="button" title="复制配置" aria-label="复制配置" disabled={Boolean(busy) || !draft.id} onClick={() => {
          if (discard()) { select(providerDraft(snapshot.configurations.find(entry => entry.id === draft.id), true)); setInitial('copy'); }
        }}><Copy size={17} /></button>
        <button type="button" title="刷新配置" aria-label="刷新配置" disabled={preview || Boolean(busy)} onClick={() => void run('load')}><RefreshCw size={17} /></button>
        <button type="button" title="删除配置" aria-label="删除配置" disabled={preview || Boolean(busy) || !draft.id} onClick={() => void run('delete')}><Trash2 size={17} /></button>
      </div>
    </div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <ProviderFields draft={draft} onChange={change} models={models} disabled={Boolean(busy) || !ready} preview={preview} onDiscover={() => void run('discover')} />
    <footer className={styles.formFooter}>
      <button type="button" disabled={preview || Boolean(busy) || !ready} onClick={() => void run('test')}>{busy === 'test' ? '正在生成测试图片…' : preview ? '测试模型' : '测试生图'}</button>
      {draft.id && draft.id !== snapshot.defaultId ? <button type="button" disabled={Boolean(busy) || preview} onClick={() => void run('default')}>设为默认配置</button> : null}
      {!preview && <span>测试会生成 1 张图片，可能产生费用。</span>}
    </footer>
    <div className={styles.feedback} role="status">{busy === 'discover' ? '正在查询模型…' : busy === 'load' ? '正在读取配置…' : notice}</div>
  </>;
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<'image' | 'model'>('image');
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); window.dispatchEvent(new Event("negus:app-ready")); }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const leave = (next: () => void) => { if (!dirty || window.confirm('放弃未保存的修改？')) next(); };
  return <div className={styles.page}>
    <aside className={styles.navigation} aria-label="设置导航">
      <div className={styles.navHeading}><button type="button" title="返回" aria-label="返回原页面" onClick={() => leave(onClose)}><ArrowLeft size={20} /></button><h2 ref={title} tabIndex={-1}>设置</h2></div>
      <div className={styles.search}><Search size={16} /><input aria-label="搜索设置" placeholder="搜索设置" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <nav>{categories.filter(entry => entry.label.includes(search.trim())).map(entry => <button key={entry.id} type="button" aria-current={category === entry.id ? 'page' : undefined}
        className={category === entry.id ? styles.selected : ''} onClick={() => { if (category !== entry.id) leave(() => { setDirty(false); setCategory(entry.id); }); }}><entry.icon size={19} />{entry.label}</button>)}</nav>
      <span className={styles.brand}>NEGUS</span>
    </aside>
    <main className={styles.content}><div className={styles.contentInner}><ProviderSettings key={category} preview={category === 'model'} onDirty={setDirty} /></div></main>
  </div>;
}
