import path from "node:path";
import { sendJson } from "../http/request-utils.mjs";
import {
  createProjectPageDraft,
  readProjectManagement,
  readProjectManagementEntry,
  readProjectPageDraft,
  readProjectPageDrafts,
} from "../project-management-store.mjs";
import { readJson } from "../http/request-utils.mjs";
import { readProjectProgress } from "../project-progress-store.mjs";

const createObserverReader = (observerPort) => async (threadId = "") => {
  try {
    const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
    const response = await fetch(`http://127.0.0.1:${observerPort}/status${query}`);
    if (!response.ok) throw new Error(`observer HTTP ${response.status}`);
    return await response.json();
  } catch {
    return { connected: false, summaryStatus: "offline", summary: "" };
  }
};

export const createSystemRoutes = ({ token, project, projectRoot, device, observerPort, media, realtime, modelProviders, fushengUsage }) => {
  const readObserverStatus = createObserverReader(observerPort);
  const progressFile = path.join(projectRoot, "docs", "feature-development", "FEATURE_STATUS_INDEX.md");
  return async (request, response, url) => {
    if (url.pathname === '/api/model-channels' && modelProviders?.sharedConfig) {
      response.setHeader('Cache-Control', 'private, max-age=5, stale-while-revalidate=30');
      if (request.method === 'GET') {
        const force = url.searchParams.get('refresh') === '1';
        sendJson(response, { channels: await modelProviders.sharedConfig.list(fushengUsage?.readChannelRatios, { force }) });
        return true;
      }
      if (request.method === 'POST') {
        const body = await readJson(request, 16384);
        const result = body.action === 'delete'
          ? await modelProviders.sharedConfig.remove(String(body.id || ''))
          : await modelProviders.sharedConfig.save(body);
        await modelProviders.refreshShared({ force: true });
        sendJson(response, result);
        return true;
      }
    }
    if (url.pathname === "/api/fusheng/models/check" && request.method === "POST") {
      const body = await readJson(request, 8192);
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (!apiKey || apiKey.length > 4096 || /[\r\n]/u.test(apiKey)) {
        sendJson(response, { error: "请输入有效的 API Key" }, 400);
        return true;
      }
      try {
        const upstream = await fetch("https://fushengyunsuan.cn/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (!upstream.ok) {
          sendJson(response, { error: upstream.status === 401 || upstream.status === 403
            ? "Key 无效或没有查询权限" : `渠道暂时不可用（HTTP ${upstream.status}）` }, 502);
          return true;
        }
        const payload = await upstream.json();
        if (!Array.isArray(payload.data)) throw new Error("Invalid model list");
        const models = [...new Set(payload.data.map((entry) => entry?.id)
          .filter((id) => typeof id === "string" && id.length <= 200))].sort();
        sendJson(response, { models });
      } catch {
        sendJson(response, { error: "查询超时或渠道返回异常，请稍后重试" }, 502);
      }
      return true;
    }
    if (url.pathname === "/api/project") {
      sendJson(response, { name: project, root: projectRoot, mode: "interactive" });
      return true;
    }
    if (url.pathname === "/api/device") {
      sendJson(response, device);
      return true;
    }
    if (url.pathname === "/api/share-link" && request.method === "GET") {
      sendJson(response, { token });
      return true;
    }
    if (url.pathname === "/api/project-progress" && request.method === "GET") {
      sendJson(response, await readProjectProgress({ project, projectRoot, progressFile }));
      return true;
    }
    if (url.pathname === "/api/project-management" && request.method === "GET") {
      sendJson(response, await readProjectManagement({ project, projectRoot }));
      return true;
    }
    if (url.pathname === "/api/project-management/page-drafts" && request.method === "GET") {
      sendJson(response, { drafts: await readProjectPageDrafts({ projectRoot }), source: "runtime/project-page-drafts.json" });
      return true;
    }
    if (url.pathname === "/api/project-management/page-drafts" && request.method === "POST") {
      const body = await readJson(request);
      sendJson(response, await createProjectPageDraft({
        projectRoot,
        request: body.request,
        location: body.location,
      }), 201);
      return true;
    }
    const pageDraftMatch = /^\/api\/project-management\/page-drafts\/([^/]+)$/u.exec(url.pathname);
    if (pageDraftMatch && request.method === "GET") {
      sendJson(response, await readProjectPageDraft({ projectRoot, draftId: decodeURIComponent(pageDraftMatch[1]) }));
      return true;
    }
    const projectManagementEntryMatch = /^\/api\/project-management\/entries\/([A-Z][A-Z0-9]+-\d{3})$/u.exec(url.pathname);
    if (projectManagementEntryMatch && request.method === "GET") {
      sendJson(response, await readProjectManagementEntry({ projectRoot, entryId: projectManagementEntryMatch[1] }));
      return true;
    }
    if (url.pathname === "/api/uploads" && request.method === "POST") {
      const upload = await media.upload(request, {
        name: url.searchParams.get("name") || "attachment",
        mimeType: request.headers["content-type"] || "",
      });
      sendJson(response, upload, 201);
      return true;
    }
    if (url.pathname.startsWith("/api/media/")) {
      await media.serve(request, response, url.pathname.slice("/api/media/".length), {
        download: url.searchParams.get("download") === "1",
        preview: url.searchParams.get("preview") === "1",
      });
      return true;
    }
    if (url.pathname === "/api/status") {
      sendJson(response, await readObserverStatus(url.searchParams.get("threadId") || ""));
      return true;
    }
    if (url.pathname === "/events") {
      realtime.connect(request, response);
      return true;
    }
    return false;
  };
};
