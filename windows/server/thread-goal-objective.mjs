import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const goalFilePrefix = "Read the Codex goal objective file at ";
const suffix = " before continuing.";
const name = "goal-objective.md";
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
