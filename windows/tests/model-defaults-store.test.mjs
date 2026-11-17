import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { modelDefaultsFromRoute } from '../server/background-tasks/model-policy.mjs';
import { createModelDefaultsStore } from '../server/model-defaults-store.mjs';

test('missing and empty model defaults resolve to the runtime DeepSeek route while explicit values stay unchanged', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-model-defaults-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'model-defaults.json');
  let fallbackCalls = 0;
  const store = createModelDefaultsStore(file, {
    fallback: async () => {
      fallbackCalls += 1;
      return modelDefaultsFromRoute({
        modelProviderId: 'ccswitch_deepseek',
        model: 'deepseek-flash',
        reasoningEffort: 'high',
      });
    },
  });

  assert.deepEqual(await store.read(), {
    providerId: 'ccswitch_deepseek',
    model: 'ccswitch_deepseek::deepseek-flash',
    effort: 'high',
    archivedProviderIds: [],
  });
  assert.deepEqual(await store.save({}), {
    providerId: 'ccswitch_deepseek',
    model: 'ccswitch_deepseek::deepseek-flash',
    effort: 'high',
    archivedProviderIds: [],
  });
  const callsAfterDefault = fallbackCalls;
  assert.deepEqual(await store.save({ providerId: 'channel-a', model: 'channel-a::model-a', effort: 'low' }), {
    providerId: 'channel-a',
    model: 'channel-a::model-a',
    effort: 'low',
    archivedProviderIds: [],
  });
  assert.equal(fallbackCalls, callsAfterDefault);
});
