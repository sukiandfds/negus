import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const parse = (text, fallback) => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
};

// Missing and corrupt state files are both treated as "no saved state": every
// service that uses this helper can rebuild its state from Codex or from the
// next user action, so a damaged file must never block startup.
export const readJsonState = async (file, fallback = {}) => {
  if (!file) return fallback;
  try {
    return parse(await fsp.readFile(file, "utf8"), fallback);
  } catch {
    return fallback;
  }
};

export const readJsonStateSync = (file, fallback = {}) => {
  if (!file) return fallback;
  try {
    return parse(fs.readFileSync(file, "utf8"), fallback);
  } catch {
    return fallback;
  }
};

// Serialises writes to one state file and replaces it atomically, so a crash
// or a concurrent write can never leave a half-written JSON document behind.
export const createJsonStateWriter = (file, { label = path.basename(file || "state") } = {}) => {
  let queue = Promise.resolve();
  let sequence = 0;

  const write = (value) => {
    if (!file) return queue;
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    const temporary = `${file}.${process.pid}.${sequence += 1}.tmp`;
    const next = queue.then(async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      try {
        await fsp.writeFile(temporary, payload, "utf8");
        await fsp.rename(temporary, file);
      } catch (error) {
        await fsp.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
    // Later writes must still run after a failed one; callers that await the
    // returned promise decide whether a failure matters to them.
    queue = next.catch((error) => console.warn(`[${label}] state persistence failed: ${error.message}`));
    return next;
  };

  return { write, flush: () => queue };
};
