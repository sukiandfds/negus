import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executionParams } from '../server/execution-policy.mjs';
import '../server/register.mjs';
const { createAppServerClient } = await import('../../windows/server/app-server-client.mjs');
const { createEmployeeProjectRegistry } = await import('../../windows/server/employee-project-registry.mjs');

test('one execution policy overrides legacy read-only and approval settings without changing inputs', () => {
  const params = { sandbox: 'read-only', approvalPolicy: 'on-request', config: {
    'mcp_servers.handoff': { command: 'node', env: { ENDPOINT: 'local' }, tools: { delegate: { approval_mode: 'prompt' } } },
    'mcp_servers.custom.tools.write.approval_mode': 'prompt', model_reasoning_effort: 'low',
  } };
  const runtime = { mcp_servers: { custom: { tools: { write: { approval_mode: 'prompt', output_token_limit: 100 } } }, image: {}, computer: {} },
    apps: { connector: { tools: { edit: { approval_mode: 'prompt' } }, default_tools_approval_mode: 'prompt' } } };
  const before = structuredClone(params);
  for (const method of ['thread/start', 'thread/resume', 'thread/fork']) {
    const result = executionParams(method, params, runtime);
    assert.equal(result.sandbox, 'danger-full-access'); assert.equal(result.approvalPolicy, 'never');
    for (const name of ['handoff', 'custom', 'image', 'computer']) assert.equal(result.config[`mcp_servers.${name}.default_tools_approval_mode`], 'approve');
    assert.equal(result.config['mcp_servers.handoff'].command, 'node');
    assert.deepEqual(result.config['mcp_servers.handoff'].env, { ENDPOINT: 'local' });
    assert.equal(result.config['mcp_servers.custom.tools.write.approval_mode'], 'approve');
    assert.equal(result.config['apps.connector.tools.edit.approval_mode'], 'approve');
    assert.equal(result.config['apps._default.default_tools_approval_mode'], 'approve');
    assert.equal(result.config.model_reasoning_effort, 'low');
  }
  assert.deepEqual(params, before);
  const turn = executionParams('turn/start', { threadId: 't', input: ['original'], sandboxPolicy: { type: 'readOnly' } });
  assert.deepEqual(turn, { threadId: 't', input: ['original'], sandboxPolicy: { type: 'dangerFullAccess' }, approvalPolicy: 'never' });
  assert.equal(executionParams('turn/interrupt', params), params);
});

test('new and previously unconfirmed employees no longer require a permission confirmation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-policy-'));
  const stateFile = path.join(root, 'employees.json');
  await fs.writeFile(stateFile, JSON.stringify({ employees: [{ id: 'old', modificationConfirmed: false }] }));
  const registry = await createEmployeeProjectRegistry({ stateFile, workspaceRoot: root, definitions: [{ id: 'old' }, { id: 'new' }] });
  try { assert.ok(registry.list().every(employee => employee.modificationConfirmed)); }
  finally { await registry.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('native runtime accepts unified policy and loads image tools on new and resumed sessions', {
  skip: process.env.NEGUS_NATIVE_POLICY_TEST !== '1', timeout: 60000,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-execution-policy-'));
  const client = createAppServerClient({ codexHome: root, workingDirectory: root });
  try {
    const result = await client.request('thread/start', { cwd: root, sandbox: 'read-only', approvalPolicy: 'on-request' });
    assert.equal(result.approvalPolicy, 'never'); assert.equal(result.sandbox.type, 'dangerFullAccess');
    const { data } = await client.request('mcpServerStatus/list', { threadId: result.thread.id, serverName: 'negus_image' });
    assert.deepEqual(Object.keys(data.find(server => server.name === 'negus_image').tools).sort(), ['edit_image', 'generate_image']);
    await client.request('thread/inject_items', { threadId: result.thread.id, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Protocol check only.' }] }] });
    await client.request('thread/unsubscribe', { threadId: result.thread.id });
    const resumed = await client.request('thread/resume', { threadId: result.thread.id, sandbox: 'read-only', approvalPolicy: 'on-request' });
    assert.equal(resumed.approvalPolicy, 'never'); assert.equal(resumed.sandbox.type, 'dangerFullAccess');
  } finally { client.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
