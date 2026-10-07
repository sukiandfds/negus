import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import '../server/register.mjs';
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
  assert.equal(f.registry.get('researcher').modelProviderId, 'ccswitch_vip');
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
  await assert.rejects(f.service.updateModelSettings('researcher', { model: 'ccswitch_vip::model-b' }), /target unavailable/);
  assert.equal(f.registry.get('researcher').modelProviderId, 'current');
  await f.service.sendMessage({ employeeId: 'researcher', text: 'still works' });
  assert.equal(f.histories.get('current').at(-1), 'still works');
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
  assert.equal(f.registry.get('researcher').modelProviderId, 'ccswitch_vip');
  assert.deepEqual(f.histories.get('ccswitch_vip').slice(-2), ['first', 'second']);
});
