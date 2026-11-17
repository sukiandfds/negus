import fs from "node:fs/promises";
import path from "node:path";

const clean = (value, maxLength = 800) => String(value || "").trim().slice(0, maxLength);

export const loadBusinessProjects = async (configFile) => {
  try {
    const parsed = JSON.parse(await fs.readFile(configFile, "utf8"));
    return (Array.isArray(parsed?.projects) ? parsed.projects : [])
      .map((entry) => {
        const root = clean(entry?.root);
        if (!root) return null;
        return {
          key: clean(entry.key, 160) || path.basename(root),
          name: clean(entry.name, 240) || path.basename(root),
          root: path.resolve(root),
          provider: clean(entry.provider, 80) || "codex",
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const createBusinessProjectLoader = (configFile) => {
  let signature = "";
  let projects = [];
  let queue = Promise.resolve();
  return () => {
    const next = queue.then(async () => {
      let current = "";
      try {
        const stat = await fs.stat(configFile, { bigint: true });
        current = `${stat.mtimeNs}:${stat.size}`;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        current = "missing";
      }
      if (current === signature) return projects;
      projects = current === "missing" ? [] : await loadBusinessProjects(configFile);
      signature = current;
      return projects;
    });
    queue = next.catch(() => {});
    return next;
  };
};
