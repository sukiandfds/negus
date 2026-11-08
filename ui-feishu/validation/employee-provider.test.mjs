import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import '../server/register.mjs';
import { setTransferredProvider } from '../server/employee-provider-integration.mjs';
const { createEmployeeProjectRegistry } = await import('../../windows/server/employee-project-registry.mjs');
const { createEmployeeRuntimeService } = await import('../../windows/server/employee-runtime-service.mjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-provider-switch-'));
  const stateFile = path.join(root, 'employees.json');
  const definition = { id: 'researcher', name: '产品分析', model: 'model-a', reasoningEffort: 'medium', instructions: 'research', workRoot: root };
  const registry = await createEmployeeProjectRegistry({ stateFile, workspaceRoot: root, definitions: [definition] });
  await registry.bindMainThread('researcher', 'original-thread');
  await registry.bindConversation('researcher', 'original-conversation');
  const histories = new Map([['current', ['old question', 'old answer']]]);
  const calls = [];
  const clients = new Map();
  const events = [];
  let failTarget = false;
  function client(id) {
    if (clients.has(id)) return clients.get(id);
    const listeners = new Set();
    let active = false;
    const runtime = { model: 'model-a', effort: 'medium' };
    const c = {
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      setIdle() { active = false; },
      emit(m) { if (m.method === 'turn/completed') active = false; for (const fn of listeners) fn(m); },
      async request(method, params) {
        calls.push({ id, method, params });
        const thread = { id: 'original-thread', cwd: root, path: path.join(root, id, 'rollout.jsonl'), status: { type: active ? 'active' : 'idle' } };
        if (method === 'config/read') return { config: { model_provider: id === 'current' ? 'native-current' : id } };
        if (method === 'thread/read') return { thread };
        if (method === 'thread/resume') {
          if (failTarget && id !== 'current') throw Error('target unavailable');
          runtime.model = params.model || runtime.model;
          runtime.effort = params.config?.model_reasoning_effort || runtime.effort;
          return { thread, model: runtime.model, reasoningEffort: runtime.effort };
        }
        if (method === 'thread/settings/update') Object.assign(runtime, { ...(params.model ? { model: params.model } : {}), ...(params.effort ? { effort: params.effort } : {}) });
        if (method === 'turn/start') {
          active = true;
          assert.equal(params.threadId, 'original-thread');
          histories.get(id).push(params.input[0].text);
          return { turn: { id: `turn-${calls.length}`, status: 'inProgress' } };
        }
        return {};
      },
    };
    clients.set(id, c); return c;
  }
  const providers = {
    resolveRoute({ model = '', modelProviderId = '' }) {
      const [prefix, name] = model.includes('::') ? model.split('::') : ['', model];
      return { modelProviderId: modelProviderId || prefix || 'current', model: name };
    },
    async getClient(route) { return client(route.modelProviderId); },
    async prepareResumeFile(id, info) {
      const source = path.basename(path.dirname(info.path));
      histories.set(id, [...histories.get(source)]);
      await fs.mkdir(path.join(root, id), { recursive: true });
      await fs.writeFile(path.join(root, id, 'rollout.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'original-thread', model_provider: source } }) + '\n');
      return { ...info, path: path.join(root, id, 'rollout.jsonl') };
    },
  };
  const binding = { conversationId: 'original-conversation', runtimeSessionId: 'original-thread', runtimeKind: 'codex', conversationKind: 'direct', agentId: 'researcher' };
  const options = { registry, projectRoot: root, client: client('current'), modelProviders: providers,
    conversationStore: { findByAgentKind: () => binding, readMessages: async () => [], recordRuntimeEvent: async () => {} },
    broadcast: e => events.push(e),
  };
  let service = createEmployeeRuntimeService(options);
  t.after(async () => { service.close(); await registry.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { get service() { return service; }, registry, providers, histories, calls, events, client,
    fail: () => { failTarget = true; },
    complete: id => client(id).emit({ method: 'turn/completed', params: { threadId: 'original-thread', turn: { id: 'done', status: 'completed' } } }),
    restart: async () => { service.close(); options.registry = await createEmployeeProjectRegistry({ stateFile, workspaceRoot: root, definitions: [definition] }); service = createEmployeeRuntimeService(options); },
  };
}

test('employee switches providers and returns with full history and stable conversation identity', async t => {
  const f = await fixture(t);
  await f.service.updateModelSettings('researcher', { model: 'ccswitch_vip::model-b', reasoningEffort: 'high' });
  await f.service.updateModelSettings('researcher', { reasoningEffort: 'medium' });
  assert.equal(f.registry.get('researcher').pendingModelSettings.modelProviderId, 'ccswitch_vip');
  assert.equal(f.calls.some(c => c.params.path), false);
  const context = await f.service.getRuntimeContext('original-thread');
  assert.equal(context.model, 'ccswitch_vip::model-b');
  assert.equal(context.modelProvider, 'ccswitch_vip');
  await f.service.sendMessage({ employeeId: 'researcher', text: 'new message on vip' });
  assert.deepEqual(f.histories.get('ccswitch_vip'), ['old question', 'old answer', 'new message on vip']);
  f.complete('ccswitch_vip');
  await f.service.updateModelSettings('researcher', { model: 'model-a' });
  await f.service.sendMessage({ employeeId: 'researcher', text: 'back to current' });
  assert.deepEqual(f.histories.get('current'), ['old question', 'old answer', 'new message on vip', 'back to current']);
  assert.equal(f.registry.get('researcher').mainThreadId, 'original-thread');
  assert.equal(f.registry.get('researcher').conversationId, 'original-conversation');
  assert.equal(f.calls.filter(c => c.id === 'current' && c.method === 'thread/resume' && c.params.path).at(-1).params.modelProvider, 'native-current');
});

test('failed switch leaves previous provider usable and settings unchanged', async t => {
  const f = await fixture(t); f.fail();
  await f.service.updateModelSettings('researcher', { model: 'ccswitch_vip::model-b' });
  await assert.rejects(f.service.sendMessage({ employeeId: 'researcher', text: 'must not send' }), /target unavailable/);
  await f.service.updateModelSettings('researcher', { model: 'model-a' });
  assert.equal(f.registry.get('researcher').modelProviderId, 'current');
  await f.service.sendMessage({ employeeId: 'researcher', text: 'still works' });
  assert.equal(f.histories.get('current').at(-1), 'still works');
});

test('switching away from an unavailable old provider does not resume it before migrating history', async t => {
  const f = await fixture(t);
  const source = f.client('current');
  const request = source.request.bind(source);
  source.request = async (method, params) => {
    if (method === 'thread/resume') throw Error('This chat uses model provider "old", which is no longer configured.');
    return request(method, params);
  };
  await f.service.updateModelSettings('researcher', { model: 'ccswitch_deepseek::deepseek-flash', reasoningEffort: 'high' });
  await f.service.sendMessage({ employeeId: 'researcher', text: 'continue on DeepSeek' });
  assert.deepEqual(f.histories.get('ccswitch_deepseek'), ['old question', 'old answer', 'continue on DeepSeek']);
  const employee = f.registry.get('researcher');
  assert.equal(employee.modelProviderId, 'ccswitch_deepseek');
  assert.equal(employee.reasoningEffort, 'high');
  assert.equal(employee.pendingModelSettings, null);
  assert.equal(employee.mainThreadId, 'original-thread');
  assert.equal(employee.conversationId, 'original-conversation');
});

test('restart restores selected employee provider; old provider events cannot complete its new task', async t => {
  const f = await fixture(t);
  await f.service.updateModelSettings('researcher', { model: 'ccswitch_vip::model-b' });
  await f.restart();
  await f.service.sendMessage({ employeeId: 'researcher', text: 'after restart' });
  f.complete('current');
  assert.equal((await f.service.getStatus('researcher')).status.active, true);
  f.complete('ccswitch_vip');
  assert.equal((await f.service.getStatus('researcher')).status.active, false);
  assert.equal(f.histories.get('ccswitch_vip').at(-1), 'after restart');
});

test('sending waits for a concurrent provider change, and busy employee rejects switching', async t => {
  const f = await fixture(t);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const copy = f.providers.prepareResumeFile;
  f.providers.prepareResumeFile = async (...args) => { await gate; return copy(...args); };
  const switching = f.service.updateModelSettings('researcher', { model: 'ccswitch_vip::model-b' });
  const sending = f.service.sendMessage({ employeeId: 'researcher', text: 'after switch' });
  release(); await switching; await sending;
  assert.equal(f.histories.get('ccswitch_vip').at(-1), 'after switch');
  await assert.rejects(f.service.updateModelSettings('researcher', { model: 'model-a' }), /正在处理消息/);
});

test('a completed native task with stale employee status does not block the next send or switch', async t => {
  const f = await fixture(t);
  await f.service.sendMessage({ employeeId: 'researcher', text: 'first' });
  f.client('current').setIdle(); // Completion notification was missed.
  await f.service.sendMessage({ employeeId: 'researcher', text: 'second' });
  f.client('current').setIdle();
  await f.service.updateModelSettings('researcher', { model: 'ccswitch_vip::model-b' });
  assert.equal(f.registry.get('researcher').pendingModelSettings.modelProviderId, 'ccswitch_vip');
  assert.equal(f.calls.some(c => c.params.path), false);
  assert.equal(f.histories.has('ccswitch_vip'), false);
  await f.service.sendMessage({ employeeId: 'researcher', text: 'third' });
  assert.deepEqual(f.histories.get('ccswitch_vip'), ['old question', 'old answer', 'first', 'second', 'third']);
});

 test('migration updates only destination provider metadata, preserving source and message bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-provider-header-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.jsonl'), target = path.join(root, 'target.jsonl');
  const body = '\n{"type":"event_msg","payload":{"text":"original message"}}\n';
  const original = JSON.stringify({ type: 'session_meta', payload: { id: 'thread', model_provider: 'removed' } }) + body;
  const settings = JSON.stringify({ type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model_provider_id: 'removed', model: 'old-model' } } }) + '\n';
  await fs.writeFile(source, original + settings); await fs.copyFile(source, target);
  await setTransferredProvider(target, source, 'thread', 'deepseek', 'thread', { model: 'new-model', reasoningEffort: 'low' });
  const migrated = await fs.readFile(target, 'utf8');
  assert.equal(JSON.parse(migrated.split('\n')[0]).payload.model_provider, 'deepseek');
  assert.ok(migrated.slice(migrated.indexOf('\n')).startsWith(body));
  const applied = JSON.parse(migrated.trim().split('\n').at(-1)).payload.thread_settings;
  assert.equal(applied.model_provider_id, 'deepseek');
  assert.equal(applied.model, 'new-model');
  assert.equal(applied.reasoning_effort, 'low');
  assert.equal(await fs.readFile(source, 'utf8'), original + settings);
  await assert.rejects(setTransferredProvider(target, source, 'wrong-thread', 'other'), /校验失败/);
});

test('migration creates a new compressed thread without modifying the source', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-compressed-provider-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.jsonl.zst');
  const target = path.join(root, 'target.jsonl.zst');
  const original = `${JSON.stringify({ type: 'session_meta', payload: {
    id: 'thread', session_id: 'thread', model_provider: 'removed',
  } })}\n${JSON.stringify({ type: 'event_msg', payload: { text: 'complete history' } })}\n`;
  const compressed = zstdCompressSync(Buffer.from(original));
  await fs.writeFile(source, compressed);
  await fs.copyFile(source, target);
  await setTransferredProvider(target, source, 'thread', 'deepseek', 'new-thread');
  const migrated = zstdDecompressSync(await fs.readFile(target)).toString('utf8');
  const header = JSON.parse(migrated.split('\n')[0]);
  assert.equal(header.payload.id, 'new-thread');
  assert.equal(header.payload.session_id, 'new-thread');
  assert.equal(header.payload.model_provider, 'deepseek');
  assert.match(migrated, /complete history/);
  assert.deepEqual(await fs.readFile(source), compressed);
});

test('migration recovers an unloaded source before reading its history', async t => {
  const f = await fixture(t), source = f.client('current'), request = source.request.bind(source);
  let loaded = false;
  source.request = async (method, params) => {
    if (method === 'thread/read' && !loaded) throw Error('thread not loaded: original-thread');
    if (method === 'thread/resume') loaded = true;
    return request(method, params);
  };
  await f.service.updateModelSettings('researcher', { model: 'ccswitch_vip::model-b' });
  await f.service.sendMessage({ employeeId: 'researcher', text: 'after unloaded source' });
  assert.equal(f.histories.get('ccswitch_vip').at(-1), 'after unloaded source');
});

test('migration corrects an existing native index only for the destination thread', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-index-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'sessions/2026/11/06/rollout.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: 'thread', model_provider: 'old' } }) + '\n');
  const db = new DatabaseSync(path.join(root, 'state_5.sqlite'));
  t.after(() => db.close());
  db.exec('CREATE TABLE threads (id TEXT, model_provider TEXT, rollout_path TEXT)');
  const insert = db.prepare('INSERT INTO threads VALUES (?,?,?)');
  insert.run('thread', 'old', file); insert.run('other', 'old', 'other-path');
  await setTransferredProvider(file, path.join(root, 'source.jsonl'), 'thread', 'deepseek');
  assert.equal(db.prepare('SELECT model_provider FROM threads WHERE id=?').get('thread').model_provider, 'deepseek');
  assert.equal(db.prepare('SELECT model_provider FROM threads WHERE id=?').get('other').model_provider, 'old');
});
