import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Read the same native thread metadata that backs thread/list without opening a model client.
export async function readLocalThreadIndex(home, projectRoots, archived = false) {
  const files = await fs.readdir(home).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const index = files.filter(name => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0];
  if (!index || !projectRoots.length) return [];
  const db = new DatabaseSync(path.join(home, index), { readOnly: true });
  try {
    const rows = db.prepare(`SELECT * FROM threads WHERE archived = ? AND cwd IN
      (${projectRoots.map(() => '?').join(',')})`).all(Number(archived), ...projectRoots);
    return rows.map(row => ({
      id: row.id, cwd: row.cwd, path: row.rollout_path, model: row.model,
      source: row.source.startsWith('{') ? JSON.parse(row.source) : row.source,
      cliVersion: row.cli_version, name: row.name || row.title,
      preview: row.preview || row.first_user_message, updatedAt: row.updated_at,
      forkedFromId: row.forked_from_id || null,
    }));
  } finally { db.close(); }
}
