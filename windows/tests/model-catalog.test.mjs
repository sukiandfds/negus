import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { neutralModelInstructions, neutralThreadInstructions } from '../server/model-catalog.mjs';

test('remove fixed identity without changing the rest of existing work instructions', () => {
  assert.equal(neutralModelInstructions('You are Codex, an agent based on GPT-6.\nKeep my tools and rules.'), 'You are a coding assistant.\nKeep my tools and rules.');
  assert.equal(neutralModelInstructions('Custom employee instructions'), 'Custom employee instructions');
});

test('resumed conversation overrides only a fixed identity and never rewrites history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-neutral-'));
  const file = path.join(root, 'rollout.jsonl');
  const content = JSON.stringify({ type: 'session_meta', payload: { base_instructions: { text: 'You are Codex, an agent based on GPT-6.\nPreserve this.' } } }) + '\n';
  try {
    await fs.writeFile(file, content);
    assert.deepEqual(await neutralThreadInstructions(file), { baseInstructions: 'You are a coding assistant.\nPreserve this.' });
    assert.equal(await fs.readFile(file, 'utf8'), content);
    assert.deepEqual(await neutralThreadInstructions(path.join(root, 'missing')), {});
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('shared DeepSeek metadata has official context, modality and effort values without identity prompts', async () => {
  const { models } = JSON.parse(await fs.readFile(new URL('../server/deepseek-models.json', import.meta.url), 'utf8'));
  assert.equal(models.length, 2);
  for (const model of models) {
    assert.equal(model.context_window, 1048576);
    assert.deepEqual(model.supported_reasoning_levels.map(item => item.effort), ['low', 'high', 'max']);
    assert.equal(model.base_instructions, undefined);
  }
  assert.deepEqual(models[0].input_modalities, ['text', 'image']);
  assert.deepEqual(models[1].input_modalities, ['text']);
});
