import path from "node:path";
import { readJson, sendJson } from "../http/request-utils.mjs";
import { createImageSettingsStore, requireImageConnection } from "../image-generation/image-settings.mjs";
import { createHappyEveringImageClient } from "../image-generation/happyevering-client.mjs";

export const createImageSettingsRoutes = ({ projectRoot, store = createImageSettingsStore(path.join(projectRoot, "runtime/image-settings.json")), fetchImpl = fetch, createClient = createHappyEveringImageClient }) => {
  let testing = false;
  return async (request, response, url) => {
    if (url.pathname !== "/api/settings/image-generation") return false;
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") { sendJson(response, await store.list()); return true; }
    if (request.method !== "POST") { sendJson(response, { error: "不支持的请求方法" }, 405); return true; }
    const input = await readJson(request, 20000);
    if (input.action !== "discover" && input.action !== "test") {
      sendJson(response, await store.mutate(input)); return true;
    }
    const entry = await store.resolveDraft(input);
    const connection = requireImageConnection(entry);
    if (input.action === "discover") {
      let upstream, payload;
      try {
        upstream = await fetchImpl(connection.baseUrl + "/models", {
          headers: { Authorization: "Bearer " + connection.apiKey }, redirect: "error", signal: AbortSignal.timeout(15000),
        });
        if (upstream.ok) payload = await upstream.json();
      } catch { throw Object.assign(new Error("模型查询失败，请检查 API 地址和网络"), { statusCode: 502 }); }
      if (!upstream.ok) throw Object.assign(new Error("供应商返回 HTTP " + upstream.status + "，请检查分组 Key 和权限"), { statusCode: 502 });
      if (!Array.isArray(payload?.data)) throw Object.assign(new Error("供应商未返回兼容的模型目录"), { statusCode: 502 });
      const models = [...new Set(payload.data.map(item => item?.id).filter(id => typeof id === "string" && id.length <= 200 && id.trim() && !/[\r\n]/u.test(id)))].sort();
      sendJson(response, { models }); return true;
    }
    if (!entry.model) throw Object.assign(new Error("请选择或填写要测试的模型"), { statusCode: 400 });
    if (testing) throw Object.assign(new Error("已有图片测试正在进行，请等待结果"), { statusCode: 409 });
    testing = true;
    try {
      const result = await createClient({ ...connection, outputDirectory: path.join(projectRoot, "runtime/generated-images") }).generate({
        model: entry.model, prompt: "A simple blue circle on a white background.", size: "1024x1024", n: 1,
      });
      sendJson(response, { usable: true, count: result.outputs.length });
    } catch { throw Object.assign(new Error("生图测试未确认成功，请检查模型权限、余额和接口支持；不要连续重复提交"), { statusCode: 502 }); }
    finally { testing = false; }
    return true;
  };
};
