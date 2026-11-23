import path from "node:path";
import { readJson, sendJson } from "../http/request-utils.mjs";
import { readJsonFile, writeJsonFileAtomic } from "../persistence/json-file.mjs";

export const createEmployeeProjectDirectoryRoutes = ({ directory, projectRoot }) => {
  const file = path.join(projectRoot || ".", "runtime/conversation-pins.json");
  const read = () => readJsonFile(file, { revision: 0, times: {} });
  let writes = Promise.resolve();
  return async (request, response, url) => {
    if (url.pathname === "/api/project-directory" && request.method === "GET") {
      const [list, pins] = await Promise.all([directory.list(), read()]);
      sendJson(response, { ...list, pins });
      return true;
    }
    if (url.pathname !== "/api/project-directory/pin" || request.method !== "POST") return false;
    const { id, pinned, legacy } = await readJson(request);
    const valid = key => typeof key === "string" && key.length > 0 && key.length <= 512 && !(key in Object.prototype);
    const importing = Array.isArray(legacy) && legacy.every(valid);
    if (!importing && !(valid(id) && typeof pinned === "boolean")) {
      sendJson(response, { error: "无效的置顶操作" }, 400); return true;
    }
    const save = writes.then(async () => {
      const pins = await read();
      if (importing) {
        // Unknown historic times tie, so the existing activity ordering is retained.
        for (const key of legacy) pins.times[key] ??= 1;
      } else if (Boolean(pins.times[id]) !== pinned || !(id in pins.times)) {
        pins.times[id] = pinned ? Math.max(Date.now(), pins.revision + 1) : 0;
      }
      pins.revision = Math.max(Date.now(), pins.revision + 1);
      await writeJsonFileAtomic(file, pins);
      return pins;
    });
    writes = save.catch(() => {});
    sendJson(response, await save);
    return true;
  };
};
