import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { basePrompt, communicationInstructions } from '../server/base-prompt.mjs';
import {
  backgroundTaskRoute,
  employeeTaskRoute,
  loadTaskRoutingPolicy,
  modelDefaultsFromRoute,
  requestedBackgroundRoute,
} from '../server/background-tasks/model-policy.mjs';

test('global communication and assembled prompts default background work to DeepSeek Flash High', () => {
  for (const prompt of [communicationInstructions, basePrompt]) {
    assert.match(prompt, /后台实操.*及审核默认使用 DeepSeek Flash High/);
    assert.match(prompt, /模型 deepseek-flash，思考等级 high/);
    assert.match(prompt, /先尝试目标模型在首选渠道，再尝试同一模型的其他渠道，随后按配置顺序尝试其他模型/);
    assert.match(prompt, /必须先发现并优先使用.*Negus 后台任务工具/);
    assert.match(prompt, /startup\.confirmed=true/);
    assert.doesNotMatch(prompt, /gpt-6\.1-terra|\bTerra\b/);
  }
});

test('routing config loads without models and ignores legacy model lists', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-routing-policy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current.json');
  const legacy = path.join(root, 'legacy.json');
  const base = { version: 1, defaultModel: 'deepseek-flash', reasoningEffort: 'high',
    channels: [{ name: 'DeepSeek' }, { name: 'vip' }, { name: '折扣' }, { name: 'astr' }, { name: 'grok' }] };
  await fs.writeFile(current, JSON.stringify(base));
  await fs.writeFile(legacy, JSON.stringify({ ...base,
    channels: base.channels.map(channel => ({ ...channel, models: ['removed-from-policy'] })) }));
  const currentPolicy = await loadTaskRoutingPolicy({ file: current });
  const legacyPolicy = await loadTaskRoutingPolicy({ file: legacy });
  assert.deepEqual(currentPolicy, { version: 1, defaultModel: 'deepseek-flash', reasoningEffort: 'high',
    channels: base.channels });
  assert.deepEqual(legacyPolicy, currentPolicy);
  for (const channel of currentPolicy.channels) assert.equal('models' in channel, false);
  const bundled = JSON.parse(await fs.readFile(path.resolve('windows/server/model-routing.default.json'), 'utf8'));
  assert.ok(bundled.channels.every(channel => !('models' in channel)));
  await fs.writeFile(current, JSON.stringify({ ...base, defaultModel: '' }));
  await assert.rejects(loadTaskRoutingPolicy({ file: current }), /默认模型或思考等级/);
  await fs.writeFile(current, JSON.stringify({ ...base, reasoningEffort: '' }));
  await assert.rejects(loadTaskRoutingPolicy({ file: current }), /默认模型或思考等级/);
});

test('default background route selects the configured DeepSeek provider at high effort', async () => {
  const configured = [];
  const resolved = [];
  const providers = {
    providers: () => [
      { id: 'vip', displayName: 'VIP', models: [{ model: 'gpt-6.1-terra' }] },
      { id: 'fallback-provider', displayName: '备用渠道', models: [{ model: 'deepseek-flash' }] },
      { id: 'ccswitch_deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }] },
    ],
    isProviderConfigured: async id => {
      configured.push(id);
      return id === 'ccswitch_deepseek';
    },
    resolveRoute: request => {
      resolved.push(request);
      return { modelProviderId: request.modelProviderId, model: request.model };
    },
  };

  const route = await backgroundTaskRoute(providers);
  assert.equal(route.modelProviderId, 'ccswitch_deepseek');
  assert.equal(route.model, 'deepseek-flash');
  assert.equal(route.reasoningEffort, 'high');
  assert.match(route.taskRouting.configFile, /runtime\/model-routing\.json$/);
  assert.equal(route.taskRouting.selectedModel, 'deepseek-flash');
  assert.equal(route.taskRouting.selectedProviderId, 'ccswitch_deepseek');
  assert.equal(route.taskRouting.reason, '使用配置渠道');
  assert.deepEqual(configured, ['ccswitch_deepseek']);
  assert.deepEqual(resolved, [{ modelProviderId: 'ccswitch_deepseek', model: 'deepseek-flash' }]);
});

test('default background route tries another configured channel and model before reporting failure', async () => {
  const resolved = [];
  const providers = {
    providers: () => [{ id: 'vip', displayName: 'VIP', models: [{ model: 'gpt-6.1-terra' }] }],
    isProviderConfigured: async () => true,
    resolveRoute: request => { resolved.push(request); return request; },
  };

  const route = await backgroundTaskRoute(providers);
  assert.equal(route.modelProviderId, 'vip');
  assert.equal(route.model, 'gpt-6.1-terra');
  assert.equal(route.taskRouting.selectedModel, 'gpt-6.1-terra');
  assert.match(route.taskRouting.reason, /改用其他/);
  assert.equal(resolved.some(item => item.model === 'deepseek-flash'), false);
});

test('direct channel names use each provider default model and keep the preferred channel', async () => {
  const providers = {
    providers: () => [
      { id: 'current', displayName: 'vip', defaultModel: 'current-vip-default', models: [{ model: 'current-vip-default' }] },
      { id: 'ccswitch_vip', displayName: 'vip', defaultModel: 'gpt-6.2-sol', models: [{ model: 'gpt-6.2-sol' }, { model: 'gpt-6.2-astra' }] },
      { id: 'ccswitch_discount', displayName: '折扣', defaultModel: 'discount-sol', models: [{ model: 'discount-sol' }] },
      { id: 'ccswitch_astr', displayName: 'astr', defaultModel: 'gpt-6.2-astra', models: [{ model: 'gpt-6.2-astra' }] },
      { id: 'fusheng-grok', displayName: 'grok', defaultModel: 'grok-4.7', models: [{ model: 'grok-4.7' }] },
    ],
    isProviderConfigured: async () => true,
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
  };
  const policy = { version: 1, defaultModel: 'deepseek-flash', reasoningEffort: 'high',
    channels: [{ name: 'DeepSeek' }, { name: 'vip' }, { name: '折扣' }, { name: 'astr' }, { name: 'grok' }] };
  for (const [channel, providerId, model] of [
    ['vip', 'ccswitch_vip', 'gpt-6.2-sol'],
    ['折扣', 'ccswitch_discount', 'discount-sol'],
    ['astr', 'ccswitch_astr', 'gpt-6.2-astra'],
    ['grok', 'fusheng-grok', 'grok-4.7'],
  ]) {
    const route = await requestedBackgroundRoute(providers, { model: channel }, [], policy);
    assert.equal(route.modelProviderId, providerId);
    assert.equal(route.model, model);
    assert.equal(route.taskRouting.requestedModel, model);
    assert.equal(route.taskRouting.requestedProviderId, channel);
    assert.equal(route.taskRouting.reason, '使用配置渠道');
  }
});

test('the same requested model is tried across channels before the next model', async () => {
  const resolved = [];
  const providers = {
    providers: () => [
      { id: 'ccswitch_vip', displayName: 'vip', defaultModel: 'vip-next', models: [{ model: 'shared-model' }, { model: 'vip-next' }] },
      { id: 'ccswitch_discount', displayName: '折扣', defaultModel: 'discount-next', models: [{ model: 'shared-model' }, { model: 'discount-next' }] },
    ],
    isProviderConfigured: async id => id !== 'ccswitch_vip',
    resolveRoute: request => { resolved.push(request); return request; },
  };
  const policy = { version: 1, defaultModel: 'deepseek-flash', reasoningEffort: 'high',
    channels: [{ name: 'vip' }, { name: '折扣' }] };
  const route = await requestedBackgroundRoute(providers, { model: 'shared-model' }, [], policy);
  assert.equal(route.modelProviderId, 'ccswitch_discount');
  assert.equal(route.model, 'shared-model');
  assert.deepEqual(resolved, [{ modelProviderId: 'ccswitch_discount', model: 'shared-model' }]);
  assert.deepEqual(route.taskRouting.attempted,
    [{ providerId: 'ccswitch_vip', displayName: 'vip', model: 'shared-model', reason: '渠道未配置' }]);
});

test('employee task route retries another channel for the same model before changing models', async () => {
  const providers = {
    providers: () => [
      { id: 'ccswitch_vip', displayName: 'VIP', models: [{ model: 'gpt-6.1-terra' }] },
      { id: 'ccswitch_deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }] },
    ],
    isProviderConfigured: async id => id === 'ccswitch_deepseek',
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
  };
  const route = await employeeTaskRoute(providers, {
    modelProviderId: 'ccswitch_deepseek', model: 'deepseek-flash', reasoningEffort: 'high',
  });
  assert.equal(route.modelProviderId, 'ccswitch_deepseek');
  assert.equal(route.model, 'deepseek-flash');
  assert.equal(route.reasoningEffort, 'high');
  const fallback = await employeeTaskRoute(providers, {
    modelProviderId: 'ccswitch_vip', model: 'deepseek-flash',
  });
  assert.equal(fallback.modelProviderId, 'ccswitch_deepseek');
  assert.equal(fallback.model, 'deepseek-flash');
  assert.equal(fallback.taskRouting.reason, '同模型改用其他渠道');
});

test('route selection keeps trying cached providers when shared configuration refresh fails', async () => {
  const providers = {
    refreshShared: async () => {
      throw new Error('共享配置数据库被锁定');
    },
    providers: () => [{ id: 'ccswitch_deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }] }],
    isProviderConfigured: async () => true,
    resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }),
  };

  const route = await backgroundTaskRoute(providers);
  assert.equal(route.modelProviderId, 'ccswitch_deepseek');
  assert.match(route.taskRouting.refreshWarning, /共享配置数据库被锁定/);
});

test('explicit background model and provider requests retain their selected route', async () => {
  const resolved = [];
  const providers = {
    providers: () => [
      { id: 'channel-a', displayName: '渠道 A', models: [{ model: 'model-a' }] },
      { id: 'channel-b', displayName: '渠道 B', models: [{ model: 'model-b' }] },
    ],
    isProviderConfigured: async () => true,
    resolveRoute: request => {
      resolved.push(request);
      return { modelProviderId: request.modelProviderId, model: request.model };
    },
  };

  const first = await requestedBackgroundRoute(providers, { modelProviderId: 'channel-a', model: 'model-a' });
  const second = await requestedBackgroundRoute(providers, { model: 'model-b' });
  assert.equal(first.modelProviderId, 'channel-a');
  assert.equal(first.model, 'model-a');
  assert.equal(second.modelProviderId, 'channel-b');
  assert.equal(second.model, 'model-b');
  assert.deepEqual(resolved, [
    { modelProviderId: 'channel-a', model: 'model-a' },
    { modelProviderId: 'channel-b', model: 'model-b' },
  ]);
});

test('task routing reads ordered channels from configuration and skips recently failed routes', async () => {
  const providers = {
    providers: () => [
      { id: 'vip', displayName: 'VIP', models: [{ model: 'gpt-6.1-terra' }] },
      { id: 'deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }, { model: 'deepseek-v4-pro' }] },
    ],
    isProviderConfigured: async () => true,
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
  };
  const policy = {
    version: 1,
    defaultModel: 'deepseek-flash',
    reasoningEffort: 'high',
    channels: [
      { name: 'DeepSeek' },
      { name: 'VIP' },
    ],
  };
  const failed = {
    state: 'failed', modelProviderId: 'deepseek', model: 'deepseek-flash',
    error: '503 Service Unavailable: 分组 vip 下模型 deepseek-flash 无可用渠道（distributor）',
  };
  const route = await backgroundTaskRoute(providers, policy);
  assert.equal(route.model, 'deepseek-flash');
  for (const error of [
    failed.error,
    '401 Unauthorized: invalid api key',
    '429 Too Many Requests: rate limit',
    'request timed out',
    'authentication failed: token expired',
    '无效 token',
    '未认证',
    '鉴权失败：令牌过期',
  ]) {
    const fallback = await employeeTaskRoute(providers, {
      modelProviderId: 'deepseek', model: 'deepseek-flash',
    }, [{ ...failed, error }], policy);
    assert.equal(fallback.modelProviderId, 'deepseek');
    assert.equal(fallback.model, 'deepseek-v4-pro');
    assert.ok(fallback.taskRouting.attempted.some(item => item.reason.includes('最近一次执行失败')));
  }

  const recovered = await employeeTaskRoute(providers, {
    modelProviderId: 'deepseek', model: 'deepseek-flash',
  }, [
    { ...failed, updatedAt: '2026-11-17T12:00:00.000Z' },
    { state: 'completed', modelProviderId: 'deepseek', model: 'deepseek-flash', updatedAt: '2026-11-17T12:01:00.000Z' },
  ], policy);
  assert.equal(recovered.model, 'deepseek-flash');
  assert.equal(recovered.taskRouting.reason, '使用配置渠道');
  assert.equal(recovered.reasoningEffort, 'high');
});

test('configured default model can be outside the catalog and full failure returns attempted details', async () => {
  const providers = {
    providers: () => [
      { id: 'deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }, { model: 'third-model' }] },
    ],
    isProviderConfigured: async () => true,
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
  };
  const policy = {
    version: 1,
    defaultModel: 'third-model',
    reasoningEffort: 'high',
    channels: [{ name: 'DeepSeek' }],
  };
  const route = await backgroundTaskRoute(providers, policy);
  assert.equal(route.model, 'third-model');
  assert.equal(route.reasoningEffort, 'high');
  const defaults = modelDefaultsFromRoute(route);
  assert.equal(defaults.providerId, 'deepseek');
  assert.equal(defaults.model, 'deepseek::third-model');
  assert.equal(defaults.effort, 'high');

  const unavailable = { ...providers, isProviderConfigured: async () => false };
  await assert.rejects(backgroundTaskRoute(unavailable, policy), error => {
    assert.match(error.message, /尝试记录：DeepSeek\/third-model：渠道未配置/);
    assert.equal(error.details.requestedModel, 'third-model');
    assert.equal(error.details.attempts[0].reason, '渠道未配置');
    return true;
  });
});

test('a default model missing from every catalog reports real attempted routes', async () => {
  const providers = {
    providers: () => [
      { id: 'ccswitch_vip', displayName: 'vip', defaultModel: 'vip-default', models: [{ model: 'vip-default' }] },
      { id: 'ccswitch_discount', displayName: '折扣', defaultModel: 'discount-default', models: [{ model: 'discount-default' }] },
    ],
    isProviderConfigured: async () => false,
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
  };
  const policy = { version: 1, defaultModel: 'missing-default', reasoningEffort: 'high',
    channels: [{ name: 'vip' }, { name: '折扣' }] };
  await assert.rejects(backgroundTaskRoute(providers, policy), error => {
    assert.equal(error.details.requestedModel, 'missing-default');
    assert.ok(error.details.attempts.some(item => item.model === 'missing-default' && item.providerId === 'ccswitch_vip'));
    assert.ok(error.details.attempts.some(item => item.model === 'missing-default' && item.providerId === 'ccswitch_discount'));
    assert.match(error.message, /vip\/missing-default：渠道模型目录不包含该模型/);
    return true;
  });
});
