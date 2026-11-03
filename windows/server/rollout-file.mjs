import fs from 'node:fs/promises';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';
const decompress = promisify(zstdDecompress);

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
