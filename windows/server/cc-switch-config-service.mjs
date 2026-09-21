import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import TOML from '@iarna/toml';

const script = fileURLToPath(new URL('../scripts/cc-switch-db.py', import.meta.url));
const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export const createCcSwitchConfigService = ({ database = path.join(os.homedir(), '.cc-switch', 'cc-switch.db'), python = 'python', run } = {}) => {
  const invoke = run || ((request) => new Promise((resolve, reject) => {
    const child = spawn(python, [script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(failure('CC Switch 配置操作超时', 503)); }, 15000);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(failure('无法访问 CC Switch 配置，请检查本机 Python 和安装位置', 503)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(failure('CC Switch 配置保存失败，请刷新后重试', 409));
      try { resolve(JSON.parse(output)); } catch { reject(failure('CC Switch 配置读取失败', 503)); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ ...request, database }));
  }));
  const records = () => invoke({ action: 'list' });
  const decode = (row) => {
    const settings = JSON.parse(row.settings_config);
    const config = TOML.parse(settings.config || '');
    const provider = config.model_providers?.[config.model_provider] || {};
    const key = settings.auth?.OPENAI_API_KEY || provider.experimental_bearer_token || (provider.env_key ? process.env[provider.env_key] : '') || '';
    return { id: row.id, name: row.name, baseUrl: provider.base_url || '', model: config.model || '',
      wireApi: provider.wire_api || 'responses', multiplier: row.cost_multiplier || '1.0', configured: Boolean(key), key,
      editable: Boolean(provider.base_url && key && !provider.auth),
      switchable: Boolean(provider.base_url?.startsWith('https://') && key && config.model && !provider.auth && (!provider.wire_api || provider.wire_api === 'responses')),
      settings, config };
  };
  const publicEntry = ({ key, settings, config, ...entry }) => entry;
  const list = async (lookupRatios) => {
    const entries = (await records()).map((row) => {
      try { return decode(row); } catch { return { id: row.id, name: row.name, configured: false, editable: false, switchable: false, multiplier: row.cost_multiplier }; }
    });
    const ratios = lookupRatios ? await lookupRatios(entries).catch(() => ({})) : {};
    return entries.map((entry) => ({ ...publicEntry(entry), ...(ratios[entry.id] || {}) }));
  };
  const runtimeProviders = async () => (await records()).flatMap((row) => {
    try {
      const item = decode(row);
      if (!item.editable || !item.model || item.wireApi !== 'responses') return [];
      return [{ id: `ccswitch_${item.id}`, displayName: item.name, baseUrl: item.baseUrl,
        wireApi: item.wireApi, defaultModel: item.model, key: item.key, multiplier: item.multiplier,
        models: [{ id: `ccswitch_${item.id}::${item.model}`, model: item.model, displayName: item.model }] }];
    } catch { return []; }
  });
  const save = async (input) => {
    const name = String(input.name || '').trim();
    const model = String(input.model || '').trim();
    const key = String(input.apiKey || '').trim();
    const multiplier = String(input.multiplier || '1.0');
    let url;
    try { url = new URL(input.baseUrl); } catch { throw failure('请输入有效的 API 地址'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw failure('API 地址需为 HTTPS，且不能包含账号或参数');
    if (!name || name.length > 160 || !model || model.length > 120 || !Number.isFinite(Number(multiplier)) || Number(multiplier) <= 0 || key.length > 4096 || /[\r\n]/u.test(key)) throw failure('请检查名称、模型、Key 和倍率');
    const rows = await records();
    const existing = input.id ? rows.find((row) => row.id === input.id) : null;
    if (input.id && !existing) throw failure('渠道已不存在，请刷新', 409);
    const previous = existing ? decode(existing) : null;
    if (previous && !previous.editable) throw failure('此认证方式暂不支持在 Negus 编辑');
    // Active CC Switch entries also project into Codex live files. Do not bypass that lifecycle.
    if (existing?.is_current) throw failure('请先在 CC Switch 切到其他渠道，再编辑此渠道', 409);
    const secret = key || previous?.key;
    if (!secret) throw failure('请输入 API Key');
    const config = previous?.config || {};
    const providerId = config.model_provider || 'negus_channel';
    config.model = model;
    config.model_provider = providerId;
    config.model_providers ||= {};
    config.model_providers[providerId] = { ...config.model_providers[providerId], name, base_url: url.href.replace(/\/$/u, ''), wire_api: 'responses' };
    delete config.model_providers[providerId].experimental_bearer_token;
    delete config.model_providers[providerId].env_key;
    const settings = { ...previous?.settings, auth: { ...previous?.settings.auth, auth_mode: 'apikey', OPENAI_API_KEY: secret }, config: TOML.stringify(config) };
    await invoke({ action: 'save', id: existing?.id || randomUUID(), expectedConfig: existing?.settings_config || null,
      name, config: JSON.stringify(settings), multiplier });
    return { saved: true, notice: '已保存到 CC Switch；若桌面列表未更新，请刷新或重新打开。' };
  };
  return { list, save, runtimeProviders };
};
