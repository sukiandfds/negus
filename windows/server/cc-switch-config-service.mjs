import { isReasoningEffort } from './reasoning-efforts.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { operateSharedDatabase } from './shared-config-database.mjs';
import TOML from '@iarna/toml';
import { readCurrentApiConfiguration } from './current-api-configuration.mjs';

const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export const createCcSwitchConfigService = ({ database = path.join(os.homedir(), '.cc-switch', 'cc-switch.db'), run, cacheMs = 15_000, now = () => Date.now(), currentApiConfiguration = readCurrentApiConfiguration } = {}) => {
  const invoke = run || ((request) => operateSharedDatabase(database, request));
  let cachedRecords = null;
  let cachedRecordsAt = 0;
  let recordsRequest = null;
  const records = (force = false) => {
    if (!force && cachedRecords && now() - cachedRecordsAt < cacheMs) return Promise.resolve(cachedRecords);
    if (recordsRequest) return recordsRequest;
    recordsRequest = invoke({ action: 'list' })
      .then((result) => {
        cachedRecords = Array.isArray(result) ? result : [];
        cachedRecordsAt = now();
        return cachedRecords;
      })
      .finally(() => { recordsRequest = null; });
    return recordsRequest;
  };
  const decode = (row) => {
    const settings = JSON.parse(row.settings_config);
    const config = TOML.parse(settings.config || '');
    const provider = config.model_providers?.[config.model_provider] || {};
    const key = settings.auth?.OPENAI_API_KEY || provider.experimental_bearer_token || (provider.env_key ? process.env[provider.env_key] : '') || '';
    return { id: row.id, name: row.name, baseUrl: provider.base_url || '', model: config.model || '', reasoningEffort: config.model_reasoning_effort || '',
      wireApi: provider.wire_api || 'responses', multiplier: row.cost_multiplier || '1.0', configured: Boolean(key), hasCredential: Boolean(settings.auth?.OPENAI_API_KEY || provider.experimental_bearer_token || provider.env_key), key,
      editable: Boolean(config.model_provider && !provider.auth && !settings.auth?.tokens),
      switchable: Boolean(provider.base_url?.startsWith('https://') && key && !provider.auth && (!provider.wire_api || provider.wire_api === 'responses')),
      isCurrent: Boolean(row.is_current),
      settings, config };
  };
  const publicEntry = ({ key, settings, config, ...entry }) => entry;
  let cachedList = null;
  let cachedListAt = 0;
  let listRequest = null;
  const list = async (lookupRatios, { force = false } = {}) => {
    if (!force && cachedList && now() - cachedListAt < cacheMs) return cachedList;
    if (listRequest) return listRequest;
    listRequest = (async () => {
      const entries = (await records(force)).map((row) => {
      try { return decode(row); } catch { return { id: row.id, name: row.name, configured: false, editable: false, switchable: false, multiplier: row.cost_multiplier }; }
      });
      const ratios = lookupRatios ? await lookupRatios(entries).catch(() => ({})) : {};
      const result = entries.map((entry) => ({ ...publicEntry(entry), ...(ratios[entry.id] || {}) }));
      cachedList = result;
      cachedListAt = now();
      return result;
    })().finally(() => { listRequest = null; });
    return listRequest;
  };
  const runtimeProviders = async ({ force = false } = {}) => (await records(force)).flatMap((row) => {
    try {
      const item = decode(row);
      if (!item.editable || !item.baseUrl.startsWith('https://') || !item.key || item.wireApi !== 'responses') return [];
      return [{ id: `ccswitch_${item.id}`, displayName: item.name, baseUrl: item.baseUrl,
        wireApi: item.wireApi, defaultModel: item.model, key: item.key, multiplier: item.multiplier,
        credentialFingerprint: createHash('sha256').update(row.settings_config).digest('hex'),
        models: item.model ? [{ id: `ccswitch_${item.id}::${item.model}`, model: item.model, displayName: item.model }] : [] }];
    } catch { return []; }
  });
  const currentDisplayName = async ({ force = false } = {}) => (await records(force)).find((row) => row.is_current)?.name || '';
  const sourceFor = async (id, rows) => {
    if (id === 'current') {
      const native = await currentApiConfiguration();
      if (!native) throw failure('当前配置的 Key 不可读取');
      return { ...native, model: native.model || '', editable: true };
    }
    const row = rows.find(row => row.id === id);
    if (!row) throw failure('配置已不存在，请刷新', 409);
    return decode(row);
  };
  const draftSecret = async (input, previous, rows) => {
    const mode = input.keyMode || (input.apiKey ? 'replace' : previous || input.sourceId ? 'keep' : 'clear');
    if (mode === 'clear') return '';
    if (mode === 'replace') {
      const key = String(input.apiKey || '').trim();
      if (key.length > 4096 || /[\r\n]/u.test(key)) throw failure('Key 格式无效');
      return key;
    }
    if (mode !== 'keep') throw failure('Key 操作无效');
    const source = input.sourceId ? await sourceFor(input.sourceId, rows) : previous;
    return source?.key || '';
  };
  const resolveDraft = async (input) => {
    const rows = await records(true);
    const previous = input.id ? await sourceFor(input.id, rows) : null;
    const key = await draftSecret(input, previous, rows);
    let url;
    try { url = new URL(input.baseUrl); } catch { throw failure('请填写 API 地址'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw failure('测试需要有效的 HTTPS API 地址');
    const baseUrl = url.href.replace(/\/$/u, '');
    const source = input.sourceId ? await sourceFor(input.sourceId, rows) : previous;
    if ((input.keyMode === 'keep' || (!input.keyMode && !input.apiKey)) && source?.baseUrl?.replace(/\/$/u, '') !== baseUrl) throw failure('地址已更改，请重新填写 Key');
    if (!key) throw failure('请填写 API Key');
    return { baseUrl, key };
  };
  const save = async (input) => {
    const rows = await records(true);
    const existing = input.id ? rows.find(row => row.id === input.id) : null;
    if (input.id && !existing) throw failure('配置已不存在，请刷新', 409);
    const previous = existing ? decode(existing) : null;
    if (previous && !previous.editable) throw failure('此认证方式暂不支持编辑');
    if (existing?.is_current) throw failure('此配置正在被电脑使用，请复制后修改', 409);
    const source = input.sourceId ? await sourceFor(input.sourceId, rows) : null;
    const name = String(input.name || '').trim() || '未命名配置';
    const model = String(input.model || '').trim();
    const baseUrl = String(input.baseUrl || '').trim().replace(/\/$/u, '');
    const effort = String(input.reasoningEffort ?? previous?.reasoningEffort ?? source?.reasoningEffort ?? '');
    if (name.length > 160 || model.length > 120 || model.includes('::') || baseUrl.length > 2000
      || !isReasoningEffort(effort)) throw failure('配置内容格式无效');
    const secret = await draftSecret(input, previous, rows);
    const config = structuredClone(previous?.config || source?.config || {});
    const providerId = config.model_provider || 'negus_channel';
    if (model) config.model = model; else delete config.model;
    if (effort) config.model_reasoning_effort = effort; else delete config.model_reasoning_effort;
    config.model_provider = providerId;
    config.model_providers ||= {};
    config.model_providers[providerId] = { ...config.model_providers[providerId], name, base_url: baseUrl,
      wire_api: config.model_providers[providerId]?.wire_api || 'responses' };
    const credentialMode = input.keyMode || (input.apiKey ? 'replace' : previous || source ? 'keep' : 'clear');
    const settings = structuredClone(previous?.settings || source?.settings || {});
    if (credentialMode !== 'keep' || (!previous?.settings && !source?.settings)) {
      delete config.model_providers[providerId].experimental_bearer_token;
      delete config.model_providers[providerId].env_key;
      settings.auth = { ...settings.auth, auth_mode: 'apikey', OPENAI_API_KEY: secret };
    }
    settings.config = TOML.stringify(config);
    const savedId = existing?.id || randomUUID();
    await invoke({ action: 'save', id: savedId, expectedConfig: existing?.settings_config || null,
      expectedRow: existing ? JSON.stringify(existing) : null, name, config: JSON.stringify(settings),
      multiplier: input.multiplier && Number.isFinite(Number(input.multiplier)) && Number(input.multiplier) > 0 ? String(input.multiplier) : previous?.multiplier || source?.multiplier || '1.0' });
    cachedRecords = null; cachedList = null; cachedRecordsAt = 0; cachedListAt = 0;
    return { saved: true, id: savedId, notice: '已保存' };
  };
  const remove = async (id) => {
    const rows = await records(true);
    const existing = rows.find((row) => row.id === id);
    if (!existing) throw failure('配置已不存在，请刷新', 409);
    if (existing.is_current) throw failure('此配置正在被电脑 Codex 使用，暂不删除；可在 Negus 中归档', 409);
    await invoke({ action: 'delete', id, expectedConfig: existing.settings_config, expectedRow: JSON.stringify(existing) });
    cachedRecords = null;
    cachedList = null;
    cachedRecordsAt = 0;
    cachedListAt = 0;
    return { deleted: true, notice: '已从共享配置删除。' };
  };
  const readCredential = async (providerId, fingerprint) => {
    const id = String(providerId).replace(/^ccswitch_/u, "");
    const row = (await invoke({ action: "list" })).find(entry => entry.id === id);
    if (!row) throw failure("供应商配置已不存在，请刷新。", 409);
    if (fingerprint && createHash("sha256").update(row.settings_config).digest("hex") !== fingerprint) {
      throw failure("供应商配置已变更，请在任务结束后重新加载运行环境。", 409);
    }
    const entry = decode(row);
    if (!entry.switchable) throw failure("此配置暂不支持使用 API Key 接入。", 400);
    return entry.key;
  };
  const credentialCommand = (providerId, fingerprint) => ({
    command: process.execPath,
    args: [fileURLToPath(new URL("../scripts/shared-provider-credential.mjs", import.meta.url)), path.resolve(database), providerId, fingerprint],
  });
  return { list, save, remove, resolveDraft, runtimeProviders, currentDisplayName, readCredential, credentialCommand };
};
