import { readProviderModels } from "../provider-model-catalog.mjs";
import { randomUUID } from "node:crypto";
import { createModelDefaultsStore } from "../model-defaults-store.mjs";
import { createProviderProbe } from "../provider-probe.mjs";
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
  const defaults = createModelDefaultsStore(path.join(projectRoot, "runtime/model-defaults.json"));
  const probe = modelProviders?.sharedConfig?.resolveDraft
    ? createProviderProbe({ resolveDraft: modelProviders.sharedConfig.resolveDraft }) : null;
  const emptyTickets = new Map();
  const providerIdOf = entry => entry.owner === "shared" ? "ccswitch_" + entry.id : entry.id;
  const protection = entry => entry.owner !== "shared" ? "此配置由 Negus 或原生 Codex 管理"
    : entry.codexInUse || entry.isCurrent ? "Codex 正在使用此配置"
    : modelProviders.isInUse?.(providerIdOf(entry)) ? "配置仍有运行环境在使用" : "";
  const listChannels = async (force = false, includePricing = true) => {
    await modelProviders.refreshShared?.({ force });
    const shared = await modelProviders.sharedConfig.list(includePricing ? entries => fushengUsage?.readChannelRatios(entries, { force }) || {} : undefined, { force });
    const providers = modelProviders.providers?.() || [];
    const native = providers.find(entry => entry.id === "current");
    const rows = shared.map(entry => ({ ...entry, owner: "shared", codexInUse: native?.sharedConfigId === entry.id }));
    await Promise.all(providers.filter(entry => !entry.id.startsWith("ccswitch_") &&
      !(entry.id === "current" && native.sharedConfigId)).map(async provider => {
      const isNative = provider.id === "current";
      const configured = isNative ? Boolean(await modelProviders.currentConfiguration?.())
        : await modelProviders.isProviderConfigured?.(provider.id);
      rows.unshift({ id: provider.id, name: provider.displayName, baseUrl: provider.baseUrl,
        model: provider.defaultModel, owner: isNative ? "native" : "builtin", editable: false,
        configured: Boolean(configured), switchable: Boolean(configured || isNative) });
    }));
    return rows;
  };
  const refreshChannelCatalog = async (providerId) => {
    const entries = await listChannels(true, false);
    const canonical = providerId && (modelProviders.catalogId?.(providerId) || providerId);
    const targets = entries.filter(entry => entry.configured && entry.switchable !== false &&
      (!canonical || providerIdOf(entry) === canonical));
    if (canonical && !targets.length) throw Object.assign(new Error("此配置没有可查询的供应商目录"), { statusCode: 400 });
    for (const [key, ticket] of emptyTickets) if (ticket.expires < Date.now()) emptyTickets.delete(key);
    const results = [];
    for (let i = 0; i < targets.length; i += 5) {
      results.push(...await Promise.all(targets.slice(i, i + 5).map(async entry => {
        const id = providerIdOf(entry);
        const result = { id, name: entry.name, owner: entry.owner };
        try {
          const { count, version } = await modelProviders.refreshProviderModels(id);
          if (count !== 0) return { ...result, count };
          const reason = protection(entry);
          if (reason || !version) return { ...result, count, protected: reason || "缺少配置版本，请重新刷新" };
          const ticket = randomUUID();
          emptyTickets.set(ticket, { id, version, expires: Date.now() + 300000 });
          return { ...result, count, ticket };
        } catch (error) {
          return { ...result, error: error.message };
        }
      })));
    }
    return results;
  };
  const removeChannel = async (id, version) => {
    const entry = (await listChannels(true, false)).find(row => row.owner === "shared" && row.id === id);
    if (!entry) throw Object.assign(new Error("配置已不存在，请刷新"), { statusCode: 409 });
    const reason = protection(entry);
    if (reason) throw Object.assign(new Error(reason), { statusCode: 409 });
    const remove = () => modelProviders.sharedConfig.remove(id, version);
    const result = await (modelProviders.removeSharedProvider
      ? modelProviders.removeSharedProvider(providerIdOf(entry), remove, { requireEmpty: Boolean(version) }) : remove());
    await defaults.save({}, { selectionOnly: true, ifProvider: "ccswitch_" + id });
    await modelProviders.refreshShared({ force: true });
    return result;
  };
  const readObserverStatus = createObserverReader(observerPort);
  const progressFile = path.join(projectRoot, "docs", "negus-knowledge", "features", "FEATURE_STATUS_INDEX.md");
  return async (request, response, url) => {
    if (url.pathname === '/api/model-defaults' || url.pathname === '/api/model-defaults/selection') {
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'GET' && url.pathname === '/api/model-defaults') { sendJson(response, await defaults.read()); return true; }
      if (request.method === 'POST') {
        const body = await readJson(request, 4096);
        if (body.providerId?.startsWith('ccswitch_')) {
          const entries = await modelProviders.sharedConfig.list(undefined, { force: true });
          const entry = entries.find(e => 'ccswitch_' + e.id === body.providerId);
          if (!entry || !body.model?.startsWith(body.providerId + '::')) throw Object.assign(new Error('配置已不存在或模型不属于此配置'), { statusCode: 400 });
          if (url.pathname.endsWith("/selection")) {
            await modelProviders.refreshShared({ force: true });
            modelProviders.resolveRoute({ model: body.model, modelProviderId: body.providerId });
          }
        } else if (body.providerId) modelProviders.resolveRoute({ model: body.model, modelProviderId: body.providerId });
        sendJson(response, await defaults.save(body, { selectionOnly: url.pathname.endsWith("/selection") })); return true;
      }
    }
    if (url.pathname === '/api/model-channels' && modelProviders?.sharedConfig) {
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'GET') {
        const force = url.searchParams.get('refresh') === '1';
        const [channels, pricing] = await Promise.all([
          listChannels(force),
          fushengUsage?.readPublicRatios?.({ force }).catch(() => null),
        ]);
        sendJson(response, { channels, pricing });
        return true;
      }
      if (request.method === 'POST') {
        const body = await readJson(request, 16384);
        if (body.action === 'discover' || body.action === 'test') {
          if (!probe) throw new Error('配置测试暂不可用');
          sendJson(response, await probe(body));
          return true;
        }
        if (body.action === "delete") {
          sendJson(response, await removeChannel(String(body.id || "")));
          return true;
        }
        if (body.id) {
          await modelProviders.refreshShared?.({ force: true });
          if (modelProviders.catalogId?.("current") === "ccswitch_" + body.id) {
            throw Object.assign(new Error("Codex 正在使用此配置"), { statusCode: 409 });
          }
        }
        const result = await modelProviders.sharedConfig.save(body);
        await modelProviders.refreshShared({ force: true });
        sendJson(response, result);
        return true;
      }
    }
    if (url.pathname === "/api/model-channels/catalog" && request.method === "POST" && modelProviders?.sharedConfig) {
      const body = await readJson(request, 16384);
      if (body.action === "refresh") {
        sendJson(response, { results: await refreshChannelCatalog(String(body.providerId || "")) });
        return true;
      }
      if (body.action === "delete-empty" && Array.isArray(body.tickets)) {
        const results = [];
        for (const key of new Set(body.tickets)) {
          const ticket = emptyTickets.get(key);
          if (!ticket || ticket.expires < Date.now()) {
            results.push({ ticket: key, error: "删除确认已失效，请重新刷新" });
            continue;
          }
          emptyTickets.delete(key);
          try {
            const current = await modelProviders.refreshProviderModels(ticket.id);
            if (current.count !== 0 || current.version !== ticket.version) throw new Error("目录或配置已变更，请重新刷新");
            await removeChannel(ticket.id.slice(9), ticket.version);
            results.push({ ticket: key, deleted: true });
          } catch (error) {
            results.push({ ticket: key, error: error.message });
          }
        }
        sendJson(response, { results });
        return true;
      }
      throw Object.assign(new Error("无效的目录操作"), { statusCode: 400 });
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
        sendJson(response, { models: (await readProviderModels(upstream)).sort() });
      } catch (error) {
        sendJson(response, { error: error.statusCode ? error.message : error.name === "TimeoutError"
          ? "模型目录查询超时，请重试" : "模型目录查询失败，请检查地址和网络" }, 502);
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
    if (url.pathname === "/api/uploads/plan" && request.method === "POST") {
      const enabled = media.cos && request.headers.origin === media.cos.origin;
      sendJson(response, enabled ? media.cos.plan(await readJson(request, 4096)) : { direct: true });
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
      const id = url.pathname.slice("/api/media/".length);
      const local = id.startsWith("cos.") && media.cos ? await media.cos.resolve(id, media) : null;
      await media.serve(request, response, local?.id || id, {
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
