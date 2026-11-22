import { transferConversationThread } from "./conversation-provider-handoff.mjs";
import { readPersistedThreadGoal, expandGoalObjective } from './thread-goal-objective.mjs';
import { backgroundTaskRoute } from './background-tasks/model-policy.mjs';
import { isReasoningEffort } from './reasoning-efforts.mjs';
import { latestAssistantReplyAtFromRollout } from "./app-server-conversation-store.mjs";
import { latestRolloutFile } from "./rollout-file.mjs";
import { removeTransferredThread, setTransferredProvider } from "./provider-transfer.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { conversationSourceRevision } from "./conversation-version-store.mjs";
import { readJsonFile, writeJsonFileAtomic } from "./persistence/json-file.mjs";

// Ordinary project conversations only. Employee runtimes keep their own bindings.
export const createProviderConversationStore = ({ current, providers, createStore, historyFor, stateFile, providerForThread = () => null }) => {
  const stores = new Map([["current", Promise.resolve(current)]]);
  const readyStores = new Map([["current", current]]);
  let routes = {};
  let writing = Promise.resolve();
  const save = () => {
    writing = writing.catch(() => {}).then(async () => {
      await writeJsonFileAtomic(stateFile, routes, { space: 0, trailingNewline: false });
    });
    return writing;
  };
  const routesLoaded = readJsonFile(stateFile, {}).then((stored) => {
    routes = stored && typeof stored === "object" ? stored : {};
  });
  let preparation;
  const ready = () => preparation ||= routesLoaded.then(async () => {
    await providers.refreshShared?.().catch(() => {});
    let changed = false;
    for (const [id, route] of Object.entries(routes)) {
      const copied = (Boolean(route?.crossProviderCopyFrom) && route.crossProviderCopyFrom === route?.summary?.forkedFromId)
        || (route?.summary?.forkedFromId && route?.resumeInfo?.summary?.threadId
          && route.resumeInfo.summary.threadId !== id);
      if (!copied || !route.model) continue;
      const [providerId, targetModel] = route.model.includes('::')
        ? route.model.split('::') : ['current', route.model];
      let resolved;
      try {
        resolved = providers.resolveRoute({ model: route.model, modelProviderId: providerId, allowRetired: true });
      } catch {
        continue;
      }
      if (resolved.modelProviderId !== route.providerId || resolved.model !== targetModel) continue;
      const reasoningEffort = route.reasoningEffort ?? route.resumeInfo?.reasoningEffort ?? "";
      const stale = route.runtimeModel !== targetModel || route.activeModel !== targetModel
        || route.resumeInfo?.model !== targetModel || route.resumeInfo?.reasoningEffort !== reasoningEffort;
      if (!stale) continue;
      routes[id] = {
        ...route, runtimeModel: targetModel, activeModel: targetModel, reasoningEffort,
        resumeInfo: route.resumeInfo ? {
          ...route.resumeInfo, model: targetModel, reasoningEffort,
          summary: { ...route.resumeInfo.summary, threadId: id, model: targetModel },
        } : route.resumeInfo,
      };
      changed = true;
    }
    if (changed) await save();
  });
  const storeFor = (providerId) => {
    if (!stores.has(providerId)) {
      const pending = providers.getClient({ modelProviderId: providerId }).then(async (client) =>
        client === await providers.getClient({ modelProviderId: 'current' }) ? current : createStore(client, providerId));
      stores.set(providerId, pending);
      void pending.then(store => readyStores.set(providerId, store), () => {});
      void pending.catch(() => stores.delete(providerId));
    }
    return stores.get(providerId);
  };
  const childOwners = new Map();
  const owner = (id) => routes[id]?.providerId || providerForThread(id) || childOwners.get(id) || "current";
  const providerConfigured = async (providerId) => providerId === 'current' || !providers.isProviderConfigured
    || await providers.isProviderConfigured(providerId).catch(() => false);
  const providerName = async providerId => {
    const configured = providers.providers?.().find(provider => provider.id === providerId)?.displayName;
    if (!stateFile || providerId === 'current' || path.basename(providerId) !== providerId) return configured || providerId;
    let file;
    try {
      file = await fs.open(path.join(path.dirname(stateFile), 'model-providers', providerId, 'codex-home', 'config.toml'));
      // The generated runtime keeps the display name before its auth command. Never execute that command.
      let section = false;
      for await (const line of file.readLines()) {
        if (line.startsWith('[model_providers.')) {
          section = line === `[model_providers.${providerId}]` || line === `[model_providers.${JSON.stringify(providerId)}]`;
          if (!section && line.endsWith('.auth]')) break;
        }
        if (section && line.startsWith('name = ')) return JSON.parse(line.slice(7));
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await file?.close().catch(() => {}); }
    return configured || providerId;
  };
  const decorate = (session) => session && ({ ...session,
    ...(session.messages && routes[session.threadId]?.switchNotices ? { messages: session.messages.map(message => {
      const notice = message.role === "user" && (routes[session.threadId].switchNotices[message.submissionId] || routes[session.threadId].switchNotices[message.protocolTurnId || message.turnId]);
      return notice ? { ...message, modelSwitch: notice } : message;
    }) } : {}),
    createdBy: routes[session.threadId]?.createdBy || session.createdBy,
    ...(routes[session.threadId]?.manualTitle ? { title: routes[session.threadId].manualTitle } : {}),
    model: routes[session.threadId]?.model || session.model || "",
    modelProviderId: routes[session.threadId]?.pendingProviderId || owner(session.threadId),
    reasoningEffort: routes[session.threadId]?.reasoningEffort || session.reasoningEffort || "",
  });
  const storedRouteInfo = async (id, providerId) => {
    const route = routes[id];
    if (route?.resumeInfo?.path && route.resumeInfo.cwd) {
      return { ...route.resumeInfo, path: await latestRolloutFile(route.resumeInfo.path) };
    }
    const cwd = route?.summary?.cwd;
    if (!stateFile || !cwd || providerId === 'current' || path.basename(providerId) !== providerId) return null;
    const root = path.join(path.dirname(stateFile), 'model-providers', providerId, 'codex-home');
    const candidates = [];
    for (const name of ['sessions', 'archived_sessions']) {
      let entries;
      try {
        entries = await fs.readdir(path.join(root, name), { recursive: true, withFileTypes: true });
      } catch {}
      for (const entry of entries || []) {
        if (!entry.isFile() || !/\.jsonl(?:\.zst)?$/u.test(entry.name)
          || !entry.name.includes(id)) continue;
        const file = path.join(entry.parentPath || entry.path, entry.name);
        try {
          const stat = await fs.stat(file);
          candidates.push({ file, modifiedAt: stat.mtimeMs });
        } catch {}
      }
    }
    const file = candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.file;
    if (!file) return null;
    return { path: file, cwd, model: route.activeModel || route.runtimeModel || route.summary.model || route.model || "",
      reasoningEffort: route.reasoningEffort || "", manualTitle: route.manualTitle || "", summary: route.summary };
  };
  const service = {};
  service.getRecordedProviderForThread = async id => { await routesLoaded; return routes[id]?.providerId || null; };
  service.getVerifiedProviderForThread = async id => {
    await ready();
    if (routes[id]?.providerId) return routes[id].providerId;
    const info = await current.getSessionResumeInfo(id, { readOnly: true }).catch(() => null);
    return info?.path && info?.cwd ? 'current' : null;
  };
  service.getSessionResumeInfo = async (id, options = { readOnly: true }) => {
    await ready();
    return (await storeFor(owner(id))).getSessionResumeInfo(id, { ...options, historyFile: routes[id]?.resumeInfo?.path });
  };
  service.findSessionForProvider = async (providerId, ...args) => (await storeFor(providerId)).findSession(...args);
  service.getRuntimeContextForProvider = async (providerId, id) => {
    await ready();
    return (await storeFor(providerId)).getRuntimeContext(id, { historyFile: routes[id]?.resumeInfo?.path });
  };
  service.getSourceRevisionForProvider = async (providerId, id) => {
    await routesLoaded;
    const info = await (await historyFor(providerId)).getSessionResumeInfo(id, { readOnly: true, historyFile: routes[id]?.resumeInfo?.path });
    if (info?.sourceRevision) return info.sourceRevision;
    return info?.path ? latestRolloutFile(info.path)
      .then(source => fs.stat(source))
      .then(conversationSourceRevision)
      .catch(() => null) : null;
  };
  service.getSourceRevision = async id => { await routesLoaded; return service.getSourceRevisionForProvider(owner(id), id); };
  service.listSessionsForProvider = async (providerId, ...args) => (await historyFor(providerId || "current")).listSessions(...args);
  const rememberPreviousSettings = async id => {
    if (Object.hasOwn(routes[id] || {}, "lastSuccessfulSettings")) return;
    const previous = await readSuccessfulSettings(id, await historyInfo(id));
    routes[id] = { ...routes[id], providerId: owner(id), lastSuccessfulSettings: previous };
  };
  service.handleProtocolMessage = async ({ method, params = {} } = {}) => {
    if (method !== "turn/started" && method !== "turn/completed") return;
    await ready();
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
    if (route.pendingProviderId && !await providerConfigured(owner(id))) return;
    if (!restoring.has(key)) {
      const task = (async () => {
        const target = await storeFor(owner(id));
        const activeModel = route.runtimeModel || route.activeModel || route.model || route.resumeInfo.model;
        const resolved = providers.resolveRoute({ model: activeModel, modelProviderId: owner(id), allowRetired: true });
        const info = providers.prepareResumeFile ? await providers.prepareResumeFile(owner(id), route.resumeInfo) : route.resumeInfo;
        await target.resumeProviderSession(id, { ...info, model: resolved.model || activeModel,
          modelProvider: owner(id) === 'current' ? undefined : owner(id), reasoningEffort: route.reasoningEffort });
        restored.add(key);
      })().finally(() => restoring.delete(key));
      restoring.set(key, task);
    }
    await restoring.get(key);
  };
  const continueOnProvider = async (id, route, submissionId = "") => {
    const previous = owner(id);
    const source = await providerConfigured(previous) ? await storeFor(previous) : null;
    const target = await storeFor(route.pendingProviderId);
    const info = source ? await source.getSessionResumeInfo(id) : await storedRouteInfo(id, previous);
    if (!info?.path) throw Object.assign(new Error("找不到原对话记录，未切换配置"), { statusCode: 409 });
    if (source && source !== target) await source.releaseSession(id);
    restored.delete(`${previous}:${id}`);
    const destination = source === target ? info : await transferConversationThread({ providers, threadId: id,
      target: submissionId ? await providers.getClient({ modelProviderId: route.pendingProviderId }) : null,
      sourceInfo: { ...info, path: await latestRolloutFile(info.path) },
      route: { modelProviderId: route.pendingProviderId, model: route.runtimeModel }, reasoningEffort: route.reasoningEffort,
      resume: (id, options) => target.resumeProviderSession(id, options) });
    const before = routes[id];
    routes[id] = { ...route, providerId: route.pendingProviderId, pendingProviderId: undefined,
      resumeInfo: destination, activeModel: route.runtimeModel,
      ...(submissionId ? { switchNotices: { ...route.switchNotices, [submissionId]: route.model } } : {}) };
    try { await save(); } catch (error) { routes[id] = before; throw error; }
    restored.add(`${owner(id)}:${id}`);
  };
  const activatePending = id => continueOnProvider(id, routes[id]);
  for (const method of ["renameSession", "sendMessage", "steerMessage", "interrupt",
    "updateReasoningEffort", "getThreadStatus",
    "revertSession", "compactContext", "reviewSession", "setGoal", "clearGoal",
    "respondToUserInput"]) {
    service[method] = async (id, ...args) => {
      await ready();
      if (method === 'sendMessage') {
        await providers.refreshShared?.();
        const route = routes[id];
        const selected = providers.resolveRoute({ model: route?.model || '', modelProviderId: route?.pendingProviderId || owner(id) });
        if (!await providerConfigured(selected.modelProviderId)) throw Object.assign(new Error("所选配置缺少有效凭据，请在配置中更新后重试"), { statusCode: 503 });
      }
      if (switching.has(id)) await switching.get(id);
      if (method !== "getThreadStatus") await ensureRestored(id);
      if (method === 'sendMessage') {
        if (routes[id]?.pendingProviderId && !await providerConfigured(owner(id))) {
          if (!activating.has(id)) {
            const task = activatePending(id).finally(() => activating.delete(id));
            activating.set(id, task);
          }
          await activating.get(id);
        }
        const source = await storeFor(owner(id));
        await rememberPreviousSettings(id);
        const runtime = await source.getRuntimeContext(id);
        const route = routes[id];
        route.attemptSettings = {
          model: route.model || runtime.model,
          reasoningEffort: route.reasoningEffort ?? runtime.reasoningEffort ?? "",
          providerName: providers.providers?.().find(provider => provider.id === (route.pendingProviderId || owner(id)))?.displayName || route.lastSuccessfulSettings?.providerName || owner(id),
          modelProviderId: route.pendingProviderId || owner(id),
        };
        const resolved = providers.resolveRoute({ model: route.attemptSettings.model, allowRetired: true,
          modelProviderId: route.pendingProviderId || owner(id) });
        const effectiveModel = resolved.model || route.attemptSettings.model;
        args[3] = { model: effectiveModel, reasoningEffort: route.attemptSettings.reasoningEffort };
        if (effectiveModel !== route.attemptSettings.model && resolved.modelProviderId === owner(id)) {
          route.runtimeModel = effectiveModel;
          route.activeModel = effectiveModel;
        }
        await save();
      }
      if ((method === 'sendMessage' || (method === 'setGoal' && (args[0]?.objective !== undefined || args[0]?.status === 'active'))) && routes[id]?.pendingProviderId) {
        if (!activating.has(id)) {
          const task = activatePending(id).finally(() => activating.delete(id));
          activating.set(id, task);
        }
        await activating.get(id);
      }
      if (method === 'updateReasoningEffort' && routes[id]?.pendingProviderId) {
        routes[id].reasoningEffort = args[0];
        await save();
        return { model: routes[id].model, modelProvider: routes[id].pendingProviderId, reasoningEffort: args[0] };
      }
      const source = await storeFor(owner(id));
      if (method === "updateReasoningEffort") await rememberPreviousSettings(id);
      const result = await source[method](id, ...args);
      if (method === "renameSession") {
        routes[id] = { ...routes[id], providerId: owner(id), manualTitle: args[0], summary: { ...routes[id]?.summary, ...result, threadId: id, title: args[0] } };
        await save();
      }
      if (method === "sendMessage" && routes[id]?.attemptSettings && result?.turn?.id) {
        routes[id].attemptSettings.turnId = result.turn.id;
        const notices = routes[id].switchNotices;
        if (notices?.[args[2]]) { notices[result.turn.id] = notices[args[2]]; await save(); }
      }
      if (method === "updateReasoningEffort") {
        routes[id].reasoningEffort = args[0];
        await save();
      }
      return result?.threadId ? decorate(result) : result;
    };
  }
  // FEAT-001: history owns reads; obtaining a sender belongs only to explicit actions.
  const historyInfo = async (id) => {
    await routesLoaded;
    return (await historyFor(owner(id))).getSessionResumeInfo(id, { readOnly: true, historyFile: routes[id]?.resumeInfo?.path });
  };
  service.findSession = async (id, source, options = {}) => {
    await routesLoaded;
    return decorate(await (await historyFor(owner(id))).findSession(id, source, { ...options, ...(routes[id]?.resumeInfo?.path ? { historyFile: routes[id].resumeInfo.path } : {}) }));
  };
  const readSuccessfulSettings = async (id, info) => {
    const route = routes[id];
    let previous = route?.lastSuccessfulSettings;
    if (!Object.hasOwn(route || {}, 'lastSuccessfulSettings')) {
      previous = await latestAssistantReplyAtFromRollout(info?.paths || (info?.path ? [info.path] : []), true);
    }
    const successfulProvider = previous?.modelProviderId || (previous?.model?.includes('::') ? previous.model.split('::')[0] : owner(id));
    return previous ? { ...previous, modelProviderId: successfulProvider,
      model: successfulProvider === "current" ? previous.model : previous.model?.includes('::') ? previous.model : `${successfulProvider}::${previous.model}`,
      providerName: previous.providerName || await providerName(successfulProvider) } : null;
  };
  service.getRuntimeContext = async id => {
    const info = await historyInfo(id);
    const runtime = info?.path ? await latestAssistantReplyAtFromRollout(info.path, 'latest') : {};
    const route = routes[id];
    const successful = await readSuccessfulSettings(id, info);
    const qualify = model => model && !model.includes('::') && owner(id) !== 'current' ? `${owner(id)}::${model}` : model || '';
    return { ...runtime, model: route?.model || qualify(runtime.model),
      reasoningEffort: route?.reasoningEffort ?? runtime.reasoningEffort ?? '', lastSuccessfulSettings: successful };
  };
  service.getGoal = async id => {
    const info = await historyInfo(id);
    if (!info?.path) return { goal: null };
    const home = info.path.split(/[/\\](?:sessions|archived_sessions)[/\\]/)[0];
    const root = path.join(home, 'attachments');
    const result = await readPersistedThreadGoal(id, root);
    return { ...result, goal: await expandGoalObjective(result.goal, root) };
  };
  service.getPendingUserInput = async id => {
    await historyInfo(id);
    return readyStores.get(owner(id))?.getPendingUserInput?.(id) || null;
  };
  const missingPersistedThread = (error) => /thread not loaded|session not found|no rollout found|rollout path missing/i.test(String(error?.message || ""));
  for (const [method, archived] of [["archiveSession", true], ["unarchiveSession", false]]) {
    service[method] = async (id) => {
      await ready();
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
    await routesLoaded;
    childOwners.clear();
    const ids = [...new Set(["current", ...Object.values(routes).map((route) => route.providerId)])];
    const childConflicts = new Set();
    const parentOwners = new Map();
    const parentOwnerFor = async id => {
      if (!id) return null;
      if (parentOwners.has(id)) return parentOwners.get(id);
      let providerId = routes[id]?.providerId || await providerForThread(id);
      if (!providerId) {
        const info = await (await historyFor("current")).getSessionResumeInfo?.(id, { readOnly: true }).catch(() => null);
        if (info?.path && info?.cwd) providerId = 'current';
      }
      parentOwners.set(id, providerId || null);
      return providerId || null;
    };
    const lists = [];
    for (const providerId of ids) {
      let live, native;
      try {
        const store = await historyFor(providerId);
        native = await store.listNativeSubagents?.(args[1]).catch(() => []) || [];
        live = await store.listSessions(...args);
      } catch (error) {
        console.warn(`[conversation-list] Using saved summaries for ${providerId}: ${error.message}`);
        continue;
      }
      const nativeById = new Map(native.map(session => [session.threadId, session]));
      const listed = live.map(session => {
        const indexed = nativeById.get(session.threadId);
        return indexed ? {
          ...session,
          nativeSubagent: indexed.nativeSubagent === true,
          parentThreadId: indexed.parentThreadId || session.parentThreadId || null,
        } : session;
      });
      const knownIds = new Set(listed.map(session => session.threadId));
      const sessions = [...listed, ...native.filter(session => !knownIds.has(session.threadId))];
      for (const session of sessions) if (session.nativeSubagent && !routes[session.threadId]) {
        const parentOwner = await parentOwnerFor(session.parentThreadId);
        const matchesParent = parentOwner === providerId || (parentOwner === 'current' && providerId !== 'current')
          || (!parentOwner && providerId === 'current');
        if (!matchesParent) continue;
        if (childOwners.has(session.threadId) && childOwners.get(session.threadId) !== providerId) childConflicts.add(session.threadId);
        else childOwners.set(session.threadId, providerId);
      }
      lists.push({ providerId, sessions });
    }
    for (const id of childConflicts) childOwners.delete(id);
    const visible = lists.map(({ providerId, sessions }) => sessions.filter((session) => owner(session.threadId) === providerId
      && (routes[session.threadId] || (session.nativeSubagent ? !childConflicts.has(session.threadId) && childOwners.get(session.threadId) === providerId : providerId === 'current')))
      .map(decorate));
    const result = visible.flat();
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
  // FEAT-001: new chats and forks share registration; native start/fork stay distinct.
  const registerSession = service.registerSession = async (session, providerId, model, metadata = {}, expectedRoute) => {
    await ready();
    if (expectedRoute !== undefined && JSON.stringify(routes[session.threadId] || null) !== expectedRoute)
      throw Object.assign(Error('对话登记已变化，未覆盖'), { statusCode: 409 });
    routes[session.threadId] = { providerId, model, createdBy: 'user', summary: session, ...metadata };
    await save();
    return decorate(session);
  };
  // Repair a known assistant-created thread in the live store, never by rewriting its state file externally.
  service.registerExistingBackground = async ({ threadId, providerId, expectedProviderId = null }) => {
    await ready();
    const previous = routes[threadId];
    const before = JSON.stringify(previous || null);
    if (!threadId || !providerId || (previous?.providerId || null) !== expectedProviderId
      || (previous?.providerId && !['current', providerId].includes(previous.providerId)) || previous?.pendingProviderId)
      throw Object.assign(Error('对话供应商已变化，未修改登记'), { statusCode: 409 });
    const info = await (await storeFor(providerId)).getSessionResumeInfo(threadId, { readOnly: true });
    if (!info?.path || !info.cwd || info.summary?.threadId !== threadId || info.summary?.nativeSubagent)
      throw Object.assign(Error('无法核实已有独立对话'), { statusCode: 409 });
    const settings = await latestAssistantReplyAtFromRollout(info.path, 'latest');
    const model = settings?.model || info.model;
    if (!model) throw Object.assign(Error('对话设置不可核实'), { statusCode: 409 });
    return registerSession(info.summary, providerId, providerId === 'current' || model.includes('::') ? model : `${providerId}::${model}`,
      { ...previous, providerId, model: providerId === 'current' || model.includes('::') ? model : `${providerId}::${model}`,
        summary: info.summary, resumeInfo: info, createdBy: 'assistant', reasoningEffort: settings?.reasoningEffort ?? info.reasoningEffort ?? previous?.reasoningEffort ?? '' }, before);
  };
  service.createSession = async (model = "", cwd = "", modelProviderId = "", options = {}) => {
    await ready();
    await providers.refreshShared?.().catch((error) => { if (model.includes('::')) throw error; });
    const hasExplicitRoute = Boolean(String(model ?? '').trim() || String(modelProviderId ?? '').trim());
    const route = !hasExplicitRoute
      ? await backgroundTaskRoute(providers)
      : providers.resolveRoute({ model, modelProviderId });
    const effectiveModel = route.model || model;
    const sessionOptions = route.reasoningEffort && !options.reasoningEffort
      ? { ...options, reasoningEffort: route.reasoningEffort } : options;
    const session = await (await storeFor(route.modelProviderId)).createSession(effectiveModel, cwd, sessionOptions);
    return registerSession(session, route.modelProviderId,
      route.modelProviderId === 'current' ? effectiveModel : `${route.modelProviderId}::${effectiveModel}`,
      { createdBy: options.createdBy === 'assistant' ? 'assistant' : 'user', lastSuccessfulSettings: null,
        ...(sessionOptions.reasoningEffort ? { reasoningEffort: sessionOptions.reasoningEffort } : {}) });
  };
  service.forkSession = async (id, ...args) => {
    await ready();
    const providerId = owner(id);
    const result = await (await storeFor(providerId)).forkSession(id, ...args);
    // A pending provider selection belongs to the parent, not the native fork.
    const model = result.model || routes[id]?.activeModel
      || (routes[id]?.pendingProviderId ? routes[id]?.resumeInfo?.model : routes[id]?.model) || '';
    return registerSession({ ...result, forkedFromId: id }, providerId,
      providerId !== 'current' && model && !model.includes('::') ? `${providerId}::${model}` : model);
  };
  service.createFromProvider = async (id, model, { reasoningEffort = "" } = {}) => {
    await ready();
    if (!isReasoningEffort(reasoningEffort)) throw new Error("无效的思考等级");
    const target = providers.resolveRoute({ model });
    if (!await providerConfigured(target.modelProviderId)) throw new Error('配置 Key 尚未配置');
    const sourceProviderId = owner(id);
    let info = null;
    if (await providerConfigured(sourceProviderId)) {
      const source = await storeFor(sourceProviderId);
      info = await source.getSessionResumeInfo(id, { readOnly: true, historyFile: routes[id]?.resumeInfo?.path }).catch(() => null);
      if (info?.path) info = { ...info, path: await latestRolloutFile(info.path) };
    }
    info ||= await storedRouteInfo(id, sourceProviderId);
    if (!info?.path) throw Object.assign(new Error("找不到原对话记录，未创建新对话"), { statusCode: 409 });
    const threadId = randomUUID();
    const sourceTitle = routes[id]?.manualTitle || info.summary?.title || routes[id]?.summary?.title || "对话";
    const title = `${sourceTitle} · ${target.provider?.displayName || target.modelProviderId}`;
    let targetStore = null;
    let destination = null;
    try {
      targetStore = await storeFor(target.modelProviderId);
      destination = providers.prepareResumeFile
        ? await providers.prepareResumeFile(target.modelProviderId, info, new Set(), { threadId })
        : info;
      const effectiveModel = target.model || model;
      await setTransferredProvider(destination.path, info.path, id, target.modelProviderId, threadId, {
        model: effectiveModel, reasoningEffort,
      });
      await targetStore.resumeProviderSession(threadId, {
        ...destination, cwd: info.cwd, model: effectiveModel,
        modelProvider: target.modelProviderId === 'current' ? undefined : target.modelProviderId,
        reasoningEffort,
      });
      const applied = await targetStore.updateModel(threadId, effectiveModel, { reasoningEffort });
      if (reasoningEffort && applied?.reasoningEffort !== reasoningEffort) await targetStore.updateReasoningEffort(threadId, reasoningEffort);
      const registeredModel = target.modelProviderId === 'current' ? effectiveModel : `${target.modelProviderId}::${effectiveModel}`;
      const session = await registerSession({
        ...info.summary, threadId, title, cwd: info.cwd, source: "codex", archived: false,
        updatedAt: new Date().toISOString(), model: effectiveModel, forkedFromId: id,
      }, target.modelProviderId, registeredModel,
      { createdBy: "user", manualTitle: title, reasoningEffort,
        lastSuccessfulSettings: (await service.getRuntimeContext(id)).lastSuccessfulSettings, activeModel: effectiveModel, runtimeModel: effectiveModel,
        crossProviderCopyFrom: id,
        resumeInfo: { ...destination, model: effectiveModel, reasoningEffort } });
      return { session, sourceThreadId: id, model: session.model || registeredModel, modelProvider: target.modelProviderId, reasoningEffort };
    } catch (error) {
      await targetStore?.releaseSession?.(threadId).catch(() => {});
      if (destination?.path && path.resolve(destination.path) !== path.resolve(info.path)) {
        await removeTransferredThread(destination.path, threadId).catch(() => {});
        const generated = destination.generatedPaths?.length ? destination.generatedPaths : [destination.path];
        await Promise.all(generated.map(file => fs.rm(file, { force: true }).catch(() => {})));
      }
      if (routes[threadId]) {
        delete routes[threadId];
        await save().catch(() => {});
      }
      throw error;
    }
  };
  const switching = new Map();
  service.updateModel = async (id, model, { allowProviderSwitch = false, reasoningEffort = "", allowRetired = false, continueSubmission = "" } = {}) => {
    await ready();
    if (switching.has(id) || activating.has(id)) throw Object.assign(new Error("正在切换模型，请稍候"), { statusCode: 409 });
    const task = (async () => {
      await providers.refreshShared?.().catch((error) => { if (model.includes('::')) throw error; });
      let target = providers.resolveRoute({ model, allowRetired });
      const sourceProviderId = owner(id);
      if (providers.catalogId && providers.catalogId(sourceProviderId) === providers.catalogId(target.modelProviderId)) {
        target = providers.resolveRoute({ model: target.model, modelProviderId: sourceProviderId, allowRetired });
        model = sourceProviderId === "current" ? target.model : `${sourceProviderId}::${target.model}`;
      }
      if (!isReasoningEffort(reasoningEffort)) throw new Error("无效的思考等级");
      if (!await providerConfigured(target.modelProviderId)) throw Object.assign(new Error("所选配置缺少有效凭据，请在配置中更新后重试"), { statusCode: 503 });
      const sourceConfigured = await providerConfigured(sourceProviderId);
      if (!sourceConfigured && target.modelProviderId === sourceProviderId) {
        throw Object.assign(new Error("当前对话配置已移除，请选择其他配置的模型"), { statusCode: 409 });
      }
      const source = sourceConfigured ? await storeFor(sourceProviderId) : null;
      await rememberPreviousSettings(id);
      if (target.modelProviderId === sourceProviderId) {
        await ensureRestored(id);
        const result = await source.updateModel(id, target.model || model, { reasoningEffort });
        routes[id] = { ...routes[id], providerId: owner(id), pendingProviderId: undefined, model, runtimeModel: target.model || model, activeModel: target.model || model, ...(reasoningEffort ? { reasoningEffort } : {}) };
        if (continueSubmission) routes[id].switchNotices = { ...routes[id].switchNotices, [continueSubmission]: model };
        await save();
        return { ...result, model, ...(continueSubmission ? { switched: true, modelProvider: sourceProviderId } : {}) };
      }
      if (continueSubmission || !sourceConfigured) {
        await continueOnProvider(id, { ...routes[id], pendingProviderId: target.modelProviderId, model,
          runtimeModel: target.model || model, reasoningEffort }, continueSubmission);
        return { threadId: id, model, modelProvider: target.modelProviderId, reasoningEffort, switched: true };
      }
      if (source.isFreshSession?.(id)) {
        const targetStore = await storeFor(target.modelProviderId);
        const created = await targetStore.createSession(target.model || model, routes[id]?.summary?.cwd || "");
        await source.releaseSession?.(id);
        const { manualTitle, createdBy } = routes[id] || {};
        if (manualTitle) await targetStore.renameSession(created.threadId, manualTitle);
        delete routes[id];
        routes[created.threadId] = { manualTitle, createdBy, providerId: target.modelProviderId, model, summary: created, lastSuccessfulSettings: null };
        await save();
        return { threadId: created.threadId, model, modelProvider: target.modelProviderId, reasoningEffort };
      }
      await ensureRestored(id);
      const info = await source.getSessionResumeInfo(id);
      routes[id] = { ...routes[id], providerId: owner(id), pendingProviderId: target.modelProviderId,
        activeModel: routes[id]?.activeModel || info.model || routes[id]?.runtimeModel || routes[id]?.model,
        model, runtimeModel: target.model || model, reasoningEffort, manualTitle: routes[id]?.manualTitle || info.manualTitle || "", summary: info.summary || routes[id]?.summary };
      await save();
      return { threadId: id, model, modelProvider: target.modelProviderId, reasoningEffort };
    })();
    switching.set(id, task);
    try { return await task; } finally { switching.delete(id); }
  };
  service.close = () => { for (const store of stores.values()) void store.then((value) => value.close()).catch(() => {}); };
  return service;
};
