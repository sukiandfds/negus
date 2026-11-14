import fs from 'node:fs/promises';
import path from 'node:path';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';
const decompress = promisify(zstdDecompress);

const threadIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const rolloutNamePattern = /\.jsonl(?:\.zst)?$/u;

const rolloutSearchRoot = (file) => {
  const resolved = path.resolve(file);
  const parts = resolved.split(path.sep);
  const index = parts.findLastIndex(part => part === 'sessions' || part === 'archived_sessions');
  return index > 0 ? parts.slice(0, index + 1).join(path.sep) : path.dirname(resolved);
};

// Codex compaction continues the same Thread in a second rollout file. Reads
// must follow that file or list previews and runtime usage stay at the old state.
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
      const stat = await fs.stat(candidate);
      candidates.push({ file: candidate, modifiedAt: stat.mtimeMs });
    } catch {}
  }
  return candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.file || file;
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
