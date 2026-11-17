import { randomBytes } from 'node:crypto';
import { createCloudflareConnection, callbackPath } from '../connections/cloudflare.mjs';
import { readJson, runtime } from '../../../scripts/negus-service-common.mjs';
import { readJson as readBody, sendJson } from '../http/request-utils.mjs';
import path from 'node:path';

export const createConnectionRoutes = ({ connection = createCloudflareConnection(), getHostname = async () => (await readJson(path.join(runtime, 'negus-tunnel.json')))?.hostname } = {}) => async (request, response, url) => {
  if (url.pathname !== '/api/connections/cloudflare' && url.pathname !== callbackPath) return false;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (url.pathname === callbackPath) {
    if (request.method !== 'GET') { sendJson(response, { error: '不支持的请求方法' }, 405); return true; }
    const binding = String(request.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('negus_cf_oauth='))?.slice('negus_cf_oauth='.length) || '';
    try {
      await connection.callback(url.searchParams, binding);
      response.writeHead(303, { Location: '/?view=settings&settings=connections', 'Set-Cookie': 'negus_cf_oauth=; Path=/integrations/cloudflare; HttpOnly; SameSite=Lax; Max-Age=0' }); response.end();
    } catch (error) { sendJson(response, { error: error.statusCode === 400 ? error.message : 'Cloudflare 授权失败，请返回 Negus 的账号连接重试。' }, 400); }
    return true;
  }
  if (request.method === 'GET') { sendJson(response, await connection.status()); return true; }
  if (request.method !== 'POST') { sendJson(response, { error: '不支持的请求方法' }, 405); return true; }
  // State-changing actions require the same origin; no forwarded-host trust or caller-chosen redirect URI.
  const hostname = await getHostname();
  const host = String(request.headers.host || '');
  const local = /^(localhost|127\.0\.0\.1):\d+$/.test(host);
  const origin = local ? 'http://' + host : hostname && host === hostname ? 'https://' + hostname : '';
  if (!origin || request.headers.origin !== origin) { sendJson(response, { error: '请从 Negus 的正式访问地址操作账号连接。' }, 403); return true; }
  const input = await readBody(request, 1024);
  if (input.action === 'connect') {
    const binding = randomBytes(32).toString('hex');
    const result = await connection.connect(origin, binding);
    response.setHeader('Set-Cookie', `negus_cf_oauth=${binding}; Path=/integrations/cloudflare; HttpOnly; SameSite=Lax; Max-Age=600${local ? '' : '; Secure'}`);
    sendJson(response, result);
  } else if (input.action === 'disconnect') sendJson(response, await connection.disconnect());
  else if (input.action === 'test') {
    const { tools } = await connection.tools();
    sendJson(response, { ok: true, toolCount: tools.length });
  } else sendJson(response, { error: '不支持的操作' }, 400);
  return true;
};
