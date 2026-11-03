import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';
import { zstdDecompressSync } from 'node:zlib';

export const neutralModelInstructions = text => text?.replace(/^You are Codex, (?:an agent|a coding agent) based on GPT-[\w.-]+\.(?=\s|$)/u, 'You are a coding assistant.');

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
  if (file.endsWith('.zst')) {
    const entry = JSON.parse(zstdDecompressSync(await fs.promises.readFile(file)).toString('utf8').split('\n')[0]);
    const original = entry.payload?.base_instructions?.text;
    const text = neutralModelInstructions(original);
    return text !== original ? { baseInstructions: text } : {};
  }
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

// FEAT-001: every ordinary/employee/task client shares old-thread identity cleanup.
export async function requestWithNeutralIdentity(method, params, send, cleaned = new Set()) {
  if (params.baseInstructions) params = { ...params, baseInstructions: neutralModelInstructions(params.baseInstructions) };
  const result = await send(method, params);
  if (!['thread/resume', 'thread/fork'].includes(method) || params.baseInstructions || cleaned.has(result?.thread?.id)) return result;
  const neutral = await neutralThreadInstructions(result?.thread?.path);
  if (!neutral.baseInstructions) { cleaned.add(result?.thread?.id); return result; }
  const resumed = await send('thread/resume', { ...(method === 'thread/resume' ? params : {}),
    threadId: result.thread.id, persistExtendedHistory: true, ...neutral });
  cleaned.add(result.thread.id);
  return resumed;
}
