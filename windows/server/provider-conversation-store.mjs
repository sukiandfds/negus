import { latestAssistantReplyAtFromRollout } from "./app-server-conversation-store.mjs";
import fs from "node:fs/promises";
import path from "node:path";

// Ordinary project conversations only. Employee runtimes keep their own bindings.
export const createProviderConversationStore = ({ current, providers, createStore, stateFile }) => {
  const stores = new Map([["current", Promise.resolve(current)]]);
  let routes = {};
  const ready = fs.readFile(stateFile, "utf8").then((text) => { routes = JSON.parse(text); })
    .catch((error) => { if (error.code !== "ENOENT") throw error; });
  let writing = Promise.resolve();
  const save = () => {
    writing = writing.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      const temporary = `${stateFile}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(routes), "utf8");
      await fs.rename(temporary, stateFile);
    });
    return writing;
  };
  const storeFor = (providerId) => {
    if (!stores.has(providerId)) {
      const pending = providers.getClient({ modelProviderId: providerId }).then((client) => createStore(client, providerId));
      stores.set(providerId, pending);
      void pending.catch(() => stores.delete(providerId));
    }
    return stores.get(providerId);
  };
  const owner = (id) => routes[id]?.providerId || "current";
  const decorate = (session) => session && ({ ...session,
    model: routes[session.threadId]?.model || session.model || "",
    modelProviderId: routes[session.threadId]?.pendingProviderId || owner(session.threadId),
  });
  const service = {};
  const rememberPreviousSettings = async (id, source) => {
    if (Object.hasOwn(routes[id] || {}, "lastSuccessfulSettings")) return;
    const info = source.isFreshSession?.(id) ? null : await source.getSessionResumeInfo(id);
    const previous = info?.path ? await latestAssistantReplyAtFromRollout(info.path, true) : null;
    routes[id] = { ...routes[id], providerId: owner(id), lastSuccessfulSettings: previous ? {
      ...previous, model: owner(id).startsWith("ccswitch_") ? owner(id) + "::" + previous.model : previous.model,
    } : null };
  };
  service.handleProtocolMessage = async ({ method, params = {} } = {}) => {
    if (method !== "turn/started" && method !== "turn/completed") return;
    await ready;
    const route = routes[params.threadId];
    if (!route?.attemptSettings) return;
    if (method === "turn/started") {
      route.attemptSettings.turnId = params.turn?.id || params.turnId;
    } else if (params.turn?.id === route.attemptSettings.turnId) {
      if (params.turn.status === "completed" && !params.turn.error) {
        const { turnId, ...settings } = route.attemptSettings;
        route.lastSuccessfulSettings = settings;
      }
      delete route.attemptSettings;
      await save();
    }
  };
  const restored = new Set();
  const restoring = new Map();
  const activating = new Map();
  const ensureRestored = async (id) => {
    const route = routes[id];
    const key = `${owner(id)}:${id}`;
    if (!route?.resumeInfo || restored.has(key)) return;
    if (!restoring.has(key)) {
      const task = (async () => {
        const target = await storeFor(owner(id));
        const activeModel = route.activeModel || route.resumeInfo.model || route.runtimeModel || route.model;
        const resolved = providers.resolveRoute({ model: activeModel, modelProviderId: owner(id) });
        const info = providers.prepareResumeFile ? await providers.prepareResumeFile(owner(id), route.resumeInfo) : route.resumeInfo;
        await target.resumeProviderSession(id, { ...info, model: resolved.model || activeModel,
          modelProvider: owner(id) === 'current' ? undefined : owner(id), reasoningEffort: route.reasoningEffort });
        restored.add(key);
      })().finally(() => restoring.delete(key));
      restoring.set(key, task);
    }
    await restoring.get(key);
  };
  const activatePending = async (id) => {
    const route = routes[id];
    if (!route?.pendingProviderId) return;
    const source = await storeFor(owner(id));
    const target = await storeFor(route.pendingProviderId);
    const info = await source.getSessionResumeInfo(id);
    await source.releaseSession(id);
    restored.delete(`${owner(id)}:${id}`);
    const destinationInfo = providers.prepareResumeFile ? await providers.prepareResumeFile(route.pendingProviderId, info) : info;
    await target.resumeProviderSession(id, { ...destinationInfo, model: route.runtimeModel,
      modelProvider: route.pendingProviderId === 'current' ? undefined : route.pendingProviderId,
      reasoningEffort: route.reasoningEffort });
    routes[id] = { ...route, providerId: route.pendingProviderId, pendingProviderId: undefined, resumeInfo: destinationInfo, activeModel: route.runtimeModel };
    restored.add(`${owner(id)}:${id}`);
    await save();
  };
  for (const method of ["renameSession", "findSession", "sendMessage", "steerMessage", "interrupt",
    "updateReasoningEffort", "getRuntimeContext", "getThreadStatus",
    "compactContext", "reviewSession", "getGoal", "setGoal", "clearGoal", "getPendingUserInput",
    "respondToUserInput"]) {
    service[method] = async (id, ...args) => {
      await ready;
      if (switching.has(id)) await switching.get(id);
      await ensureRestored(id);
      if (method === 'sendMessage') {
        const source = await storeFor(owner(id));
        await rememberPreviousSettings(id, source);
        const runtime = await source.getRuntimeContext(id);
        const route = routes[id];
        route.attemptSettings = {
          model: route.model || runtime.model,
          reasoningEffort: route.reasoningEffort ?? runtime.reasoningEffort ?? "",
        };
        const resolved = providers.resolveRoute({ model: route.attemptSettings.model });
        args[3] = { ...route.attemptSettings, model: resolved.model || route.attemptSettings.model };
        await save();
      }
      if (method === 'sendMessage' && routes[id]?.pendingProviderId) {
        if (!activating.has(id)) {
          const task = activatePending(id).finally(() => activating.delete(id));
          activating.set(id, task);
        }
        await activating.get(id);
      }
      if (method === 'getRuntimeContext' && routes[id]?.pendingProviderId) return {
        model: routes[id].model, modelProvider: routes[id].pendingProviderId, reasoningEffort: routes[id].reasoningEffort || '',
        lastSuccessfulSettings: routes[id].lastSuccessfulSettings,
      };
      if (method === 'updateReasoningEffort' && routes[id]?.pendingProviderId) {
        routes[id].reasoningEffort = args[0];
        await save();
        return { model: routes[id].model, modelProvider: routes[id].pendingProviderId, reasoningEffort: args[0] };
      }
      const source = await storeFor(owner(id));
      if (method === "updateReasoningEffort" || method === "getRuntimeContext") {
        await rememberPreviousSettings(id, source);
      }
      const result = await source[method](id, ...args);
      if (method === "sendMessage" && routes[id]?.attemptSettings && result?.turn?.id) {
        routes[id].attemptSettings.turnId = result.turn.id;
      }
      if (method === "updateReasoningEffort") {
        routes[id].reasoningEffort = args[0];
        await save();
      }
      if (method === "getRuntimeContext" && result) result.lastSuccessfulSettings = routes[id]?.lastSuccessfulSettings;
      if (method === "getRuntimeContext" && result && routes[id]?.model) {
        result.model = routes[id].model;
        result.reasoningEffort = routes[id].reasoningEffort ?? result.reasoningEffort;
      }
      if (method === "getRuntimeContext" && result?.model && !routes[id]?.model) {
        routes[id] = { ...routes[id], providerId: owner(id), model: result.model };
        await save();
      }
      return result?.threadId ? decorate(result) : result;
    };
  }
  const missingPersistedThread = (error) => /thread not loaded|session not found|no rollout found|rollout path missing/i.test(String(error?.message || ""));
  for (const [method, archived] of [["archiveSession", true], ["unarchiveSession", false]]) {
    service[method] = async (id) => {
      await ready;
      if (switching.has(id)) await switching.get(id);
      await ensureRestored(id);
      try {
        const result = await (await storeFor(owner(id)))[method](id);
        if (routes[id]?.summary) {
          routes[id].summary.archived = archived;
          if (routes[id].resumeInfo) routes[id].resumeInfo = await (await storeFor(owner(id))).getSessionResumeInfo(id);
          await save();
        }
        return result?.threadId ? decorate(result) : result;
      } catch (error) {
        if (!missingPersistedThread(error) || !routes[id]?.summary) throw error;
        routes[id].summary.archived = archived;
        await save();
        return decorate(routes[id].summary);
      }
    };
  }
  service.listSessions = async (...args) => {
    await ready;
    const ids = [...new Set(["current", ...Object.values(routes).map((route) => route.providerId)])];
    const lists = await Promise.all(ids.map(async (providerId) => {
      const sessions = await (await storeFor(providerId)).listSessions(...args);
      return sessions.filter((session) => owner(session.threadId) === providerId && (providerId === 'current' || routes[session.threadId]))
        .map(decorate);
    }));
    const result = lists.flat();
    const known = new Set(result.map((session) => session.threadId));
    for (const route of Object.values(routes)) {
      const session = route.summary;
      if (session && !known.has(session.threadId) && Boolean(session.archived) === Boolean(args[1])
        && (!args[0] || args[0] === "all" || session.source === args[0])) result.push(decorate(session));
    }
    await Promise.all(result.map(async (session) => {
      const file = routes[session.threadId]?.resumeInfo?.path;
      if (!file) return;
      const assistantAt = await latestAssistantReplyAtFromRollout(file);
      if (assistantAt && Date.parse(assistantAt) > Date.parse(session.updatedAt || "")) session.updatedAt = assistantAt;
    }));
    return result.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  };
  service.listModels = async () => providers.listModels(await current.listModels());
  service.createSession = async (model = "", cwd = "", modelProviderId = "") => {
    await ready;
    await providers.refreshShared?.().catch((error) => { if (model.includes('::')) throw error; });
    const route = providers.resolveRoute({ model, modelProviderId });
    const session = await (await storeFor(route.modelProviderId)).createSession(route.model || model, cwd);
    routes[session.threadId] = { providerId: route.modelProviderId, model, summary: session, lastSuccessfulSettings: null };
    await save();
    return decorate(session);
  };
  service.forkSession = async (id, ...args) => {
    await ready;
    const result = await (await storeFor(owner(id))).forkSession(id, ...args);
    routes[result.threadId] = { providerId: owner(id), model: routes[id]?.model || "" };
    await save();
    return decorate(result);
  };
  const switching = new Map();
  service.updateModel = async (id, model, { allowProviderSwitch = false, reasoningEffort = "" } = {}) => {
    await ready;
    if (switching.has(id) || activating.has(id)) throw Object.assign(new Error("正在切换模型，请稍候"), { statusCode: 409 });
    const task = (async () => {
      await providers.refreshShared?.().catch((error) => { if (model.includes('::')) throw error; });
      const target = providers.resolveRoute({ model });
      if (reasoningEffort && !["none", "minimal", "low", "medium", "high", "xhigh"].includes(reasoningEffort)) throw new Error("无效的思考等级");
      const sourceProviderId = owner(id);
      const source = await storeFor(sourceProviderId);
      await rememberPreviousSettings(id, source);
      if (target.modelProviderId === sourceProviderId) {
        await ensureRestored(id);
        const result = await source.updateModel(id, target.model || model);
        routes[id] = { ...routes[id], providerId: owner(id), pendingProviderId: undefined, model, runtimeModel: target.model || model, activeModel: target.model || model };
        await save();
        return { ...result, model };
      }
      if (!await providers.isProviderConfigured(target.modelProviderId)) throw new Error('配置 Key 尚未配置');
      if (source.isFreshSession?.(id)) {
        const targetStore = await storeFor(target.modelProviderId);
        const created = await targetStore.createSession(target.model || model, routes[id]?.summary?.cwd || "");
        await source.releaseSession?.(id);
        delete routes[id];
        routes[created.threadId] = { providerId: target.modelProviderId, model, summary: created, lastSuccessfulSettings: null };
        await save();
        return { threadId: created.threadId, model, modelProvider: target.modelProviderId, reasoningEffort };
      }
      await ensureRestored(id);
      const info = await source.getSessionResumeInfo(id);
      routes[id] = { ...routes[id], providerId: owner(id), pendingProviderId: target.modelProviderId,
        activeModel: routes[id]?.activeModel || info.model || routes[id]?.runtimeModel || routes[id]?.model,
        model, runtimeModel: target.model || model, reasoningEffort, summary: info.summary || routes[id]?.summary };
      await save();
      return { threadId: id, model, modelProvider: target.modelProviderId, reasoningEffort };
    })();
    switching.set(id, task);
    try { return await task; } finally { switching.delete(id); }
  };
  service.close = () => { for (const store of stores.values()) void store.then((value) => value.close()).catch(() => {}); };
  return service;
};
