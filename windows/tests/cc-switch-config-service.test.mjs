import TOML from "@iarna/toml";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { operateSharedDatabase } from '../server/shared-config-database.mjs';
import { createCcSwitchConfigService } from '../server/cc-switch-config-service.mjs';
import { createModelProviderService } from '../server/model-provider-service.mjs';
import { createFushengUsageService } from '../server/fusheng-usage-service.mjs';
import { createSystemRoutes } from '../server/routes/system-routes.mjs';

test('shared database round trip preserves metadata and selection; backs up; never returns keys', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-cc-switch-'));
  const database = path.join(root, 'cc-switch.db');
  try {
    const service = createCcSwitchConfigService({ database });
    await service.save({ name: 'Test', baseUrl: 'https://example.com/v1', model: 'gpt-test', apiKey: 'private-test-key', multiplier: '0.5' });
    const [first] = await service.list();
    assert.equal(first.name, 'Test');
    assert.equal(first.multiplier, '0.5');
    assert.ok(!JSON.stringify(first).includes('private-test-key'));
    let db = new DatabaseSync(database);
    db.prepare("UPDATE providers SET meta=?").run('{"custom":true}');
    db.close();
    await service.save({ ...first, name: 'Renamed', apiKey: '', multiplier: '0.7' });
    assert.equal((await service.runtimeProviders())[0].key, 'private-test-key');
    db = new DatabaseSync(database);
    const row = db.prepare("SELECT meta,is_current FROM providers").get();
    const state = [row.meta, row.is_current];
    db.close();
    assert.deepEqual(state, ['{"custom":true}', 0]);
    assert.equal((await fs.readdir(path.join(root, 'backups'))).length, 2);
    db = new DatabaseSync(database); db.exec("UPDATE providers SET is_current=1"); db.close();
    await assert.rejects(service.save({ ...first, name: 'Blocked' }), /复制后修改/);
    await assert.rejects(service.resolveDraft({ ...first, baseUrl: 'http://example.com', keyMode: 'keep' }), /HTTPS/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('same model on two channels has unique selection and routes to requested provider', async () => {
  const saves = [];
  const service = createModelProviderService({ currentApiConfiguration: async () => null, projectRoot: process.cwd(),
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
  assert.equal(saves.length, 0, 'shared credentials must not be copied into DPAPI');
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

const fixture = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-shared-node-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const database = path.join(root, '.cc-switch', 'cc-switch.db');
  const service = createCcSwitchConfigService({ database });
  return { root, database, service };
};
const input = { name: 'Independent provider', baseUrl: 'https://example.com/v1', model: 'gpt-test', apiKey: 'fixture-secret', multiplier: '1' };

test('first-use reads create nothing; saving initializes shared DB; Node auth reads without Python or PowerShell', async (t) => {
  const { database, service } = await fixture(t);
  assert.deepEqual(await service.list(), []);
  await assert.rejects(fs.stat(database), { code: 'ENOENT' });
  await service.save(input);
  assert.equal((await fs.stat(database)).mode & 0o777, 0o600);
  const entries = await service.runtimeProviders({ force: true });
  assert.equal(entries.length, 1);
  const entry = entries[0];
  const auth = service.credentialCommand(entry.id);
  const secret = execFileSync(auth.command, auth.args, { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(secret, input.apiKey);
  assert.ok(!JSON.stringify(auth).includes(input.apiKey));
  const db = new DatabaseSync(database, { readOnly: true });
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM providers WHERE app_type='codex'").get().n, 1);
  db.close();
  const [publicEntry] = await service.list();
  // Reuse the already-generated command after default settings change.
  await service.save({ ...input, id: publicEntry.id, model: 'gpt-other', reasoningEffort: 'high', keyMode: 'keep' });
  assert.equal(execFileSync(auth.command, auth.args, { encoding: 'utf8' }), input.apiKey);
  // Existing runtime TOML may still pass the removed fingerprint argument.
  const legacyArgs = [...auth.args, '0'.repeat(64)];
  assert.equal(execFileSync(auth.command, legacyArgs, { encoding: 'utf8' }), input.apiKey);
  await service.save({ ...input, id: publicEntry.id, apiKey: 'changed-secret' });
  assert.equal(execFileSync(auth.command, legacyArgs, { encoding: 'utf8' }), 'changed-secret');
  await service.save({ ...input, id: publicEntry.id, keyMode: 'clear' });
  await assert.rejects(service.readCredential(entry.id), /不支持/);
  await service.remove(publicEntry.id);
  await assert.rejects(service.readCredential(entry.id), /不存在/);
});

test('existing unknown fields and other app rows survive; conflicts refuse writes; delete backs up and cascades', async (t) => {
  const { database, service } = await fixture(t);
  await service.save(input);
  let db = new DatabaseSync(database);
  db.exec("PRAGMA user_version=19; ALTER TABLE providers ADD COLUMN future_note TEXT; CREATE TABLE provider_endpoints(id INTEGER PRIMARY KEY,provider_id TEXT,app_type TEXT,FOREIGN KEY(provider_id,app_type) REFERENCES providers(id,app_type) ON DELETE CASCADE)");
  let row = db.prepare("SELECT * FROM providers").get();
  db.prepare("UPDATE providers SET future_note=?").run('preserve');
  db.prepare("INSERT INTO providers(id,app_type,name,settings_config) VALUES(?,?,?,?)").run(row.id, 'claude', 'other app', '{}');
  db.prepare("INSERT INTO provider_endpoints VALUES(1,?,'codex')").run(row.id);
  row = db.prepare("SELECT * FROM providers WHERE app_type='codex'").get();
  db.prepare("UPDATE providers SET name=? WHERE app_type='codex'").run('external change');
  db.close();
  await assert.rejects(operateSharedDatabase(database, { action: 'delete', id: row.id, expectedConfig: row.settings_config, expectedRow: JSON.stringify(row) }), /其他程序/);
  await service.save({ ...input, id: row.id, apiKey: '', name: 'Renamed' });
  db = new DatabaseSync(database);
  assert.equal(db.prepare("SELECT future_note FROM providers WHERE app_type='codex'").get().future_note, 'preserve');
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
  db.close();
  await service.remove(row.id);
  db = new DatabaseSync(database);
  assert.equal(db.prepare("SELECT count(*) AS n FROM providers WHERE app_type='claude'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM provider_endpoints").get().n, 0);
  db.close();
  const backups = await fs.readdir(path.join(path.dirname(database), 'backups'));
  assert.equal(backups.length, 3);
  for (const name of backups) {
    const file = path.join(path.dirname(database), 'backups', name);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const backupDb = new DatabaseSync(file, { readOnly: true });
    assert.equal(backupDb.prepare("PRAGMA integrity_check").get().integrity_check, 'ok');
    backupDb.close();
  }
});

test('legacy JSON and incompatible DB are never overwritten; newer schema refuses mutation', async (t) => {
  const { database, service } = await fixture(t);
  await fs.mkdir(path.dirname(database), { recursive: true });
  const legacy = path.join(path.dirname(database), 'config.json');
  await fs.writeFile(legacy, '{"legacy":"keep"}');
  await assert.rejects(service.save(input), /旧版/);
  await assert.rejects(fs.stat(database), { code: 'ENOENT' });
  assert.equal(await fs.readFile(legacy, 'utf8'), '{"legacy":"keep"}');
  await fs.rm(legacy);
  await service.save(input);
  const [entry] = await service.list();
  let db = new DatabaseSync(database); db.exec("PRAGMA user_version=20"); db.close();
  await assert.rejects(service.save({ ...input, id: entry.id }), /更新版本/);
  db = new DatabaseSync(database);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 20);
  assert.equal(db.prepare("SELECT name FROM providers").get().name, input.name);
  db.close();
  const unknown = path.join(path.dirname(database), 'unknown.db');
  db = new DatabaseSync(unknown); db.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('keep')"); db.close();
  await assert.rejects(createCcSwitchConfigService({ database: unknown }).save(input), /结构不兼容/);
  db = new DatabaseSync(unknown);
  assert.equal(db.prepare("SELECT value FROM unrelated").get().value, 'keep'); db.close();
});

test('shared model refresh and isolated command auth use same DB without credential copies; current stays independent', async (t) => {
  const { root, database, service: sharedConfig } = await fixture(t);
  await sharedConfig.save(input);
  const db = new DatabaseSync(database);
  db.prepare("UPDATE providers SET id=? WHERE app_type='codex'").run("折扣-1790603771586");
  db.close();
  const [entry] = await sharedConfig.runtimeProviders({ force: true });
  assert.equal(entry.id, "ccswitch_折扣-1790603771586");
  const auth = sharedConfig.credentialCommand(entry.id);
  assert.equal(execFileSync(auth.command, auth.args, { encoding: "utf8", env: { ...process.env, PATH: "" } }), input.apiKey);

  const models = createModelProviderService({ currentApiConfiguration: async () => null,
    projectRoot: root, sharedConfig,
    credentialStore: {
      save: async () => { throw Error('must not copy shared keys'); },
      read: async () => { throw Error('must not read DPAPI'); },
      isConfigured: async () => false,
    },
    fetchModels: async (url, options) => {
      assert.equal(url.href, input.baseUrl + '/models');
      assert.equal(options.headers.Authorization, 'Bearer ' + input.apiKey);
      return { ok: true, json: async () => ({ data: [{ id: 'gpt-new' }] }) };
    },
    createClient: options => ({ options, close() {} }),
  });
  t.after(() => models.close());
  await models.refreshProviderModels(entry.id);
  assert.ok((await models.listModels()).find(m => m.model === entry.id + '::gpt-new' && m.available));
  const client = await models.getClient({ model: entry.id + '::gpt-new' });
  const toml = await fs.readFile(path.join(client.options.codexHome, 'config.toml'), 'utf8');
  const parsed = TOML.parse(toml);
  assert.equal(parsed.model_provider, entry.id);
  assert.equal(parsed.model_providers[entry.id].base_url, input.baseUrl);
  assert.equal(parsed.model_providers[entry.id].auth.command, process.execPath);
  assert.equal(models.resolveRoute({ model: entry.id + "::gpt-new" }).modelProviderId, entry.id);
  assert.ok(toml.includes(process.execPath));
  assert.ok(toml.includes(database));
  assert.ok(!toml.includes('powershell') && !toml.includes(input.apiKey));
  const current = createModelProviderService({ currentApiConfiguration: async () => null, projectRoot: root,
    sharedConfig: { runtimeProviders: async () => { throw Error('unrelated broken integration'); } } });
  await current.refreshProviderModels('current');
  assert.ok((await current.listModels([{ model: 'gpt-current' }])).some(m => m.model === 'gpt-current' && m.available));
  current.close();
});

test("provider IDs reject path traversal, TOML injection and truncation collisions", () => {
  const service = createModelProviderService({ currentApiConfiguration: async () => null, projectRoot: process.cwd() });
  for (const id of ["ccswitch_../escape", "ccswitch_折扣/escape", "ccswitch_折扣\\escape",
    'ccswitch_折扣"].auth', "ccswitch_折扣::other", "ccswitch_折扣\n", "ccswitch_" + "a".repeat(80)]) {
    assert.throws(() => service.resolveRoute({ modelProviderId: id }), /Invalid model provider id/);
  }
  service.close();
});

test('draft discovery and model test save a usable shared Codex configuration without changing the original', async t => {
  const { database, service } = await fixture(t);
  const original = await service.save({ name: 'Original', baseUrl: 'https://supplier.test/v1', apiKey: 'old-secret', model: 'gpt-original' });
  const activeDb = new DatabaseSync(database); activeDb.exec('UPDATE providers SET is_current=1'); activeDb.close();
  const before = await fs.readFile(database);
  const { createProviderProbe } = await import('../server/provider-probe.mjs');
  const calls = [];
  let failed = false, incomplete = false;
  const probe = createProviderProbe({ resolveDraft: service.resolveDraft, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer new-secret');
    if (failed) return { ok: false, status: 403 };
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: ['grok-test', 'claude-test', 'deepseek-test', 'grok-test'].map(id => ({ id })) }) };
    assert.equal(JSON.parse(options.body).model, 'claude-test');
    assert.equal(JSON.parse(options.body).store, false);
    return { ok: true, json: async () => ({ status: incomplete ? 'incomplete' : 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] }) };
  } });
  const draft = { name: 'Copy', baseUrl: 'https://supplier.test/v1', apiKey: 'new-secret', model: 'claude-test' };
  assert.deepEqual((await probe({ ...draft, action: 'discover' })).models, ['claude-test', 'deepseek-test', 'grok-test']);
  assert.equal(calls.length, 1, 'listing must not send a generation request');
  assert.equal((await probe({ ...draft, action: 'test' })).usable, true);
  incomplete = true;
  await assert.rejects(probe({ ...draft, action: 'test' }), /未完成/);
  failed = true;
  await assert.rejects(probe({ ...draft, action: 'test' }), /403/);
  assert.deepEqual(await fs.readFile(database), before, 'query and test never write configuration');
  await assert.rejects(service.resolveDraft({ id: original.id, baseUrl: 'https://other.test/v1' }), /重新填写 Key/);
  const saved = await service.save(draft);
  assert.notEqual(saved.id, original.id);
  const rows = await service.runtimeProviders({ force: true });
  assert.equal(rows.find(r => r.id === 'ccswitch_' + original.id).key, 'old-secret');
  assert.equal(rows.find(r => r.id === 'ccswitch_' + saved.id).key, 'new-secret');
  const providers = createModelProviderService({ projectRoot: path.dirname(database), sharedConfig: service, currentApiConfiguration: async () => null });
  const list = await providers.listModels([]);
  const entry = list.find(m => m.model === 'ccswitch_' + saved.id + '::claude-test');
  assert.equal(entry.available, true);
  assert.equal(providers.resolveRoute({ model: entry.model }).modelProviderId, 'ccswitch_' + saved.id);
  providers.close();
  assert.ok(!JSON.stringify(await service.list()).includes('secret'));
});

test('optional fields, inherited copy key and explicit clearing round trip without key disclosure', async t => {
 const { service } = await fixture(t);
 const original = await service.save({ name:'Original', baseUrl:'https://example.com/v1', apiKey:'secret-copy', keyMode:'replace', model:'gpt-test', reasoningEffort:'high' });
 const copied = await service.save({ name:'Copy', sourceId:original.id, keyMode:'keep', baseUrl:'https://example.com/v1', model:'', reasoningEffort:'' });
 assert.equal((await service.resolveDraft({ id:copied.id, keyMode:'keep', baseUrl:'https://example.com/v1' })).key,'secret-copy');
 let entry=(await service.list(undefined,{force:true})).find(e=>e.id===copied.id);
 assert.equal(entry.model,''); assert.equal(entry.reasoningEffort,''); assert.equal(entry.configured,true);
 await service.save({ id:copied.id, name:'Empty', keyMode:'clear', baseUrl:'', model:'' });
 entry=(await service.list(undefined,{force:true})).find(e=>e.id===copied.id);
 assert.equal(entry.configured,false); assert.equal(entry.editable,true);
 await assert.rejects(service.resolveDraft({id:copied.id,keyMode:'keep',baseUrl:'https://example.com/v1'}));
 assert.equal((await service.resolveDraft({id:original.id,keyMode:'keep',baseUrl:'https://example.com/v1'})).key,'secret-copy');
 assert.ok(!JSON.stringify(await service.list()).includes('secret-copy'));
});
test('shared defaults survive a second client and empty selection resets them', async t => {
 const { database } = await fixture(t);
 const {createModelDefaultsStore}=await import('../server/model-defaults-store.mjs');
 const file=path.join(path.dirname(database),'defaults.json'), a=createModelDefaultsStore(file), b=createModelDefaultsStore(file);
 await a.save({providerId:'current',model:'gpt-test',effort:''});
 assert.equal((await b.read()).model,'gpt-test');
 await assert.rejects(async()=>a.save({providerId:'current',model:''}),/默认模型/);
 await b.save({}); assert.equal((await a.read()).providerId,'');
});
test('supplier ratio without account credentials uses explicit token group only', async () => {
 let group;
 const service=createFushengUsageService({credentialsFile:'/nonexistent-negus-fixture',fetchImpl:async url=>({
  ok:true,status:200,json:async()=>String(url).includes('pricing')?{group_ratio:{vip:0.3}}:{data:{name:'vip',group}}
 })});
 const entries=[{id:'x',baseUrl:'https://fushengyunsuan.cn/v1',key:'synthetic'}];
 assert.deepEqual(await service.readChannelRatios(entries),{});
 group='vip'; assert.equal((await service.readChannelRatios(entries)).x.priceRatio,0.3);
});

test('rename and copy preserve unreadable environment and bearer authentication; explicit replacement and clear still work', async () => {
  for (const credential of [{ env_key: 'NEGUS_TEST_ABSENT_CREDENTIAL_582194' }, { experimental_bearer_token: 'synthetic-bearer' }]) {
    const original = { auth: { custom: 'preserve' }, config: TOML.stringify({ model_provider: 'custom', model: 'gpt-test', model_providers: { custom: { base_url: 'https://example.test/v1', wire_api: 'responses', ...credential } } }) };
    let rows = [{ id: 'test', name: 'Original', settings_config: JSON.stringify(original), is_current: 0 }];
    let written;
    const service = createCcSwitchConfigService({ run: async request => {
      if (request.action === 'list') return rows;
      written = JSON.parse(request.config); return {};
    } });
    const [entry] = await service.list();
    assert.equal(entry.hasCredential, true);
    const draft = { ...entry, name: 'Renamed', keyMode: 'keep' };
    await service.save(draft);
    assert.deepEqual(written.auth, original.auth);
    for (const [key, value] of Object.entries(credential)) assert.equal(TOML.parse(written.config).model_providers.custom[key], value);
    await service.save({ ...draft, id: undefined, sourceId: 'test' });
    assert.deepEqual(written.auth, original.auth);
    for (const [key, value] of Object.entries(credential)) assert.equal(TOML.parse(written.config).model_providers.custom[key], value);
    for (const mode of ['replace', 'clear']) {
      await service.save({ ...draft, keyMode: mode, apiKey: 'synthetic-new' });
      const provider = TOML.parse(written.config).model_providers.custom;
      assert.equal(provider.env_key, undefined); assert.equal(provider.experimental_bearer_token, undefined);
      assert.equal(written.auth.OPENAI_API_KEY, mode === 'clear' ? '' : 'synthetic-new');
    }
    rows[0].is_current = 1;
    await assert.rejects(service.save(draft), /正在被电脑使用/);
  }
});
