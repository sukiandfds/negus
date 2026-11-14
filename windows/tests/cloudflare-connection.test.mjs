import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';
import { createCloudflareConnection } from '../server/connections/cloudflare.mjs';
import { cloudflareMcpArguments } from '../server/connections/cloudflare-runtime.mjs';
import { createConnectionRoutes } from '../server/routes/connection-routes.mjs';
import { Readable } from 'node:stream';

const fixture = async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-cf-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'connections/cloudflare.json');
  let exchanges = 0, refreshes = 0, connections = 0;
  const authorize = async (p, opts) => {
    if (opts.authorizationCode) {
      exchanges++;
      assert.equal(await p.codeVerifier(), 'pkce-verifier');
      await p.saveTokens({ access_token: 'private-token', refresh_token: 'private-refresh', token_type: 'bearer', expires_in: 3600 });
      return 'AUTHORIZED';
    }
    if (await p.tokens()) { refreshes++; await p.saveTokens({ access_token: 'refreshed', refresh_token: 'rotated', expires_in: 3600 }); return 'AUTHORIZED'; }
    await p.saveClientInformation({ client_id: 'client' });
    await p.saveCodeVerifier('pkce-verifier');
    await p.saveDiscoveryState({ authorizationServerUrl: 'https://mcp.cloudflare.com' });
    await p.redirectToAuthorization(new URL('https://mcp.cloudflare.com/authorize?state=' + await p.state()));
    return 'REDIRECT';
  };
  const make = () => createCloudflareConnection({ directory, authorize, lock: task => task(), createClient: () => ({
    connect: async () => { connections++; }, close: async () => {}, listTools: async () => ({ tools: [{ name: 'search', inputSchema: { type: 'object' } }] }), callTool: async params => ({ content: [{ type: 'text', text: params.name }] }),
  }) });
  const connection = make();
  const start = async () => {
    const { url } = await connection.connect('https://negus.example', 'browser-binding');
    return new URLSearchParams({ state: new URL(url).searchParams.get('state'), code: 'code' });
  };
  return { directory, file, make, connection, start, counts: () => ({ exchanges, refreshes, connections }) };
};
test('OAuth callback requires state AND browser binding; credentials remain private and shared across instances', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.connection.status(), { connected: false, connectedAt: null, scope: '' });
  const params = await f.start();
  await assert.rejects(f.connection.callback(params, 'other-browser'), /失效/);
  await assert.rejects(f.connection.callback(new URLSearchParams({ state: 'wrong', code: 'code' }), 'browser-binding'), /失效/);
  assert.equal(f.counts().exchanges, 0);
  await f.connection.callback(params, 'browser-binding');
  const status = await f.make().status();
  assert.equal(status.connected, true);
  assert.ok(!JSON.stringify(status).includes('private'));
  assert.equal((await fs.stat(f.file)).mode & 0o777, 0o600);
  const stored = JSON.parse(await fs.readFile(f.file));
  assert.equal(stored.verifier, undefined);
  await assert.rejects(f.connection.callback(params, 'browser-binding'), /失效/);
  assert.equal(f.counts().exchanges, 1);
  assert.equal((await f.make().tools()).tools[0].name, 'search');
});
test('expired callbacks and cancelled authorization never install tokens', async t => {
  const f = await fixture(t); const params = await f.start();
  const pending = path.join(f.directory, 'connections/cloudflare-pending.json');
  const d = JSON.parse(await fs.readFile(pending)); d.deadline = 0; await fs.writeFile(pending, JSON.stringify(d));
  await assert.rejects(f.connection.callback(params, 'browser-binding'), /失效/);
  const next = await f.start(); next.set('error', 'access_denied');
  await assert.rejects(f.connection.callback(next, 'browser-binding'), /取消/);
  assert.equal((await f.connection.status()).connected, false);
});
test('refresh rotates shared tokens and disconnect prevents further upstream access', async t => {
  const f = await fixture(t); await f.connection.callback(await f.start(), 'browser-binding');
  const stored = JSON.parse(await fs.readFile(f.file)); stored.expiresAt = 1; await fs.writeFile(f.file, JSON.stringify(stored));
  await f.make().tools(); assert.equal(f.counts().refreshes, 1);
  assert.equal(JSON.parse(await fs.readFile(f.file)).tokens.refresh_token, 'rotated');
  await f.connection.disconnect(); const calls = f.counts().connections;
  await assert.rejects(f.make().tools(), /请先/); assert.equal(f.counts().connections, calls);
});
test('same shared MCP arguments apply independently of provider homes and preserve valid TOML', () => {
  const args = cloudflareMcpArguments(); const config = TOML.parse(args[1]);
  assert.equal(config.mcp_servers.negus_cloudflare.enabled, true);
  assert.ok(config.mcp_servers.negus_cloudflare.env.NEGUS_INSTALL_ROOT);
  assert.ok(path.isAbsolute(config.mcp_servers.negus_cloudflare.command));
});
test('connection routes reject cross-origin changes and arbitrary callback origins', async () => {
  let called = 0;
  const route = createConnectionRoutes({ connection: { connect: async () => { called++; return { url: 'https://mcp.cloudflare.com/authorize' }; } }, getHostname: async () => 'negus.example' });
  const invoke = async (host, origin) => {
    const request = Readable.from([Buffer.from('{"action":"connect"}')]); request.method = 'POST'; request.headers = { host, origin };
    const response = { setHeader() {}, writeHead(code) { this.status = code; }, end() {} };
    await route(request, response, new URL('https://negus.example/api/connections/cloudflare')); return response.status;
  };
  assert.equal(await invoke('attacker.example', 'https://attacker.example'), 403);
  assert.equal(await invoke('negus.example', 'https://attacker.example'), 403);
  assert.equal(await invoke('negus.example', undefined), 403);
  assert.equal(called, 0);
  assert.equal(await invoke('negus.example', 'https://negus.example'), 200);
  assert.equal(called, 1);
});
test('real stdio bridge stays available before authorization and never exposes credentials', async t => {
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const f = await fixture(t);
  const client = new Client({ name: 'connection-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('windows/server/connections/cloudflare-mcp.mjs')], env: { ...process.env, NEGUS_INSTALL_ROOT: f.directory } }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['call', 'discover', 'status']);
  const status = await client.callTool({ name: 'status', arguments: {} });
  assert.equal(JSON.parse(status.content[0].text).connected, false);
  const discovery = await client.callTool({ name: 'discover', arguments: {} });
  assert.equal(discovery.isError, true);
  assert.match(discovery.content[0].text, /请先/);
});
