import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, MoreHorizontal, Plus, RefreshCw, Save, X } from 'lucide-react';
import { fetchJson, postJson } from '../../../shared/api/http';
import { createCachedResource } from '../../../shared/state/localCache';
import styles from './ChannelManager.module.css';
import { channelProviderId, providerIdForModel, refreshModelDefaults, useModelDefaults, writeModelDefaults } from '../model/modelDefaults';
import { formatReasoningEffort } from '../model/reasoningEffortLabels';
import { ModelCatalogFeedback } from './ModelCatalogFeedback';
import { refreshConfiguredModels, refreshModelCatalog, type CatalogResult } from '../data/modelCatalogRefresh';
import type { CodexModel } from '../model/types';

export type Channel = { owner?: "shared" | "native" | "builtin"; codexInUse?: boolean; hasCredential?: boolean; configured?: boolean; reasoningEffort?: string; sharedConfigId?: string; id: string; name: string; baseUrl?: string; model?: string; availableModel?: string; multiplier?: string; editable: boolean; switchable?: boolean; priceRatio?: number; priceGroup?: string; modelKey?: string; isCurrent?: boolean };
const channelCacheKey = 'negus-model-channels-v2';
const validChannels = (value: unknown): value is Channel[] => Array.isArray(value)
  && value.every((entry) => Boolean(entry) && typeof entry === 'object'
    && typeof (entry as Channel).id === 'string' && typeof (entry as Channel).name === 'string');
type ChannelList = { channels: Channel[]; pricing?: Record<string, number> };
const channelCatalog = createCachedResource<ChannelList>(channelCacheKey + ':metadata', (value): value is ChannelList =>
  Boolean(value) && validChannels((value as ChannelList).channels),
  (next, previous) => ({ ...next, pricing: next.pricing || previous?.pricing }));
export const canonicalChannelId = (id: string) => {
  const rows = channelCatalog.getSnapshot().data?.channels || [];
  const linked = rows.find(row => row.codexInUse)?.id || rows.find(row => row.id === "current")?.sharedConfigId;
  return id === "current" && linked ? "ccswitch_" + linked : id;
};
let channelRevalidated = false;
const refreshChannels = (force = false) => {
  return channelCatalog.refresh(async () => {
    const result = await fetchJson<{ channels: Channel[]; pricing?: Record<string, number> }>(
      `/api/model-channels${force ? '?refresh=1' : ''}`,
      AbortSignal.timeout(15000),
    );
    return result;
  }, force).then(result => result.channels);
};
export const readChannels = (force = false) => {
  const cached = channelCatalog.getSnapshot().data;
  if (!force && cached && channelRevalidated) return Promise.resolve(cached.channels);
  if (!force) channelRevalidated = true;
  return refreshChannels(force);
};
export const buildBuiltInChannels = (models: CodexModel[], currentModel: string, channels: Channel[] = []): Channel[] => [...new Set(models.map((entry) => entry.modelProviderId || 'current'))]
  .filter((id) => !id.startsWith('ccswitch_'))
  .flatMap((id) => {
    const available = models.filter((entry) => (entry.modelProviderId || 'current') === id && entry.available !== false);
    const model = available.find((entry) => entry.model === currentModel) || available.find((entry) => entry.isDefault) || available[0];
    const pricing = channels.find((entry) => entry.id === id);
    return model ? [{ configured: pricing?.configured, reasoningEffort: pricing?.reasoningEffort, sharedConfigId: pricing?.sharedConfigId, baseUrl: pricing?.baseUrl, priceRatio: pricing?.priceRatio, priceGroup: pricing?.priceGroup, multiplier: pricing?.multiplier, id, name: model.providerDisplayName || (id === 'current' ? '当前运行配置' : id),
      model: pricing?.model || model.model, availableModel: model.model, modelKey: model.model, editable: false, switchable: true }] : [];
  });

export function useChannelCatalog(models: CodexModel[], currentModel: string) {
  const cached = useSyncExternalStore(channelCatalog.subscribe, channelCatalog.getSnapshot);
  const channels = cached.data?.channels || [];
  const pricing = cached.data?.pricing;
  const builtInChannels = buildBuiltInChannels(models, currentModel, channels);
  const load = async (force = false) => {
    const next = await readChannels(force);
    return next;
  };
  useEffect(() => {
    void readChannels().catch(() => {});
    const refresh = () => { void readChannels(true).catch(() => {}); };
    window.addEventListener('negus-channels-updated', refresh);
    return () => window.removeEventListener('negus-channels-updated', refresh);
  }, []);
  const currentLink = channels.find(c => c.id === 'current')?.sharedConfigId;
  const sharedChannels = channels.filter((entry) => !entry.modelKey && entry.id !== currentLink).map((entry) => {
    const providerId = channelProviderId(entry);
    const available = models.filter((model) => model.available !== false && (model.modelProviderId || 'current') === providerId);
    const model = available.find((item) => item.model === currentModel)
      || available.find((item) => item.model.split('::').at(-1) === entry.model)
      || available.find((item) => item.isDefault) || available[0];
    return { ...entry, availableModel: model?.model };
  });
  const canonical = canonicalChannelId;
  const managed = channels.some(entry => entry.owner);
  const allChannels = managed ? channels.map(entry => {
    const id = channelProviderId(entry);
    const available = models.filter(model => (model.modelProviderId || 'current') === id);
    const preferred = available.find(model => model.model.split('::').at(-1) === entry.model)
      || available.find(model => model.isDefault) || available[0];
    return { ...entry, availableModel: preferred?.model };
  }) : [...builtInChannels, ...sharedChannels];
  return { channels, allChannels, load, pricing, canonical, managed };
}

export function ChannelManager({ onClose, currentModel, models }: { onClose: () => void; currentModel: string; models: CodexModel[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const defaults = useModelDefaults();
  const { channels, allChannels, load, pricing, canonical, managed } = useChannelCatalog(models, currentModel);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState('');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: Event) => { if (!(event.target as Element)?.closest?.('[data-channel-menu]')) setMenu(''); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(''); } };
    const close = () => setMenu('');
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', close);
    dialog.current?.addEventListener('scroll', close);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', close); dialog.current?.removeEventListener('scroll', close); };
  }, [menu]);
  const empty = { id: '', sourceId: '', name: '', baseUrl: '', model: '', reasoningEffort: '', apiKey: '', keyMode: 'clear' };
  const [draft, setDraft] = useState(empty);
  const [initial, setInitial] = useState(JSON.stringify(empty));
  const [pendingDefault, setPendingDefault] = useState<Channel | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<Array<{ model: string; supportedReasoningEfforts: CodexModel['supportedReasoningEfforts'] }>>([]);
  const [testModel, setTestModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emptyResults, setEmptyResults] = useState<CatalogResult[]>([]);
  const [notice, setNotice] = useState('');
  const dirty = editing && !testing && JSON.stringify(draft) !== initial;
  const defaultDirty = Boolean(pendingDefault && canonical(channelProviderId(pendingDefault)) !== canonical(defaults.providerId));
  const currentProvider = providerIdForModel(models, currentModel);
  const currentLink = channels.find(c => c.id === 'current')?.sharedConfigId;
  const matches = (entry: Channel, id: string) => canonical(channelProviderId(entry)) === canonical(id);
  const selectedEntry = channels.find(c => c.id === draft.id);
  const protectedEntry = Boolean(draft.id && (selectedEntry?.codexInUse || selectedEntry?.isCurrent || selectedEntry?.editable === false));
  const draftProvider = draft.id ? 'ccswitch_' + draft.id : draft.sourceId === 'current' ? 'current' : 'ccswitch_' + draft.sourceId;
  const sourceChannel = channels.find(channel => channel.id === (draft.id || draft.sourceId));
  const sameEndpoint = sourceChannel?.baseUrl?.replace(/\/$/u, '') === draft.baseUrl.replace(/\/$/u, '');
  const discoveredEfforts = capabilities.find(m => m.model === draft.model)?.supportedReasoningEfforts;
  const effortOptions = (discoveredEfforts?.length ? discoveredEfforts : undefined)
    || (sameEndpoint ? models.find(m => m.modelProviderId === draftProvider && m.model.split('::').at(-1) === draft.model)?.supportedReasoningEfforts : undefined) || [];
  const resetFeedback = () => { setError(''); setNotice(''); };
  const confirmLeave = () => !(dirty || defaultDirty) || window.confirm('放弃未保存的修改？');
  const close = () => { if (!busy && confirmLeave()) onClose(); };
  useEffect(() => {
    dialog.current?.showModal();
    const unload = (event: BeforeUnloadEvent) => { if (dirty || defaultDirty) event.preventDefault(); };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, defaultDirty]);
  useEffect(() => { setChoices([]); setCapabilities([]); if (editing) setNotice(''); }, [draft.baseUrl, draft.apiKey, draft.keyMode, draft.sourceId, draft.id]);
  useEffect(() => { if (editing) setNotice(''); }, [testModel, draft.model]);
  const open = (entry?: Channel, copy = false, test = false) => {
    if (!confirmLeave()) return;
    setMenu(''); resetFeedback(); setPendingDefault(null);
    const linked = entry?.id === 'current' && currentLink ? channels.find(c => c.id === currentLink) : entry;
    const source = linked || entry;
    const next = {
      ...empty, id: copy ? '' : source?.modelKey || (source?.owner && source.owner !== 'shared') ? '' : source?.id || '',
      sourceId: copy || source?.modelKey || (source?.owner && source.owner !== 'shared') ? source?.id || '' : '',
      name: (source?.name || '') + (copy ? ' 副本' : ''),
      baseUrl: source?.baseUrl || '', model: (source?.model || '').split('::').at(-1) || '',
      reasoningEffort: source?.reasoningEffort || '',
      keyMode: source?.hasCredential || source?.configured ? 'keep' : 'clear',
    };
    setDraft(next); setInitial(JSON.stringify(next)); setEditing(true); setTesting(test);
    setTestModel(next.model); setChoices([]);
    if (copy) setInitial('copy');
  };
  const requestBody = () => ({ ...draft, id: draft.id || undefined, sourceId: draft.sourceId || undefined });
  const query = async (action: 'discover' | 'test') => {
    setBusy(true); resetFeedback();
    try {
      const result = await postJson<{ models?: string[]; capabilities?: typeof capabilities; notice?: string }>('/api/model-channels',
        { ...requestBody(), action, model: action === 'test' ? testModel || draft.model : draft.model }, AbortSignal.timeout(50000));
      if (action === 'discover') { setChoices(result.models || []); setCapabilities(result.capabilities || []); }
      else setNotice('已通过 · ' + (testModel || draft.model));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '请求失败'); }
    finally { setBusy(false); }
  };
  const defaultFor = (entry: Channel, model = entry.availableModel || entry.model || '', effort = entry.reasoningEffort || '') => {
    const providerId = channelProviderId(entry);
    const raw = model.split('::').at(-1) || '';
    return { providerId, model: providerId + '::' + raw,
      effort };
  };
  const setDefault = (entry: Channel) => {
    setMenu(''); resetFeedback();
    setPendingDefault(entry);
  };
  const save = async () => {
    setBusy(true); resetFeedback();
    try {
      const target = pendingDefault;
      if (editing && dirty) {
        const result = await postJson<{ id: string }>('/api/model-channels', requestBody());
        setDraft(value => ({ ...value, id: result.id, sourceId: '', apiKey: '', keyMode: value.keyMode === 'clear' ? 'clear' : 'keep' }));
        window.dispatchEvent(new CustomEvent('negus-channels-updated', { detail: { providerId: 'ccswitch_' + result.id } }));
      }
      if (target) {
        if (!managed) throw new Error('保存默认配置需要更新后端');
        await writeModelDefaults(defaultFor(target));
      }
      await load(true); await refreshModelDefaults();
      setPendingDefault(null); setEditing(false); setTesting(false); setDraft(empty); setInitial(JSON.stringify(empty)); setNotice('已保存');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const remove = async (entry: Channel) => {
    setMenu('');
    if (!window.confirm('删除「' + entry.name + '」？')) return;
    setBusy(true); resetFeedback();
    try {
      const id = entry.id === 'current' ? currentLink : entry.id;
      await postJson('/api/model-channels', { action: 'delete', id });
      await load(true); await refreshModelDefaults();
      window.dispatchEvent(new CustomEvent('negus-channels-updated'));
      setNotice('已删除');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败'); }
    finally { setBusy(false); }
  };
  const refreshConfiguration = async () => {
    setBusy(true); resetFeedback();
    try {
      const results = await refreshConfiguredModels();
      setError(results.filter(entry => entry.error).map(entry => entry.name + '：' + entry.error).join('；'));
      setEmptyResults(results.filter(entry => entry.count === 0));
      await Promise.all([load(true), refreshModelDefaults()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '刷新失败'); }
    finally { setBusy(false); }
  };
  const back = () => { if (confirmLeave()) { setEditing(false); setTesting(false); setPendingDefault(null); setDraft(empty); setInitial(JSON.stringify(empty)); resetFeedback(); } };
  return createPortal(<dialog ref={dialog} className={styles.dialog} onCancel={event => { event.preventDefault(); close(); }}>
    <header><button type="button" aria-label="返回" disabled={busy} onClick={editing ? back : close}><ArrowLeft size={18} /></button>
      <h2>{editing ? testing ? '测试配置' : draft.id ? '编辑配置' : '添加配置' : '配置'}</h2>
      <button type="button" aria-label="关闭" disabled={busy} onClick={close}><X size={18} /></button></header>
    <div className={styles.toolbar}><span>{editing ? draft.name : allChannels.length + ' 个配置'}</span>
      <button type="button" title="添加配置" aria-label="添加配置" disabled={busy} onClick={() => open()}><Plus size={18} /></button>
      <button type="button" title="刷新配置" aria-label="刷新配置" disabled={busy} onClick={() => void refreshConfiguration()}><RefreshCw size={18} /></button>
      <button type="button" title="保存" aria-label="保存" disabled={busy || (!dirty && !defaultDirty)} onClick={() => void save()}><Save size={18} /></button>
    </div>
    {!editing && pricing ? <section aria-label="供应商公开分组倍率"><strong>供应商公开分组倍率</strong>
      <ul>{Object.entries(pricing).map(([group, ratio]) => <li key={group}>{group} {ratio.toFixed(2)}×</li>)}</ul>
    </section> : null}
    {emptyResults.length ? <ModelCatalogFeedback results={emptyResults} onClose={() => setEmptyResults([])}
      onDeleted={() => { void load(true).catch(() => {}); void refreshModelCatalog().catch(() => {}); void refreshModelDefaults().catch(() => {}); }} /> : null}
    {!editing ? <div className={styles.channels}>{allChannels.map(entry => {
      const active = Boolean(currentModel) && matches(entry, currentProvider);
      const isDefault = matches(entry, pendingDefault ? channelProviderId(pendingDefault) : defaults.providerId);
      const linked = entry.id === 'current' ? channels.find(c => c.id === currentLink) : entry;
      return <div key={entry.id} className={styles.channel} >
        <div className={styles.channelInfo}><div className={styles.nameRow}><strong>{entry.name}</strong>
          {entry.owner === 'builtin' ? <span className={styles.badge}>Negus 内建</span> : null}
          {entry.codexInUse ? <span className={styles.badge}>ccswitch供codex使用中</span> : linked?.isCurrent ? <span className={styles.badge}>CC Switch 占用中</span> : null}
          {isDefault ? <span className={styles.badge}>默认配置</span> : null}</div>
          {entry.availableModel || entry.model ? <small>{(entry.availableModel || entry.model || '').split('::').at(-1)}</small> : null}</div>
        <span className={styles.ratio} title={entry.priceGroup || '供应商倍率'}>{entry.priceRatio !== undefined ? entry.priceRatio.toFixed(2) + '×' : '未获取'}</span>
        <div className={styles.actions} data-channel-menu>
          <button type="button" className={styles.iconButton} aria-label={'操作 ' + entry.name} aria-expanded={menu === entry.id} disabled={busy} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setMenuPosition({ left: Math.max(8, Math.min(box.right - 144, window.innerWidth - 152)), top: Math.max(8, Math.min(box.bottom + 4, window.innerHeight - 202)) }); setMenu(menu === entry.id ? '' : entry.id); }}><MoreHorizontal size={18} /></button>
          {menu === entry.id ? <div className={styles.actionMenu} style={menuPosition} role="menu">
            <button role="menuitem" onClick={() => open(entry)}>编辑</button>
            <button role="menuitem" onClick={() => open(entry, true)}>复制</button>
            <button role="menuitem" disabled={managed && !entry.availableModel} onClick={() => setDefault(entry)}>设为默认</button>
            <button role="menuitem" onClick={() => open(entry, false, true)}>测试配置</button>
            <button role="menuitem" className={styles.danger} disabled={active || linked?.codexInUse || linked?.isCurrent || !linked || Boolean(linked.modelKey) || Boolean(entry.owner && entry.owner !== 'shared')} title={active || linked?.isCurrent ? '正在使用的配置暂不删除' : undefined} onClick={() => void remove(entry)}>删除</button>
          </div> : null}
        </div>
      </div>;
    })}</div> : <>
      <fieldset disabled={busy}>
        {!testing ? <>
          <label>名称<input maxLength={160} value={draft.name} disabled={protectedEntry} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>API 地址<input value={draft.baseUrl} disabled={protectedEntry} placeholder="https://example.com/v1" onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} /></label>
          <label>API Key{draft.keyMode === 'keep' ? <div className={styles.keyRow}>
            <span>•••••••• · 已保存</span><button type="button" disabled={protectedEntry} onClick={() => setDraft({ ...draft, keyMode: 'replace', apiKey: '' })}>修改</button>
            <button type="button" disabled={protectedEntry} onClick={() => setDraft({ ...draft, keyMode: 'clear', apiKey: '' })}>清空</button>
          </div> : <input type="password" autoComplete="new-password" disabled={protectedEntry} value={draft.apiKey} onChange={e => setDraft({ ...draft, apiKey: e.target.value, keyMode: e.target.value ? 'replace' : 'clear' })} />}</label>
        </> : null}
        <button type="button" onClick={() => void query('discover')}>查询模型</button>
        {choices.length > 0 ? <label>查询结果<select aria-label="查询到的模型" value="" onChange={e => {
          if (!e.target.value) return;
          setTestModel(e.target.value);
          if (!testing && !protectedEntry) setDraft({ ...draft, model: e.target.value, reasoningEffort: '' });
        }}><option value="">已找到 {choices.length} 个模型 · 请选择</option>{choices.map(model => <option key={model} value={model}>{model}</option>)}</select></label> : null}
        {!testing ? <>
          <label>默认模型<input disabled={protectedEntry} value={draft.model} placeholder="可不填" onChange={e => { setDraft({ ...draft, model: e.target.value, reasoningEffort: '' }); setTestModel(e.target.value); }} /></label>
          <label>默认思考等级<select disabled={protectedEntry} value={draft.reasoningEffort} onChange={e => setDraft({ ...draft, reasoningEffort: e.target.value })}>
            <option value="">{effortOptions.length ? '自动' : '自动（可选档位尚未确认）'}</option>
            {draft.reasoningEffort && !effortOptions.some(e => e.reasoningEffort === draft.reasoningEffort) ? <option value={draft.reasoningEffort}>{draft.reasoningEffort}</option> : null}
            {effortOptions.map(e => <option key={e.reasoningEffort} value={e.reasoningEffort}>{formatReasoningEffort(e.reasoningEffort)}</option>)}
          </select></label>
        </> : <label>测试模型<input value={testModel} placeholder="选择或填写模型" onChange={e => setTestModel(e.target.value)} /></label>}
        <button type="button" onClick={() => void query('test')}>测试{testModel || draft.model ? ' · ' + (testModel || draft.model) : '模型'}</button>
        <small>测试会产生少量用量。</small>
      </fieldset>
      {protectedEntry && !testing ? <p>正在使用的原配置保持不变。<button type="button" disabled={busy} onClick={() => open(selectedEntry, true)}>复制后修改</button></p> : null}
    </>}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </dialog>, document.body);
}
