import test from 'node:test';
import assert from 'node:assert/strict';
import { basePrompt, communicationInstructions } from '../server/base-prompt.mjs';
import {
  backgroundTaskRoute,
  requestedBackgroundRoute,
} from '../server/background-tasks/model-policy.mjs';

test('global communication and assembled prompts default background work to DeepSeek Flash High', () => {
  for (const prompt of [communicationInstructions, basePrompt]) {
    assert.match(prompt, /后台实操.*及审核默认使用 DeepSeek Flash High/);
    assert.match(prompt, /模型 deepseek-flash，思考等级 high/);
    assert.match(prompt, /无法路由至该模型时应明确报告配置不可用，不得改用其他模型/);
    assert.doesNotMatch(prompt, /gpt-6\.1-terra|\bTerra\b/);
  }
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

  assert.deepEqual(await backgroundTaskRoute(providers), {
    modelProviderId: 'ccswitch_deepseek',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
  });
  assert.deepEqual(configured, ['fallback-provider', 'ccswitch_deepseek']);
  assert.deepEqual(resolved, [{ modelProviderId: 'ccswitch_deepseek', model: 'deepseek-flash' }]);
});

test('default background route fails clearly instead of falling back to Terra or an employee model', async () => {
  let resolved = false;
  const providers = {
    providers: () => [{ id: 'vip', displayName: 'VIP', models: [{ model: 'gpt-6.1-terra' }] }],
    isProviderConfigured: async () => true,
    resolveRoute: () => {
      resolved = true;
      return { modelProviderId: 'vip', model: 'gpt-6.1-terra' };
    },
  };

  await assert.rejects(
    backgroundTaskRoute(providers),
    /默认模型 DeepSeek Flash High 不可用：没有已配置的渠道支持 deepseek-flash/,
  );
  assert.equal(resolved, false);
});

test('default background route preserves the real configuration refresh failure', async () => {
  const providers = {
    refreshShared: async () => {
      throw new Error('共享配置数据库被锁定');
    },
    providers: () => [{ id: 'ccswitch_deepseek', displayName: 'DeepSeek', models: [{ model: 'deepseek-flash' }] }],
    isProviderConfigured: async () => true,
    resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }),
  };

  await assert.rejects(
    backgroundTaskRoute(providers),
    /默认模型 DeepSeek Flash High 不可用：配置刷新失败：共享配置数据库被锁定/,
  );
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

  assert.deepEqual(
    await requestedBackgroundRoute(providers, { modelProviderId: 'channel-a', model: 'model-a' }),
    { modelProviderId: 'channel-a', model: 'model-a' },
  );
  assert.deepEqual(
    await requestedBackgroundRoute(providers, { model: 'model-b' }),
    { modelProviderId: 'channel-b', model: 'model-b' },
  );
  assert.deepEqual(resolved, [
    { modelProviderId: 'channel-a', model: 'model-a' },
    { modelProviderId: 'channel-b', model: 'model-b' },
  ]);
});
