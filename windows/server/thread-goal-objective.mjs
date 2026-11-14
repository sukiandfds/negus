import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const goalFilePrefix = "Read the Codex goal objective file at ";
const suffix = " before continuing.";
const name = "goal-objective.md";
// FEAT-001: viewing an unloaded goal must not resume its thread.
export const readThreadGoal = async (client, threadId, root, options) => {
  try { return await client.request("thread/goal/get", { threadId }, options); }
  catch (error) {
    if (!/thread not loaded|thread not found/i.test(error.message)) throw error;
    const file = path.join(path.dirname(root), 'goals_1.sqlite');
    try { await fs.access(file); } catch (missing) { if (missing.code === 'ENOENT') return { goal: null }; throw missing; }
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;');
      const row = db.prepare('SELECT * FROM thread_goals WHERE thread_id = ?').get(threadId);
      return { goal: row ? { threadId: row.thread_id, objective: row.objective,
        status: ({ usage_limited: 'usageLimited', budget_limited: 'budgetLimited' })[row.status] || row.status,
        tokenBudget: row.token_budget, tokensUsed: row.tokens_used, timeUsedSeconds: row.time_used_seconds,
        createdAt: row.created_at_ms / 1000, updatedAt: row.updated_at_ms / 1000 } : null };
    } finally { db.close(); }
  }
};
export const materializeGoalObjective = async (objective, root) => {
  if (Array.from(objective).length <= 4000) return { objective, directory: null };
  const directory = path.join(root, randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await fs.writeFile(file, objective, "utf8");
  return { objective: goalFilePrefix + file + suffix, directory };
};
export const expandGoalObjective = async (goal, root) => {
  if (!goal?.objective?.startsWith(goalFilePrefix) || !goal.objective.endsWith(suffix)) return goal;
  const file = goal.objective.slice(goalFilePrefix.length, -suffix.length);
  const directory = path.basename(path.dirname(file));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(directory)
    || path.resolve(file) !== path.resolve(root, directory, name)) return goal;
  try {
    // Resolve symlinks as well: a goal string must never become an arbitrary file reader.
    const realRoot = await fs.realpath(root);
    const realFile = await fs.realpath(file);
    if (path.relative(realRoot, realFile).startsWith("..") || path.isAbsolute(path.relative(realRoot, realFile))) return goal;
    return { ...goal, displayObjective: await fs.readFile(realFile, "utf8") };
  } catch { return goal; }
};
