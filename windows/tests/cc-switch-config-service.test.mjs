import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCcSwitchConfigService } from '../server/cc-switch-config-service.mjs';
import { createModelProviderService } from '../server/model-provider-service.mjs';
import { createFushengUsageService } from '../server/fusheng-usage-service.mjs';
import { createSystemRoutes } from '../server/routes/system-routes.mjs';

test('shared database round trip preserves metadata and selection; backs up; never returns keys', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-cc-switch-'));
  const database = path.join(root, 'cc-switch.db');
  try {
    execFileSync('python', ['-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE providers(id TEXT,app_type TEXT,name TEXT,settings_config TEXT,meta TEXT,is_current INTEGER,cost_multiplier TEXT,created_at INTEGER,sort_index INTEGER,PRIMARY KEY(id,app_type))")
c.commit()`, database]);
    const service = createCcSwitchConfigService({ database });
    await service.save({ name: 'Test', baseUrl: 'https://example.com/v1', model: 'gpt-test', apiKey: 'private-test-key', multiplier: '0.5' });
    const [first] = await service.list();
    assert.equal(first.name, 'Test');
    assert.equal(first.multiplier, '0.5');
    assert.ok(!JSON.stringify(first).includes('private-test-key'));
    execFileSync('python', ['-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute("UPDATE providers SET meta=?", ('{"custom":true}',)); c.commit()`, database]);
    await service.save({ ...first, name: 'Renamed', apiKey: '', multiplier: '0.7' });
    assert.equal((await service.runtimeProviders())[0].key, 'private-test-key');
    const state = JSON.parse(execFileSync('python', ['-c', `import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute('SELECT meta,is_current FROM providers').fetchone()))`, database], { encoding: 'utf8' }));
    assert.deepEqual(state, ['{"custom":true}', 0]);
    assert.equal((await fs.readdir(path.join(root, 'backups'))).length, 2);
    execFileSync('python', ['-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE providers SET is_current=1'); c.commit()`, database]);
    await assert.rejects(service.save({ ...first, name: 'Blocked' }), /先在 CC Switch/);
    await assert.rejects(service.save({ ...first, baseUrl: 'http://example.com' }), /HTTPS/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('same model on two channels has unique selection and routes to requested provider', async () => {
  const saves = [];
  const service = createModelProviderService({ projectRoot: process.cwd(),
    credentialStore: { save: async (...args) => saves.push(args), isConfigured: async () => true },
    sharedConfig: { runtimeProviders: async () => ['a', 'b'].map((id) => ({ id: `ccswitch_${id}`, displayName: id,
      baseUrl: 'https://example.com/v1', defaultModel: 'gpt-test', key: 'secret', models: [{ model: 'gpt-test' }] })) },
  });
  const models = await service.listModels([]);
  assert.ok(models.some((entry) => entry.model === 'ccswitch_a::gpt-test'));
  assert.ok(models.some((entry) => entry.model === 'ccswitch_b::gpt-test'));
  assert.equal(service.resolveRoute({ model: 'ccswitch_b::gpt-test' }).modelProviderId, 'ccswitch_b');
  assert.equal(service.resolveRoute({ model: 'ccswitch_b::gpt-test' }).model, 'gpt-test');
  assert.equal(service.resolveRoute({ model: 'gpt-test' }).modelProviderId, 'current');
  assert.throws(() => service.resolveRoute({ model: 'ccswitch_b::unregistered' }), /does not belong/);
  await service.listModels([]);
  assert.equal(saves.length, 2);
});

test('supplier ratio uses the actual token name and rejects ambiguous or foreign channel matches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-channel-price-'));
  try {
    const credentialsFile = path.join(root, 'credentials.json');
    await fs.writeFile(credentialsFile, JSON.stringify({ base_url: 'https://example.com', user_id: 1, access_token: 'account-secret' }));
    const service = createFushengUsageService({ credentialsFile, fetchImpl: async (url, options) => {
      const pathname = new URL(url).pathname;
      assert.equal(new URL(url).hostname, 'example.com');
      if (pathname === '/api/token/') return { ok: true, status: 200, json: async () => ({ data: { total: 3, items: [{ name: 'discount', group: 'sale' }, { name: 'ambiguous', group: 'sale' }, { name: 'ambiguous', group: 'vip' }] } }) };
      if (pathname === '/api/pricing') return { ok: true, status: 200, json: async () => ({ group_ratio: { sale: 0.13, vip: 0.28 } }) };
      assert.equal(pathname, '/api/usage/token/');
      return { ok: true, status: 200, json: async () => ({ data: { name: options.headers.Authorization === 'Bearer sale-key' ? 'discount' : 'ambiguous' } }) };
    } });
    const ratios = await service.readChannelRatios([{ id: 'sale', baseUrl: 'https://example.com/v1', key: 'sale-key' }, { id: 'ambiguous', baseUrl: 'https://example.com/v1', key: 'other-key' }, { id: 'foreign', baseUrl: 'https://other.com/v1', key: 'never-send' }]);
    assert.deepEqual(ratios, { sale: { priceRatio: 0.13, priceGroup: 'sale', ratioSource: 'supplier' } });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('channel catalog is handled independently of any selected conversation', async () => {
  const route = createSystemRoutes({ projectRoot: process.cwd(), modelProviders: { sharedConfig: { list: async () => [{ id: 'sale', priceRatio: 0.13 }] } } });
  let payload;
  const response = { setHeader() {}, writeHead() {}, end(value) { payload = JSON.parse(value); } };
  assert.equal(await route({ method: 'GET' }, response, new URL('http://localhost/api/model-channels')), true);
  assert.equal(payload.channels[0].priceRatio, 0.13);
});
