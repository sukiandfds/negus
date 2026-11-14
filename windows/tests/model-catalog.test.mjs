import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { neutralModelInstructions, neutralThreadInstructions } from '../server/model-catalog.mjs';

test('remove fixed identity without changing the rest of existing work instructions', () => {
  assert.equal(neutralModelInstructions('You are Codex, an agent based on GPT-6.\nKeep my tools and rules.'), 'You are a coding assistant.\nKeep my tools and rules.');
  assert.equal(neutralModelInstructions('You are Codex, a coding agent based on GPT-5. Keep rules.'), 'You are a coding assistant. Keep rules.');
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

test('decimal model names and every shared resume/fork path lose only fixed identity', async () => {
  const { requestWithNeutralIdentity } = await import('../server/model-catalog.mjs');
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'negus-identity-')), 'rollout.jsonl');
  const original = 'You are Codex, an agent based on GPT-6.1. Keep employee duties.';
  await fs.writeFile(file, JSON.stringify({type:'session_meta',payload:{base_instructions:{text:original}}})+'\n');
  try {
    for (const method of ['thread/resume', 'thread/fork']) {
      const calls = [], cleaned = new Set();
      const send = async (method, params) => { calls.push({method,params}); return {thread:{id:'employee',path:file}}; };
      await requestWithNeutralIdentity(method, {threadId:'employee'}, send, cleaned);
      assert.equal(calls[1].params.baseInstructions, 'You are a coding assistant. Keep employee duties.');
      await requestWithNeutralIdentity('thread/resume', {threadId:'employee'}, send, cleaned);
      assert.equal(calls.length, 3, 'no duplicate cleanup during subsequent sends');
    }
    assert.equal(JSON.parse(await fs.readFile(file,'utf8')).payload.base_instructions.text,original);
  } finally { await fs.rm(path.dirname(file),{recursive:true,force:true}); }
});

test('DeepSeek effective context follows official capacity and native 95 percent budget', async () => {
  const { verifiedContextWindow, sharedModelCatalogArguments } = await import('../server/model-catalog.mjs');
  assert.equal(verifiedContextWindow('ccswitch_deepseek::deepseek-flash'), 996147);
  assert.equal(verifiedContextWindow('deepseek-v4-pro'), 996147);
  assert.equal(verifiedContextWindow('unknown'), null);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-catalog-home-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  try {
    process.env.HOME = process.env.USERPROFILE = home;
    assert.deepEqual(sharedModelCatalogArguments(), []);
    const codexHome = path.join(home, '.codex');
    const catalog = path.join(codexHome, 'negus-models.json');
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(path.join(codexHome, 'config.toml'), '');
    await fs.writeFile(catalog, '{"models":[]}');
    assert.deepEqual(sharedModelCatalogArguments(), ['-c', `model_catalog_json=${JSON.stringify(catalog)}`]);
  } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await fs.rm(home, { recursive: true, force: true });
  }
});
