import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);

const rolloutHome = (file) => {
  let directory = path.dirname(file);
  while (path.dirname(directory) !== directory && !['sessions', 'archived_sessions'].includes(path.basename(directory))) {
    directory = path.dirname(directory);
  }
  return ['sessions', 'archived_sessions'].includes(path.basename(directory)) ? path.dirname(directory) : null;
};

// Native resume trusts both rollout metadata and its persisted thread index.
export async function setTransferredProvider(file, sourceFile, threadId, modelProvider, targetThreadId = threadId, settings = {}) {
  if (path.resolve(file) === path.resolve(sourceFile) && targetThreadId === threadId && !settings.model) return;
  const home = rolloutHome(file);
  let nativeProvider = modelProvider;
  if (nativeProvider === 'current') {
    const config = await fs.readFile(path.join(home || '', 'config.toml'), 'utf8').catch(() => '');
    nativeProvider = TOML.parse(config).model_provider || 'openai';
  }
  const compressed = file.endsWith('.zst');
  const content = (compressed ? await decompress(await fs.readFile(file)) : await fs.readFile(file)).toString('utf8');
  const newline = content.indexOf('\n');
  const header = JSON.parse(newline < 0 ? content : content.slice(0, newline));
  if (header.type !== 'session_meta' || header.payload?.id !== threadId) throw Error('原对话记录校验失败，未切换配置');
  header.payload.id = targetThreadId;
  if (header.payload.session_id) header.payload.session_id = targetThreadId;
  header.payload.model_provider = nativeProvider;
  const entries = (newline < 0 ? '' : content.slice(newline)).split('\n').map(line => {
    if (!line) return { line, changed: false };
    const entry = JSON.parse(line);
    const applied = entry.type === 'event_msg' && entry.payload?.type === 'thread_settings_applied'
      ? entry.payload.thread_settings : null;
    if (applied && applied.model_provider_id !== nativeProvider) {
      applied.model_provider_id = nativeProvider;
      return { line, entry, settings: applied, changed: true };
    }
    return { line, entry, settings: applied, changed: false };
  });
  const latest = entries.findLast(entry => entry.settings);
  if (latest && settings.model) {
    latest.settings.model = settings.model;
    if (settings.reasoningEffort !== undefined) latest.settings.reasoning_effort = settings.reasoningEffort;
    if (latest.settings.collaboration_mode?.settings) {
      latest.settings.collaboration_mode.settings.model = settings.model;
      if (settings.reasoningEffort !== undefined) latest.settings.collaboration_mode.settings.reasoning_effort = settings.reasoningEffort;
    }
    latest.changed = true;
  }
  const tail = entries.map(entry => entry.changed ? JSON.stringify(entry.entry) : entry.line).join('\n');
  const temporary = `${file}.provider-${process.pid}`;
  const output = Buffer.from(JSON.stringify(header) + tail);
  await fs.writeFile(temporary, compressed ? await compress(output) : output, { mode: 0o600 });
  await fs.rename(temporary, file);
  if (!home) return;
  const databases = (await fs.readdir(home)).filter(name => /^state_\d+\.sqlite$/.test(name));
  if (!databases.length) return;
  const { DatabaseSync } = await import('node:sqlite');
  for (const name of databases) {
    const db = new DatabaseSync(path.join(home, name));
    try {
      db.exec('PRAGMA busy_timeout=5000');
      db.prepare('UPDATE threads SET model_provider=? WHERE id=? AND rollout_path=?').run(nativeProvider, targetThreadId, file);
    } finally {
      db.close();
    }
  }
}

export async function removeTransferredThread(file, threadId) {
  const home = rolloutHome(file);
  if (!home) return;
  const databases = (await fs.readdir(home)).filter(name => /^state_\d+\.sqlite$/.test(name));
  if (!databases.length) return;
  const { DatabaseSync } = await import('node:sqlite');
  for (const name of databases) {
    const db = new DatabaseSync(path.join(home, name));
    try {
      db.exec('PRAGMA busy_timeout=5000');
      db.prepare('DELETE FROM threads WHERE id=? AND rollout_path=?').run(threadId, file);
    } finally {
      db.close();
    }
  }
}
