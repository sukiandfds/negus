import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Plus, RefreshCw, Save, X } from 'lucide-react';
import { fetchJson, postJson } from '../../../shared/api/http';
import { readLocalCache, writeLocalCache } from '../../../shared/state/localCache';
import styles from './ChannelManager.module.css';
import { channelProviderId, chooseEffort, groupModels, providerIdOf, readModelDefaults, useModelDefaults, writeModelDefaults } from '../model/modelDefaults';
import { formatReasoningEffort } from '../model/reasoningEffortLabels';
import type { CodexModel } from '../model/types';
import { ModelSelect } from './ModelSelect';
import { ReasoningEffortSelect } from './ReasoningEffortSelect';
import modelStyles from './ModelSelect.module.css';

export type Channel = { id: string; name: string; baseUrl?: string; model?: string; multiplier?: string; editable: boolean; switchable?: boolean; priceRatio?: number; priceGroup?: string; modelKey?: string; isCurrent?: boolean };
const formatChannelRatio = (entry: Channel) => entry.priceRatio !== undefined ? `${entry.priceRatio.toFixed(2)}×` : entry.multiplier ? `${Number(entry.multiplier).toFixed(2)}×` : "--";
const channelCacheKey = 'negus-model-channels-v1';
const validChannels = (value: unknown): value is Channel[] => Array.isArray(value)
  && value.every((entry) => Boolean(entry) && typeof entry === 'object'
    && typeof (entry as Channel).id === 'string' && typeof (entry as Channel).name === 'string');
let cachedChannels: Channel[] = readLocalCache(channelCacheKey, validChannels) || [];
let cachedAt = cachedChannels.length ? Date.now() : 0;
let pendingChannels: Promise<Channel[]> | null = null;
const refreshChannels = (force = false) => {
  if (pendingChannels) return pendingChannels;
  pendingChannels = fetchJson<{ channels: Channel[] }>(`/api/model-channels${force ? '?refresh=1' : ''}`, AbortSignal.timeout(15000))
    .then((result) => {
      cachedChannels = result.channels;
      cachedAt = Date.now();
      writeLocalCache(channelCacheKey, cachedChannels);
      return cachedChannels;
    })
    .finally(() => { pendingChannels = null; });
  return pendingChannels;
};
export const readChannels = (force = false) => {
  if (!force && cachedChannels.length) {
    if (Date.now() - cachedAt >= 60000) void refreshChannels().catch(() => {});
    return Promise.resolve(cachedChannels);
  }
  return refreshChannels(force);
};
export const buildBuiltInChannels = (models: CodexModel[], currentModel: string, channels: Channel[] = []): Channel[] => [...new Set(models.map((entry) => entry.modelProviderId || 'current'))]
  .filter((id) => !id.startsWith('ccswitch_'))
  .flatMap((id) => {
    const available = models.filter((entry) => (entry.modelProviderId || 'current') === id && entry.available !== false);
    const model = available.find((entry) => entry.model === currentModel) || available.find((entry) => entry.isDefault) || available[0];
    const pricing = channels.find((entry) => id === 'current' ? entry.isCurrent : entry.id === id);
    return model ? [{ priceRatio: pricing?.priceRatio, priceGroup: pricing?.priceGroup, multiplier: pricing?.multiplier, id, name: model.providerDisplayName || (id === 'current' ? '当前运行配置' : id),
      model: model.model, modelKey: model.model, editable: false, switchable: true }] : [];
  });

export function useChannelCatalog(models: CodexModel[], currentModel: string) {
  const [channels, setChannels] = useState<Channel[]>(cachedChannels);
  const builtInChannels = buildBuiltInChannels(models, currentModel, channels);
  const load = async (force = false) => {
    const next = await readChannels(force);
    setChannels(next);
    return next;
  };
  useEffect(() => {
    let cancelled = false;
    void readChannels().then((next) => { if (!cancelled) setChannels(next); }).catch(() => {});
    const refresh = () => { void readChannels(true).then((next) => { if (!cancelled) setChannels(next); }).catch(() => {}); };
    window.addEventListener('negus-channels-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('negus-channels-updated', refresh); };
  }, []);
  return { channels, allChannels: [...builtInChannels, ...channels.filter((entry) => !entry.isCurrent && !entry.modelKey)], load };
}

export function ChannelManager({ onClose, currentModel, models, disabled, onSwitch }: { onClose: () => void; currentModel: string; models: CodexModel[]; disabled: boolean; onSwitch: (model: string) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const defaults = useModelDefaults();
  const [showArchived, setShowArchived] = useState(false);
  const [channels, setChannels] = useState<Channel[]>(cachedChannels);
  const builtInChannels = buildBuiltInChannels(models, currentModel, channels);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  const allChannels = [...builtInChannels, ...channels.filter((entry) => !entry.isCurrent && !entry.modelKey)];
  const visibleChannels = allChannels.filter((entry) => !defaults.archivedProviderIds.includes(channelProviderId(entry)));
  const archivedChannels = allChannels.filter((entry) => defaults.archivedProviderIds.includes(channelProviderId(entry)));
  const groupIds = [...new Set([...models.filter((entry) => entry.available !== false).map(providerIdOf), ...allChannels.map(channelProviderId)])];
  const activeGroupIds = groupIds.filter((id) => !defaults.archivedProviderIds.includes(id));
  const effectiveProviderId = defaults.providerId && activeGroupIds.includes(defaults.providerId)
    ? defaults.providerId
    : activeGroupIds.includes("current") ? "current" : activeGroupIds[0] || "";
  const selectedGroup = groupModels(models, effectiveProviderId);
  const selectedDefaultModel = selectedGroup.find((entry) => entry.model === defaults.model) || selectedGroup.find((entry) => entry.isDefault) || selectedGroup[0];
  const selectedDefaultEffort = chooseEffort(selectedDefaultModel, defaults.effort);
  const groupName = (id: string) => models.find((entry) => providerIdOf(entry) === id)?.providerDisplayName
    || allChannels.find((entry) => channelProviderId(entry) === id)?.name
    || (id === "current" ? "\u5f53\u524d\u8fd0\u884c\u6e20\u9053" : id === "fusheng-grok" ? "Fusheng Grok" : id);
  const applyChoice = (providerId: string, modelId: string, effort: string) => {
    const group = groupModels(models, providerId);
    const entry = group.find((item) => item.model === modelId) || group.find((item) => item.isDefault) || group[0];
    writeModelDefaults({ ...readModelDefaults(), providerId, model: entry?.model || "", effort: chooseEffort(entry, effort) });
  };
  const archiveProvider = (providerId: string) => {
    const current = readModelDefaults();
    const archivedProviderIds = [...new Set([...current.archivedProviderIds, providerId])];
    const remaining = groupIds.filter((id) => !archivedProviderIds.includes(id));
    if (providerId !== effectiveProviderId) {
      writeModelDefaults({ ...current, archivedProviderIds });
      return;
    }
    const providerIdNext = remaining.includes("current") ? "current" : remaining[0] || "";
    const group = groupModels(models, providerIdNext);
    const entry = group.find((item) => item.isDefault) || group[0];
    writeModelDefaults({ providerId: providerIdNext, model: entry?.model || "", effort: chooseEffort(entry, ""), archivedProviderIds });
  };
  const restoreProvider = (providerId: string) => {
    const current = readModelDefaults();
    writeModelDefaults({ ...current, archivedProviderIds: current.archivedProviderIds.filter((id) => id !== providerId) });
  };
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Channel | null>(null);
  const [draftProviderId, setDraftProviderId] = useState(effectiveProviderId);
  const [draftDefaultModel, setDraftDefaultModel] = useState(selectedDefaultModel?.model || "");
  const [draftDefaultEffort, setDraftDefaultEffort] = useState(selectedDefaultEffort);
  const [defaultsTouched, setDefaultsTouched] = useState(false);
  const [draft, setDraft] = useState({ name: '', baseUrl: '', model: '', apiKey: '', multiplier: '1.0' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async (force = false) => {
    setLoading(true); setError('');
    try { const next = await readChannels(force); if (mounted.current) setChannels(next); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '读取失败'); }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; dialog.current?.showModal(); void load(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (defaultsTouched) return;
    setDraftProviderId(effectiveProviderId);
    setDraftDefaultModel(selectedDefaultModel?.model || "");
    setDraftDefaultEffort(selectedDefaultEffort);
  }, [defaultsTouched, effectiveProviderId, selectedDefaultModel?.model, selectedDefaultEffort]);
  const choose = (id: string) => {
    const entry = channels.find((item) => item.id === id);
    setSelected(id); setError(''); setNotice('');
    setEditing(true);
    setEditingEntry(entry || null);
    setDraft({ name: entry?.name || '', baseUrl: entry?.baseUrl || '', model: entry?.model || '', apiKey: '', multiplier: entry?.multiplier || '1.0' });
  };
  const openEditor = (entry: Channel) => {
    setError(''); setNotice('');
    setEditing(true);
    setEditingEntry(entry);
    if (entry.modelKey) {
      setSelected('');
      return;
    }
    choose(entry.id);
  };
  const stageDefaultGroup = (providerId: string) => {
    const group = groupModels(models, providerId);
    const entry = group.find((item) => item.isDefault) || group[0];
    setDefaultsTouched(true);
    setDraftProviderId(providerId);
    setDraftDefaultModel(entry?.model || "");
    setDraftDefaultEffort(chooseEffort(entry, ""));
  };
  const saveDefaults = () => {
    applyChoice(draftProviderId, draftDefaultModel, draftDefaultEffort);
    setDefaultsTouched(false);
    setNotice("默认配置已保存");
  };
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await postJson<{ notice: string }>('/api/model-channels', { ...draft, id: selected || undefined });
      setDraft((value) => ({ ...value, apiKey: '' }));
      setNotice(result.notice);
      await load(true);
      setEditing(false);
      window.dispatchEvent(new CustomEvent('negus-channels-updated', { detail: { providerId: selected ? `ccswitch_${selected}` : undefined } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const switchChannel = async (entry: Channel) => {
    if (disabled || busy || !entry.switchable) return;
    setBusy(true); setError('');
    try {
      if (await onSwitch(entry.modelKey || `ccswitch_${entry.id}::${entry.model}`)) onClose();
      else setError('配置未切换成功，请重试');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '切换失败'); }
    finally { setBusy(false); }
  };
  const unsupported = Boolean(selected && channels.find((item) => item.id === selected)?.editable === false);
  const defaultsDirty = defaultsTouched && (
    draftProviderId !== effectiveProviderId
    || draftDefaultModel !== (selectedDefaultModel?.model || "")
    || draftDefaultEffort !== selectedDefaultEffort
  );
  const draftGroup = groupModels(models, draftProviderId);
  const draftModelEntry = draftGroup.find((entry) => entry.model === draftDefaultModel) || draftGroup.find((entry) => entry.isDefault) || draftGroup[0];
  const closeEditor = () => { setEditing(false); setEditingEntry(null); setError(''); setDraft((value) => ({ ...value, apiKey: '' })); };
  const archiveEditing = () => {
    if (!editingEntry) return;
    archiveProvider(channelProviderId(editingEntry));
    setDefaultsTouched(false);
    closeEditor();
  };
  const removeChannel = async () => {
    if (!editingEntry || editingEntry.modelKey || busy) return;
    if (!window.confirm(`删除「${editingEntry.name}」？`)) return;
    setBusy(true); setError('');
    try {
      const result = await postJson<{ notice?: string }>('/api/model-channels', { action: 'delete', id: editingEntry.id });
      setNotice(result.notice || '已删除');
      await load(true);
      closeEditor();
      window.dispatchEvent(new CustomEvent('negus-channels-updated', { detail: { providerId: `ccswitch_${editingEntry.id}` } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败'); }
    finally { setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className={styles.dialog} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <header>{editing ? <button type="button" title="返回" aria-label="返回" disabled={busy} onClick={closeEditor}><ArrowLeft size={18} /></button> : null}<h2>{editing ? selected ? "编辑配置" : editingEntry ? "编辑配置" : "添加配置" : "配置"}</h2><button type="button" title="关闭" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {editing && editingEntry ? <div className={styles.channelInfo}>
      <span>{editingEntry.priceRatio !== undefined ? editingEntry.priceGroup : "配置倍率"}</span>
      <strong>{formatChannelRatio(editingEntry)}</strong>
    </div> : null}
    {!editing ? <>
      <div className={styles.toolbar}><span>{!visibleChannels.length && loading ? "读取中…" : `${visibleChannels.length} 个配置`}</span><button type="button" title="添加配置" aria-label="添加配置" disabled={busy} onClick={() => choose("")}><Plus size={18} /></button><button type="button" title="刷新配置" aria-label="刷新配置" disabled={busy || loading} onClick={() => void load(true)}><RefreshCw size={18} /></button><button type="button" title="保存默认配置" aria-label="保存默认配置" disabled={busy || !defaultsDirty} onClick={saveDefaults}><Save size={18} /></button></div>
      <div className={styles.defaults}>
        <div className={modelStyles.settingRow}>
          <span>默认配置</span>
          <select className={modelStyles.select} aria-label="默认配置" value={draftProviderId} disabled={busy || !activeGroupIds.length} onChange={(event) => stageDefaultGroup(event.target.value)}>
            {activeGroupIds.map((id) => <option key={id} value={id}>{groupName(id)}</option>)}
          </select>
        </div>
        <div className={modelStyles.settingRow}>
          <span>默认模型</span>
          <ModelSelect currentModel={draftDefaultModel} models={draftGroup} disabled={busy} loading={false} changing={false} error="" onChange={async (model) => { setDefaultsTouched(true); setDraftDefaultModel(model); setDraftDefaultEffort(chooseEffort(draftGroup.find((entry) => entry.model === model), "")); return true; }} />
        </div>
        <div className={modelStyles.settingRow}>
          <span>默认思考等级</span>
          <ReasoningEffortSelect currentModel={draftModelEntry} currentEffort={draftDefaultEffort} disabled={busy} loading={false} changing={false} error="" onChange={async (effort) => { setDefaultsTouched(true); setDraftDefaultEffort(effort); return true; }} />
        </div>
      </div>
      <div className={styles.channels}>{visibleChannels.map((entry) => {
        const active = currentModel === (entry.modelKey || `ccswitch_${entry.id}::${entry.model}`);
        return <div key={entry.id} className={styles.channel} data-active={active}>
          <span className={styles.channelInfo}><strong>{entry.name}</strong><small>{entry.model || "认证暂不支持"}</small></span>
          <span className={styles.ratio}><strong>{formatChannelRatio(entry)}</strong><small>{entry.priceRatio !== undefined ? entry.priceGroup : "配置倍率"}</small></span>
          <button className={styles.iconButton} type="button" title={`编辑 ${entry.name}`} aria-label={`编辑 ${entry.name}`} disabled={busy} onClick={() => openEditor(entry)}><Pencil size={15} /></button>
        </div>;
      })}</div>
      {archivedChannels.length ? <div className={styles.archived}>
        <button type="button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "收起已归档" : `已归档 ${archivedChannels.length}`}</button>
        {showArchived ? archivedChannels.map((entry) => <div key={`archived-${entry.id}`} className={styles.channel}><span className={styles.channelInfo}><strong>{entry.name}</strong></span><button type="button" title={`恢复 ${entry.name}`} aria-label={`恢复 ${entry.name}`} disabled={busy} onClick={() => restoreProvider(channelProviderId(entry))}><ArchiveRestore size={15} /></button></div>) : null}
      </div> : null}
      {disabled ? <p>任务结束后可切换配置。</p> : null}
      {!loading && !visibleChannels.length && !error ? <p>暂无配置</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    </> : editingEntry?.modelKey ? <>
      <div className={styles.channelInfo}><strong>{editingEntry.name}</strong><small>{editingEntry.model || "认证暂不支持"}</small></div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <footer>
        <button type="button" disabled={busy} onClick={archiveEditing}><Archive size={16} />归档</button>
        <button className={styles.danger} type="button" disabled title="这个配置不能删除">删除</button>
      </footer>
    </> : <>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || unsupported}>
        <label>名称<input required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>API 地址<input required type="url" value={draft.baseUrl} placeholder="https://example.com/v1" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
        <label>模型<input required maxLength={120} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
        <label>API Key<input type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required={!selected} value={draft.apiKey} placeholder={selected ? "留空保留原 Key" : ""} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} /></label>
        <label>配置倍率<input required type="number" min="0.001" step="any" value={draft.multiplier} onChange={(event) => setDraft({ ...draft, multiplier: event.target.value })} /></label>
      </fieldset>
      {unsupported ? <p>此配置使用的认证方式暂不支持编辑。</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <footer>
        {editingEntry ? <button type="button" disabled={busy} onClick={archiveEditing}><Archive size={16} />归档</button> : null}
        {editingEntry ? <button className={styles.danger} type="button" disabled={busy} onClick={() => void removeChannel()}>删除</button> : null}
        <button type="submit" disabled={busy || unsupported}><Save size={16} />{busy ? "处理中…" : "保存"}</button>
      </footer>
    </form></>}
  </dialog>, document.body);
}
