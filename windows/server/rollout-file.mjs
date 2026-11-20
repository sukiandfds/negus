import fs from 'node:fs/promises';
import path from 'node:path';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';
const decompress = promisify(zstdDecompress);

const threadIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const rolloutNamePattern = /\.jsonl(?:\.zst)?$/u;
const volumeOrderCache = new Map();

const rolloutSearchRoot = (file) => {
  const resolved = path.resolve(file);
  const parts = resolved.split(path.sep);
  const index = parts.findLastIndex(part => part === 'sessions' || part === 'archived_sessions');
  return index > 0 ? parts.slice(0, index + 1).join(path.sep) : path.dirname(resolved);
};

// Codex compaction continues the same Thread in a second rollout file. Reads
// must follow that file or list previews and runtime usage stay at the old state.
export async function orderedRolloutFiles(files) {
  if (files.length < 2) return files;
  const entries = await Promise.all(files.map(async file => {
    const stat = await fs.stat(file);
    const version = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const cached = volumeOrderCache.get(file);
    if (cached?.version === version) return cached;
    const handle = await openRollout(file);
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      let metadataTime = '', eventTime = '';
      for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
        let record; try { record = JSON.parse(line); } catch { continue; }
        const time = record.timestamp || (record.type === 'session_meta' ? record.payload?.timestamp : null);
        if (!time || !Number.isFinite(Date.parse(time))) continue;
        if (record.type === 'session_meta') metadataTime = new Date(time).toISOString();
        else { eventTime = new Date(time).toISOString(); break; }
      }
      const name = path.basename(file);
      const filenameTime = name.match(/^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-/u)?.[1]?.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3') || '';
      const entry = { file, version, order: [metadataTime || filenameTime || eventTime || name, filenameTime || eventTime, name].join('|') };
      volumeOrderCache.set(file, entry);
      return entry;
    } finally { await handle.close(); }
  }));
  return entries.sort((a, b) => a.order.localeCompare(b.order) || a.file.localeCompare(b.file)).map(entry => entry.file);
}

export async function latestRolloutFile(file) {
  if (!file || typeof file !== 'string') return file;
  const threadId = path.basename(file).match(threadIdPattern)?.[0]?.toLowerCase();
  if (!threadId) return file;
  let entries;
  try {
    entries = await fs.readdir(rolloutSearchRoot(file), { recursive: true, withFileTypes: true });
  } catch {
    return file;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !rolloutNamePattern.test(entry.name)
      || entry.name.match(threadIdPattern)?.[0]?.toLowerCase() !== threadId) continue;
    const candidate = path.join(entry.parentPath || entry.path, entry.name);
    try {
      await fs.access(candidate);
      candidates.push(candidate);
    } catch {}
  }
  return (await orderedRolloutFiles(candidates.length ? candidates : [file])).at(-1);
}

// Read compressed history in memory through the same parser; never rewrite the source.
export async function openRollout(file) {
  if (!file.endsWith('.zst')) return fs.open(file, 'r');
  const data = await decompress(await fs.readFile(file));
  return {
    stat: async () => ({ size: data.length }),
    read: async (buffer, offset, length, position) => ({ bytesRead: position >= data.length ? 0 : data.copy(buffer, offset, position, Math.min(data.length, position + length)) }),
    close: async () => {},
  };
}

export async function readRolloutHead(file) {
  const handle = await openRollout(file);
  try {
    const stat = await handle.stat();
    const buffer = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0];
  } finally {
    await handle.close();
  }
}
