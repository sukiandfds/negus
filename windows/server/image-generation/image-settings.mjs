import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const imageInstallationRoot = process.env.NEGUS_INSTALL_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const imageSettingsFile = path.join(imageInstallationRoot, "runtime/image-settings.json");
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const fields = ["name", "website", "baseUrl", "userId", "model"];
const secretFields = ["userKey", "groupKey"];
const empty = () => ({ revision: "", defaultId: "", configurations: [] });
const text = (value, limit = 2000) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > limit || /[\r\n\0]/u.test(value)) throw fail("配置内容格式无效");
  return value.trim();
};
export const publicImageSettings = (data) => ({ ...data, configurations: data.configurations.map(entry => {
  const { userKey, groupKey, ...visible } = entry;
  return { ...visible, hasUserKey: Boolean(userKey), hasGroupKey: Boolean(groupKey) };
}) });
export const validateImageEndpoint = (value) => {
  let url;
  try { url = new URL(value); } catch { throw fail("请填写 API 接口地址"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw fail("请填写有效的 HTTPS API 接口地址");
  return url.href.replace(/\/+$/u, "");
};
export const requireImageConnection = (entry) => {
  const baseUrl = validateImageEndpoint(entry.baseUrl);
  if (!entry.groupKey) throw fail("请填写分组 Key（模型调用 Key）");
  return { baseUrl, apiKey: entry.groupKey };
};

export const createImageSettingsStore = (file = imageSettingsFile) => {
  let pending = Promise.resolve();
  const read = async () => {
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      if (!Array.isArray(data.configurations) || typeof data.revision !== "string") throw Error();
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return empty();
      throw fail("图片配置读取失败，原文件未改动", 500);
    }
  };
  const draft = (input, data) => {
    const id = text(input.id, 100);
    const sourceId = text(input.sourceId, 100);
    const source = data.configurations.find(entry => entry.id === (sourceId || id));
    if ((id || sourceId) && !source) throw fail("配置已不存在，请刷新", 409);
    const next = { id: id || randomUUID() };
    for (const field of fields) next[field] = text(input[field] ?? source?.[field]);
    for (const field of secretFields) {
      const mode = input[field + "Mode"] || (source ? "keep" : "clear");
      if (!["keep", "replace", "clear"].includes(mode)) throw fail("Key 操作无效");
      next[field] = mode === "keep" ? source?.[field] || "" : mode === "clear" ? "" : text(input[field], 4096);
    }
    return next;
  };
  const resolveDraft = async (input) => {
    const data = await read();
    const entry = draft(input, data);
    const source = data.configurations.find(item => item.id === (input.sourceId || input.id));
    if (input.groupKeyMode === "keep" && source?.baseUrl?.replace(/\/+$/u, "") !== entry.baseUrl.replace(/\/+$/u, ""))
      throw fail("API 地址已更改，请重新填写分组 Key 后查询或测试");
    return entry;
  };
  const mutate = (input) => {
    const operation = pending.then(async () => {
      const data = await read();
      if (input.revision !== data.revision) throw fail("配置已在其他页面更新，请刷新后重试", 409);
      const index = data.configurations.findIndex(entry => entry.id === input.id);
      if (input.action === "delete") {
        if (index < 0) throw fail("配置已不存在", 409);
        data.configurations.splice(index, 1);
        if (data.defaultId === input.id) data.defaultId = "";
      } else if (input.action === "default") {
        if (index < 0) throw fail("请先保存配置");
        data.defaultId = input.id;
      } else if (!input.action || input.action === "save") {
        const next = draft(input, data);
        if (index < 0) {
          if (data.configurations.length >= 100) throw fail("最多保存 100 个图片配置");
          data.configurations.push(next);
          if (data.configurations.length === 1) data.defaultId = next.id;
        } else data.configurations[index] = next;
      } else throw fail("不支持的配置操作");
      data.revision = randomUUID();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = file + "." + randomUUID() + ".tmp";
      try {
        await fs.writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
      return publicImageSettings(data);
    });
    pending = operation.catch(() => {});
    return operation;
  };
  return { read, resolveDraft, mutate, list: async () => publicImageSettings(await read()) };
};
