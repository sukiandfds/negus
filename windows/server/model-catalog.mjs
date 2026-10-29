import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';

export const neutralModelInstructions = text => text?.replace(/^You are Codex, an agent based on GPT-[^.]+\./u, 'You are a coding assistant.');

// All Negus providers and the desktop use the user's same catalog.
export const sharedModelCatalogArguments = () => {
  const home = path.join(os.homedir(), '.codex');
  let config;
  try { config = TOML.parse(fs.readFileSync(path.join(home, 'config.toml'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return config.model_catalog_json ? ['-c', `model_catalog_json=${JSON.stringify(config.model_catalog_json)}`] : [];
};

export const neutralThreadInstructions = async file => {
  if (!file) return {};
  const handle = await fs.promises.open(file, 'r').catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!handle) return {};
  try {
    for await (const line of handle.readLines()) {
      const entry = JSON.parse(line);
      if (entry.type !== 'session_meta') return {};
      const original = entry.payload?.base_instructions?.text;
      const text = neutralModelInstructions(original);
      return text !== original ? { baseInstructions: text } : {};
    }
    return {};
  } finally { await handle.close(); }
};
