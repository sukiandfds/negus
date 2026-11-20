import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelDefaultsStore } from '../server/model-defaults-store.mjs';

test('missing and empty defaults remain persisted data; explicit values stay unchanged', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-model-defaults-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'model-defaults.json');
  const store = createModelDefaultsStore(file);
  const empty = { providerId: '', model: '', effort: '', archivedProviderIds: [] };
  assert.deepEqual(await store.read(), empty);
  assert.deepEqual(await store.save({}), empty);
  const selected = { providerId: 'channel-a', model: 'channel-a::model-a', effort: 'low', archivedProviderIds: [] };
  assert.deepEqual(await store.save(selected), selected);
  assert.deepEqual(await store.read(), selected);
});
