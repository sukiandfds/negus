import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmployeeProjectRegistry } from '../server/employee-project-registry.mjs';

const deepseek = {
  modelProviderId: 'ccswitch_deepseek',
  model: 'deepseek-flash',
  reasoningEffort: 'high',
};

test('every employee default uses the injected DeepSeek route including Grok', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-defaults-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const definitions = ['negus-assistant', 'manager', 'researcher', 'developer', 'reviewer', 'grok'].map(id => ({
    id,
    name: id,
    model: id === 'grok' ? 'grok-4.6' : 'old-model',
    modelProviderId: id === 'grok' ? 'fusheng-grok' : 'old-provider',
    reasoningEffort: 'medium',
  }));
  const registry = await createEmployeeProjectRegistry({
    stateFile: path.join(root, 'employees.json'),
    workspaceRoot: root,
    definitions,
    defaultModelSettings: deepseek,
  });
  t.after(() => registry.close());

  assert.deepEqual(registry.list().map(employee => [
    employee.id, employee.modelProviderId, employee.model, employee.reasoningEffort, employee.modelSelectionSource,
  ]), definitions.map(definition => [definition.id, 'ccswitch_deepseek', 'deepseek-flash', 'high', 'default']));
});

test('legacy employee threads receive a pending DeepSeek switch while explicit selections survive restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-default-switch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'employees.json');
  const definitions = [{ id: 'manager', name: 'manager' }, { id: 'developer', name: 'developer' }];
  await fs.writeFile(stateFile, JSON.stringify({ version: 1, employees: [
    { id: 'manager', modelProviderId: 'current', model: 'gpt-old', reasoningEffort: 'medium', mainThreadId: 'manager-thread' },
    { id: 'developer', modelProviderId: 'channel-explicit', model: 'model-explicit', reasoningEffort: 'low',
      mainThreadId: 'developer-thread', modelSelectionSource: 'explicit' },
  ] }));

  let registry = await createEmployeeProjectRegistry({
    stateFile, workspaceRoot: root, definitions, defaultModelSettings: deepseek,
  });
  const manager = registry.get('manager');
  const developer = registry.get('developer');
  assert.equal(manager.modelProviderId, 'current');
  assert.equal(manager.model, 'gpt-old');
  assert.deepEqual(manager.pendingModelSettings, { ...deepseek, modelSelectionSource: 'default' });
  assert.equal(manager.mainThreadId, 'manager-thread');
  assert.equal(developer.modelProviderId, 'channel-explicit');
  assert.equal(developer.model, 'model-explicit');
  assert.equal(developer.modelSelectionSource, 'explicit');
  await registry.close();

  registry = await createEmployeeProjectRegistry({
    stateFile, workspaceRoot: root, definitions, defaultModelSettings: deepseek,
  });
  assert.equal(registry.get('developer').modelProviderId, 'channel-explicit');
  assert.equal(registry.get('developer').modelSelectionSource, 'explicit');
  await registry.close();
});
