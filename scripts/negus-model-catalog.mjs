// DeepSeek metadata: https://api-docs.deepseek.com/quick_start/agent_integrations/codex
// Regenerate after upgrading Codex; retain its model-specific work instructions,
// removing only the fixed model identity, and preserve other custom models.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import TOML from '@iarna/toml';
import { resolveCodexCommand } from '../windows/server/app-server-client.mjs';
import { neutralModelInstructions } from '../windows/server/model-catalog.mjs';

const home = path.join(os.homedir(), '.codex');
const configPath = path.join(home, 'config.toml');
const original = await fs.readFile(configPath, 'utf8');
const config = TOML.parse(original);
const catalogPath = path.join(home, 'negus-models.json');
const launch = resolveCodexCommand();
const catalog = JSON.parse(execFileSync(launch.command, [...launch.prefixArgs, 'debug', 'models', '--bundled'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
if (config.model_catalog_json) {
  const previous = JSON.parse(await fs.readFile(config.model_catalog_json.replace(/^~(?=\/)/u, os.homedir()), 'utf8'));
  catalog.models.push(...previous.models.filter(model => !catalog.models.some(item => item.slug === model.slug)));
}
const deepseek = JSON.parse(await fs.readFile(new URL('../windows/server/deepseek-models.json', import.meta.url), 'utf8'));
const template = catalog.models.find(model => model.slug === 'gpt-6.1-sol');
if (!template?.base_instructions) throw new Error('Codex common instructions unavailable; configuration unchanged');
for (const metadata of deepseek.models) {
  const model = { ...metadata, base_instructions: template.base_instructions, model_messages: template.model_messages };
  const index = catalog.models.findIndex(item => item.slug === model.slug);
  if (index < 0) catalog.models.push(model); else catalog.models[index] = model;
}
for (const model of catalog.models) {
  model.base_instructions = neutralModelInstructions(model.base_instructions);
  if (model.model_messages?.instructions_template) model.model_messages.instructions_template = neutralModelInstructions(model.model_messages.instructions_template);
}
const temporary = catalogPath + '.tmp';
await fs.writeFile(temporary, JSON.stringify(catalog));
// Validate with the installed Codex before changing its shared configuration.
execFileSync(launch.command, [...launch.prefixArgs, '-c', `model_catalog_json=${JSON.stringify(temporary)}`, 'debug', 'models'], { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
await fs.copyFile(configPath, configPath + '.before-negus-models', fs.constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
await fs.rename(temporary, catalogPath);
const line = `model_catalog_json = ${JSON.stringify(catalogPath)}`;
const next = original.replace(/^model_catalog_json\s*=.*\r?\n/gmu, '');
await fs.writeFile(configPath + '.tmp', line + '\n' + next, { mode: 0o600 });
await fs.rename(configPath + '.tmp', configPath);
console.log(JSON.stringify({ catalogPath, models: catalog.models.length, deepseek: deepseek.models.map(model => model.slug) }));
