import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { auth, Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { runtime, readJson, writeJson, withLock } from '../../../scripts/negus-service-common.mjs';

export const cloudflareUrl = 'https://mcp.cloudflare.com/mcp';
export const callbackPath = '/integrations/cloudflare/callback';
const scope = 'offline_access user:read account:read zone.read dns.read dns.write pages.metadata_read workers-scripts.read workers-scripts.write workers-scripts.edit analytics.read account-analytics.read';
const hash = value => createHash('sha256').update(value).digest('hex');
const matches = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sharedLock = async task => {
  const deadline = Date.now() + 30000;
  for (;;) {
    try { return await withLock('cloudflare-connection', task); }
    catch (error) {
      if (!error.message.startsWith('cloudflare-connection is already running') || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
};
const failure = message => Object.assign(new Error(message), { statusCode: 400 });
const fetchBounded = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(20000), ...(init.signal ? [init.signal] : [])]) });

// One workspace connection, independent of model-provider CODEX_HOME. Tokens never leave the host.
export const createCloudflareConnection = ({ directory = runtime, authorize = auth, fetchImpl = fetchBounded, createClient = () => new Client({ name: 'negus-cloudflare', version: '1.0.0' }), lock = sharedLock } = {}) => {
  const file = path.join(directory, 'connections/cloudflare.json');
  const pendingFile = path.join(directory, 'connections/cloudflare-pending.json');
  const provider = (data, save, redirect) => ({
    redirectUrl: data.redirectUri,
    clientMetadata: { client_name: 'Negus Cloudflare', redirect_uris: [data.redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    state: () => data.state,
    clientInformation: () => data.client,
    saveClientInformation: async value => { data.client = value; await save(data); },
    tokens: () => data.tokens,
    saveTokens: async value => { data.tokens = { ...value, refresh_token: value.refresh_token || data.tokens?.refresh_token }; data.connectedAt ||= new Date().toISOString(); data.expiresAt = value.expires_in ? Date.now() + value.expires_in * 1000 : 0; await save(data); },
    saveCodeVerifier: async value => { data.verifier = value; await save(data); },
    codeVerifier: () => data.verifier,
    saveDiscoveryState: async value => { data.discovery = value; await save(data); },
    discoveryState: () => data.discovery,
    redirectToAuthorization: redirect || (() => { throw failure('Cloudflare 需要重新授权，请进入设置 → 账号连接。'); }),
    invalidateCredentials: async kind => {
      if (kind === 'all' || kind === 'tokens') delete data.tokens;
      if (kind === 'all' || kind === 'client') delete data.client;
      if (kind === 'all' || kind === 'verifier') delete data.verifier;
      if (kind === 'all' || kind === 'discovery') delete data.discovery;
      await save(data);
    },
  });
  const save = data => writeJson(file, data);
  const connected = async () => {
    const data = await readJson(file, {});
    if (!data.tokens) throw failure('请先进入设置 → 账号连接，连接您的 Cloudflare。');
    return data;
  };
  const remote = async action => {
    const data = await connected();
    const p = provider(data, save);
    const client = createClient();
    try {
      if (data.expiresAt && data.expiresAt < Date.now() + 60000) {
        if (!data.tokens.refresh_token) throw failure('Cloudflare 授权已过期，请重新连接。');
        await authorize(p, { serverUrl: cloudflareUrl, fetchFn: fetchImpl });
      }
      await client.connect(new StreamableHTTPClientTransport(new URL(cloudflareUrl), { authProvider: p, fetch: fetchImpl, onInsufficientScope: 'throw' }));
      return await action(client);
    } catch (error) {
      // Never relay OAuth responses, credentials, or upstream request bodies to the browser/model.
      if (error.statusCode === 400) throw error;
      const status = Number(error.code || error.status);
      const message = status === 401 ? 'Cloudflare 授权已过期，请重新连接。' : status === 403 ? 'Cloudflare 拒绝访问，请重新授权并选择所需权限。' : status === 429 ? 'Cloudflare 请求频率受限，请稍后重试。' : 'Cloudflare 连接失败，请检查网络或重新连接。';
      throw Object.assign(new Error(message), { statusCode: 502 });
    } finally { await client.close().catch(() => {}); }
  };
  return {
    status: async () => {
      const data = await readJson(file, {});
      return { connected: Boolean(data.tokens), connectedAt: data.connectedAt || null, scope: data.tokens?.scope || '' };
    },
    connect: (origin, binding) => lock(async () => {
      const data = { redirectUri: origin + callbackPath, state: randomBytes(32).toString('hex'), binding: hash(binding), deadline: Date.now() + 10 * 60000 };
      let url;
      const p = provider(data, value => writeJson(pendingFile, value), target => { url = target.href; });
      try { await authorize(p, { serverUrl: cloudflareUrl, scope, fetchFn: fetchImpl }); }
      catch { throw failure('Cloudflare 授权服务连接失败，请稍后重试。'); }
      if (!url) throw failure('Cloudflare 未返回授权地址。');
      return { url };
    }),
    callback: (params, binding) => lock(async () => {
      const data = await readJson(pendingFile, {});
      if (!matches(data.state, params.get('state')) || !matches(data.binding, hash(binding)) || !(data.deadline > Date.now())) throw failure('授权请求已失效，请回到账号连接重新开始。');
      // Consume before exchange: callbacks cannot be replayed, including after a failed exchange.
      await fs.rm(pendingFile, { force: true });
      if (params.has('error') || !params.get('code')) throw failure('Cloudflare 授权已取消，请重新连接。');
      try {
        await authorize(provider(data, async () => {}), { serverUrl: cloudflareUrl, authorizationCode: params.get('code'), iss: params.get('iss') || undefined, fetchFn: fetchImpl });
      } catch { throw failure('Cloudflare 授权交换失败，请重新连接。'); }
      if (!data.tokens) throw failure('Cloudflare 未返回有效授权。');
      delete data.state; delete data.binding; delete data.deadline; delete data.verifier;
      await save(data);
    }),
    disconnect: () => lock(async () => {
      await fs.rm(file, { force: true }); await fs.rm(pendingFile, { force: true });
      return { connected: false };
    }),
    tools: () => lock(() => remote(client => client.listTools())),
    call: params => lock(() => remote(client => client.callTool(params))),
  };
};
