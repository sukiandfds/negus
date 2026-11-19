import { readProviderModels } from "./provider-model-catalog.mjs";
import { withVerifiedReasoning } from './model-capabilities.mjs';
import { readCurrentApiConfiguration } from "./current-api-configuration.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from 'node:os';
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from 'node:crypto';
import { createAppServerClient } from "./app-server-client.mjs";
import { createCcSwitchConfigService } from "./cc-switch-config-service.mjs";
import { readRolloutHead } from "./rollout-file.mjs";

export const CURRENT_MODEL_PROVIDER_ID = "current";
export const GROK_MODEL_PROVIDER_ID = "fusheng-grok";
export const GROK_MODEL_ID = "grok-4.6";
const SHARED_CONFIG_CACHE_MS = 15_000;

const providerIdPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const sharedProviderIdPattern = /^ccswitch_[\p{L}\p{N}_-]+$/u;
const validProviderId = (id) => id.length <= 80 && (providerIdPattern.test(id) || sharedProviderIdPattern.test(id));
const helperScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "model-provider-credential.ps1",
);

const statusError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const clean = (value, maxLength = 400) => String(value || "").trim().slice(0, maxLength);
const tomlString = (value) => JSON.stringify(String(value));
const tomlStringArray = (values) => `[${values.map(tomlString).join(", ")}]`;

const normalizeProvider = (value) => {
  const id = String(value?.id || "");
  if (!validProviderId(id)) throw new Error(`Invalid model provider id: ${id || "empty"}`);
  const mode = value?.mode === "current" ? "current" : "isolated";
  const models = (Array.isArray(value?.models) ? value.models : []).map((entry) => ({
    id: clean(entry?.id || entry?.model, 120),
    model: clean(entry?.model || entry?.id, 120),
    displayName: clean(entry?.displayName || entry?.model || entry?.id, 160),
    description: clean(entry?.description, 500),
    isDefault: Boolean(entry?.isDefault),
    supportedReasoningEfforts: Array.isArray(entry?.supportedReasoningEfforts)
      ? entry.supportedReasoningEfforts
      : [],
    experimental: Boolean(entry?.experimental),
  })).filter((entry) => entry.model);
  return {
    id,
    mode,
    displayName: clean(value?.displayName, 160) || id,
    baseUrl: clean(value?.baseUrl, 500),
    wireApi: clean(value?.wireApi, 40) || "responses",
    defaultModel: clean(value?.defaultModel, 120) || models[0]?.model || "",
    models,
  };
};

export const defaultModelProviders = () => [
  normalizeProvider({
    id: CURRENT_MODEL_PROVIDER_ID,
    mode: "current",
    displayName: "当前运行配置",
  }),
  normalizeProvider({
    id: GROK_MODEL_PROVIDER_ID,
    displayName: "Fusheng Grok",
    baseUrl: "https://fushengyunsuan.cn/v1",
    wireApi: "responses",
    defaultModel: GROK_MODEL_ID,
    models: [{
      id: GROK_MODEL_ID,
      model: GROK_MODEL_ID,
      displayName: "Grok 4.6 (Test)",
      description: "Grok 4.6 through the configured Fusheng provider.",
      experimental: true,
    }, {
      id: "grok-4.5",
      model: "grok-4.5",
      displayName: "Grok 4.5",
      description: "Fusheng Grok",
      experimental: true,
    }],
  }),
];

const requireProviderId = (providerId) => {
  const id = String(providerId || "");
  if (!validProviderId(id)) throw statusError("Invalid model provider id.", 400);
  return id;
};

export const protectCredentialWithDpapi = (secret, {
  credentialHelper = helperScript,
  powershell = "powershell.exe",
  spawn = spawnSync,
} = {}) => {
  const token = String(secret || "").trim();
  if (!token) throw statusError("Model provider credential cannot be empty.", 400);
  const result = spawn(powershell, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", path.resolve(credentialHelper),
    "-Mode", "protect",
  ], {
    input: token,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw statusError("Windows could not encrypt the model provider credential.", 500);
  }
  const encrypted = String(result.stdout || "").trim();
  if (!encrypted || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encrypted)) {
    throw statusError("Windows returned an invalid encrypted credential.", 500);
  }
  return encrypted;
};

export const createModelProviderCredentialStore = ({
  root,
  credentialHelper = helperScript,
  protect = (secret) => protectCredentialWithDpapi(secret, { credentialHelper }),
} = {}) => {
  if (!root) throw new Error("Model provider credential root is required.");
  const credentialRoot = path.resolve(root);
  const credentialPath = (providerId) => path.join(credentialRoot, `${requireProviderId(providerId)}.dpapi`);

  const isConfigured = async (providerId) => {
    try {
      const stat = await fs.stat(credentialPath(providerId));
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  };

  const save = async (providerId, secret) => {
    const file = credentialPath(providerId);
    const encrypted = await protect(secret);
    await fs.mkdir(credentialRoot, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, `${encrypted}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return { providerId: requireProviderId(providerId), file };
  };

  const read = async (providerId) => {
    try {
      const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", credentialHelper, "-Mode", "read", "-CredentialFile", credentialPath(providerId)],
      { windowsHide: true, timeout: 5000, maxBuffer: 16384 });
      return stdout.trim();
    } catch { throw statusError("无法读取配置凭据", 503); }
  };
  return { credentialPath, isConfigured, save, read };
};

export const renderModelProviderConfig = ({
  provider,
  credentialFile,
  credentialHelper = helperScript,
  workingDirectory,
  credentialCommand,
}) => {
  const normalized = normalizeProvider(provider);
  if (normalized.mode !== "isolated" || !normalized.baseUrl || !normalized.defaultModel) {
    throw new Error(`Provider ${normalized.id} does not have an isolated runtime configuration.`);
  }
  const cwd = path.resolve(workingDirectory);
  const providerKey = /^[A-Za-z0-9_-]+$/u.test(normalized.id) ? normalized.id : tomlString(normalized.id);
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", path.resolve(credentialHelper),
    "-Mode", "read",
    "-CredentialFile", path.resolve(credentialFile),
  ];
  return [
    `model_provider = ${tomlString(normalized.id)}`,
    `model = ${tomlString(normalized.defaultModel)}`,
    "",
    `[model_providers.${providerKey}]`,
    `name = ${tomlString(normalized.displayName)}`,
    `base_url = ${tomlString(normalized.baseUrl)}`,
    `wire_api = ${tomlString(normalized.wireApi)}`,
    "stream_max_retries = 2",
    "",
    `[model_providers.${providerKey}.auth]`,
    `command = ${tomlString(credentialCommand?.command || "powershell.exe")}`,
    `args = ${tomlStringArray(credentialCommand?.args || args)}`,
    "timeout_ms = 5000",
    "refresh_interval_ms = 300000",
    `cwd = ${tomlString(cwd)}`,
    "",
  ].join("\n");
};

const ensureCodexHome = async ({ runtimeRoot, provider, credentialStore, credentialHelper, projectRoot, sharedConfig }) => {
  const codexHome = path.join(path.resolve(runtimeRoot), provider.id, "codex-home");
  const configFile = path.join(codexHome, "config.toml");
  const config = renderModelProviderConfig({
    provider,
    credentialFile: provider.id.startsWith('ccswitch_') ? '' : credentialStore.credentialPath(provider.id),
    credentialHelper,
    workingDirectory: projectRoot,
    credentialCommand: provider.id.startsWith('ccswitch_') ? sharedConfig.credentialCommand(provider.id) : undefined,
  });
  let current = "";
  try { current = await fs.readFile(configFile, "utf8"); } catch {}
  if (current !== config) {
    await fs.mkdir(codexHome, { recursive: true });
    const temporary = `${configFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, config, "utf8");
    await fs.rename(temporary, configFile);
  }
  return codexHome;
};

export const createModelProviderService = ({
  projectRoot,
  defaultClient,
  defaultCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  providers = defaultModelProviders(),
  runtimeRoot = path.join(projectRoot, "runtime", "model-providers"),
  credentialRoot = path.join(projectRoot, "runtime", "model-provider-credentials"),
  credentialHelper = helperScript,
  credentialStore = createModelProviderCredentialStore({ root: credentialRoot, credentialHelper }),
  createClient = createAppServerClient,
  sharedConfig = createCcSwitchConfigService(),
  fetchModels = globalThis.fetch,
  fetchResponse = globalThis.fetch,
  currentApiConfiguration = readCurrentApiConfiguration,
} = {}) => {
  if (!projectRoot) throw new Error("Project root is required for model provider routing.");
  const providerMap = new Map(providers.map(normalizeProvider).map((provider) => [provider.id, provider]));
  const currentProvider = providerMap.get(CURRENT_MODEL_PROVIDER_ID);
  if (!currentProvider || currentProvider.mode !== "current") {
    throw new Error(`Provider ${CURRENT_MODEL_PROVIDER_ID} must use the current runtime.`);
  }
  const nativeConfiguration = Promise.resolve().then(currentApiConfiguration).catch(() => null);
  const clientPromises = new Map();
  const removing = new Set();
  const activeUses = new Map();
  const assertAvailable = id => {
    if (removing.has(id) || !providerMap.has(id)) throw statusError("配置正在删除或已不存在", 409);
  };
  const withProviderUse = async (id, run) => {
    assertAvailable(id);
    activeUses.set(id, (activeUses.get(id) || 0) + 1);
    try { return await run(); }
    finally {
      const remaining = activeUses.get(id) - 1;
      if (remaining) activeUses.set(id, remaining);
      else activeUses.delete(id);
    }
  };
  const usesDefaultHome = id => Boolean(defaultClient) &&
    path.resolve(runtimeRoot, id, 'codex-home') === path.resolve(defaultCodexHome);
  const isInUse = id => activeUses.has(id) || clientPromises.has(id)
    || id.startsWith('ccswitch_') && (catalogId("current") === id || usesDefaultHome(id));
  const ownedClients = new Map();
  let refreshing = null;
  let sharedConfigRefreshedAt = 0;
  let sharedDeletionRevision = 0;
  const fingerprints = new Map();
  const catalogFile = path.join(runtimeRoot, 'model-catalog.json');
  let catalogs = {};
  const catalogReady = fs.readFile(catalogFile, 'utf8').then((text) => { catalogs = JSON.parse(text); }).catch(() => {});
  const catalogId = (id) => id === "current" && currentProvider.sharedConfigId
    ? `ccswitch_${currentProvider.sharedConfigId}` : id;
  const applyCatalog = (provider) => {
    const cached = catalogs?.[catalogId(provider.id)];
    if (cached?.baseUrl !== provider.baseUrl || !Array.isArray(cached.models)) return;
    const previous = new Map(provider.models.map((model) => [model.model, model]));
    // A completed supplier read is authoritative: keep local capability
    // metadata for surviving models, but never append removed presets.
    provider.models = cached.models.map((model) => ({ ...previous.get(model.model), ...model }));
    if (provider.mode === "current") provider.activeModels = provider.models.map((model) => model.model);
  };
  const refreshShared = ({ force = false } = {}) => {
    if (!force && sharedConfigRefreshedAt && Date.now() - sharedConfigRefreshedAt < SHARED_CONFIG_CACHE_MS) return Promise.resolve();
    if (!refreshing) refreshing = (async () => {
      await catalogReady;
      const revision = sharedDeletionRevision;
      const entries = await sharedConfig.runtimeProviders({ force });
      const native = await nativeConfiguration;
      if (revision !== sharedDeletionRevision) return;
      if (native) {
        const match = entries.find(entry => entry.baseUrl.replace(/\/$/u, "") === native.baseUrl && entry.key === native.key);
        currentProvider.sharedConfigId = match?.id?.replace(/^ccswitch_/u, '') || '';
        currentProvider.displayName = match?.displayName || native.name || "当前运行配置";
        currentProvider.baseUrl = native.baseUrl;
        // The active shared configuration is authoritative. The native Codex
        // file can retain a model from a previously selected channel.
        currentProvider.activeModel = match?.defaultModel || "";
        currentProvider.activeModels = match?.models?.map(model => model.model).filter(Boolean) || [];
        applyCatalog(currentProvider);
      }
      for (const entry of entries) {
        // Running clients retain their configuration until the service is safely restarted.
        if (removing.has(entry.id) || clientPromises.has(entry.id)) continue;
        const fingerprint = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
        if (fingerprints.get(entry.id) === fingerprint) continue;
        // Shared providers read the authoritative DB through command auth; no DPAPI copy.
        providerMap.set(entry.id, normalizeProvider(entry));
        fingerprints.set(entry.id, fingerprint);
      }
      const known = new Set(entries.map((entry) => entry.id));
      for (const id of providerMap.keys()) {
        if (id.startsWith('ccswitch_') && !known.has(id) && !clientPromises.has(id)) { providerMap.delete(id); fingerprints.delete(id); }
      }
      for (const provider of providerMap.values()) applyCatalog(provider);
      sharedConfigRefreshedAt = Date.now();
    })().finally(() => { refreshing = null; });
    return refreshing;
  };

  const catalogRequests = new Map();
  let catalogWrite = Promise.resolve();
  const refreshProviderModels = async (providerId) => {
    const requestedId = requireProviderId(providerId);
    if (requestedId === "current" || requestedId.startsWith("ccswitch_")) {
      await refreshShared({ force: true }).catch(error => { if (requestedId !== "current") throw error; });
    } else await catalogReady;
    const id = catalogId(requestedId);
    if (catalogRequests.has(id)) return catalogRequests.get(id);
    const request = withProviderUse(id, async () => {
      const provider = providerMap.get(id);
      if (!provider) throw statusError("配置不存在，请刷新配置列表", 404);
      const native = requestedId === "current" ? await nativeConfiguration : null;
      if (requestedId === "current" && !native) return { count: null };
      if (native && id === "current") provider.baseUrl = native.baseUrl;
      const baseUrl = provider.baseUrl;
      const sourceFor = async () => {
        if (id.startsWith("ccswitch_") && sharedConfig.readCatalogConfig) return sharedConfig.readCatalogConfig(id);
        if (native) return native;
        const key = id.startsWith("ccswitch_") ? await sharedConfig.readCredential(id) : await credentialStore.read(id);
        return { key, baseUrl };
      };
      const { key: credential, baseUrl: configuredUrl, version } = await sourceFor();
      if (configuredUrl?.replace(/\/$/, "") !== baseUrl.replace(/\/$/, "") || (native && native.key !== credential)) {
        throw statusError("配置已变更，请重新刷新", 409);
      }
      let modelIds;
      try {
        const url = new URL(`${baseUrl.replace(/\/$/, "")}/models`);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("地址必须使用 HTTPS");
        const response = await fetchModels(url, { headers: { Authorization: `Bearer ${credential}` }, redirect: "error", signal: AbortSignal.timeout(10000) });
        modelIds = await readProviderModels(response);
      } catch (error) {
        throw error.statusCode ? error : statusError(error.name === "TimeoutError"
          ? "配置模型目录读取超时，请重试" : "配置模型目录读取失败，请检查地址和网络", 502);
      }
      const ids = modelIds.filter(model => id !== GROK_MODEL_PROVIDER_ID || /^grok-/i.test(model));
      const models = ids.map(model => provider.models.find(entry => entry.model === model) || {
        id: model, model, displayName: model, description: provider.displayName, isDefault: false,
        supportedReasoningEfforts: [], experimental: false,
      });
      const write = catalogWrite.catch(() => {}).then(async () => {
        const latest = await sourceFor();
        if (providerMap.get(id)?.baseUrl !== baseUrl || latest.key !== credential || latest.version !== version) {
          throw statusError("配置在刷新期间已变更，请重新刷新", 409);
        }
        const next = { ...catalogs, [id]: { baseUrl, models } };
        if (id === catalogId("current") && id !== "current") delete next.current;
        await fs.mkdir(runtimeRoot, { recursive: true });
        const temporary = `${catalogFile}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(next), "utf8");
        await fs.rename(temporary, catalogFile);
        catalogs = next;
        applyCatalog(providerMap.get(id));
        if (id === catalogId("current")) applyCatalog(currentProvider);
      });
      catalogWrite = write;
      await write;
      return { count: ids.length, version };
    });
    catalogRequests.set(id, request);
    try { return await request; }
    finally { catalogRequests.delete(id); }
  };

  const modelOwner = (model) => {
    const modelId = clean(model, 120);
    return [...providerMap.values()].find((provider) => (
      provider.mode === "isolated" && !provider.id.startsWith('ccswitch_') && provider.models.some((entry) => entry.model === modelId)
    )) || currentProvider;
  };

  const resolveRoute = ({ model = "", modelProviderId = "", allowRetired = false } = {}) => {
    const parts = String(model).split('::');
    const requestedModel = clean(parts.length === 2 ? parts[1] : model, 120);
    const requestedProviderId = modelProviderId ? requireProviderId(modelProviderId) : parts.length === 2 ? requireProviderId(parts[0]) : "";
    const requestedProvider = requestedProviderId ? providerMap.get(requestedProviderId) : null;
    if (requestedProviderId && !requestedProvider) throw statusError("Model provider is not registered.", 400);
    const inferred = modelOwner(requestedModel);
    const provider = requestedProvider || inferred;
    if (!provider) throw statusError("Model provider is not registered.", 400);
    const currentCatalog = catalogs[catalogId(provider.id)];
    const activeCatalog = currentCatalog?.baseUrl === provider.baseUrl ? currentCatalog : null;
    if (!allowRetired && requestedModel && activeCatalog?.baseUrl === provider.baseUrl && !provider.models.some(entry => entry.model === requestedModel)) {
      throw statusError(`模型 ${requestedModel} 已不在此配置目录，请换一个模型`, 400);
    }
    const activeModel = !activeCatalog && provider.mode === "current" && provider.activeModel
      && (!requestedModel || !provider.activeModels.length || !provider.activeModels.includes(requestedModel))
      ? provider.activeModel : "";
    const modelId = activeModel || requestedModel || (provider.models.some(entry => entry.model === provider.defaultModel) ? provider.defaultModel : provider.models[0]?.model) || "";
    if (!allowRetired && provider.mode !== 'current' && modelId && !provider.models.some((entry) => entry.model === modelId)) {
      throw statusError(`Model ${modelId || "(default)"} does not belong to provider ${provider.id}.`, 400);
    }
    return { modelProviderId: provider.id, model: modelId, provider };
  };

  const isProviderConfigured = async (providerId) => {
    const provider = providerMap.get(requireProviderId(providerId));
    if (!provider) return false;
    if (provider.mode === "current") return true;
    if (provider.id.startsWith('ccswitch_')) {
      try { await sharedConfig.readCredential(provider.id); return true; } catch { return false; }
    }
    return credentialStore.isConfigured(provider.id);
  };

  const listModels = async (currentModels = []) => {
    await refreshShared().catch(() => {});
    const native = await nativeConfiguration;
    await catalogReady;
    if (native) { currentProvider.baseUrl = native.baseUrl; applyCatalog(currentProvider); }
    const nativeModels = Array.isArray(currentModels) ? currentModels : [];
    const currentCatalog = catalogs[catalogId(CURRENT_MODEL_PROVIDER_ID)]?.baseUrl === native?.baseUrl
      ? catalogs[catalogId(CURRENT_MODEL_PROVIDER_ID)]?.models : null;
    const nativeByModel = new Map(nativeModels.map(entry => [entry.model, entry]));
    const visibleCurrent = currentCatalog
      ? currentCatalog.map(entry => ({ ...entry, ...(nativeByModel.get(entry.model) || {}) }))
      : nativeModels;
    const current = visibleCurrent.filter((model) => !model.modelProviderId || model.modelProviderId === CURRENT_MODEL_PROVIDER_ID).map((model) => ({
      ...withVerifiedReasoning(model),
      ...(modelOwner(model.model).id !== CURRENT_MODEL_PROVIDER_ID
        ? { id: `current::${model.model}`, model: `current::${model.model}` } : {}),
      modelProviderId: CURRENT_MODEL_PROVIDER_ID,
      providerDisplayName: currentProvider.displayName,
      available: true,
      experimental: Boolean(model?.experimental),
    }));
    const external = [];
    for (const provider of providerMap.values()) {
      if (provider.mode === "current") continue;
      const available = await isProviderConfigured(provider.id);
      external.push(...provider.models.map((storedModel) => {
        const nativeEfforts = provider.id === `ccswitch_${currentProvider.sharedConfigId}` || /^gpt-/u.test(storedModel.model)
          ? nativeByModel.get(storedModel.model)?.supportedReasoningEfforts : null;
        const model = withVerifiedReasoning({ ...storedModel,
          supportedReasoningEfforts: storedModel.supportedReasoningEfforts?.length ? storedModel.supportedReasoningEfforts : nativeEfforts || [],
        });
        return {
          ...model,
        ...(provider.id.startsWith('ccswitch_') ? { id: `${provider.id}::${model.model}`, model: `${provider.id}::${model.model}`, displayName: `${provider.displayName} · ${model.model}` } : {}),
        modelProviderId: provider.id,
        providerDisplayName: provider.displayName,
        available,
        };
      }));
    }
    return [...current, ...external];
  };

  const getClient = async (routeInput = {}) => {
    if (String(routeInput.modelProviderId || routeInput.model).startsWith('ccswitch_')) await refreshShared();
    const route = resolveRoute({ ...routeInput, allowRetired: true });
    if (route.provider.mode === "current") {
      if (!defaultClient) throw statusError("Current Codex provider is unavailable.", 503);
      return defaultClient;
    }
    return withProviderUse(route.provider.id, async () => {
      if (!await isProviderConfigured(route.provider.id)) {
        throw statusError(`${route.provider.displayName} credential is not configured.`, 503);
      }
      // An inherited CODEX_HOME can make current an alias of an isolated provider.
      // Reuse its writer instead of starting two app-servers against the same home.
      if (usesDefaultHome(route.provider.id)) {
        return defaultClient;
      }
      if (!clientPromises.has(route.provider.id)) {
        const promise = ensureCodexHome({
          runtimeRoot,
          provider: route.provider.defaultModel ? route.provider : { ...route.provider, defaultModel: route.model || route.provider.models[0]?.model },
          credentialStore,
          credentialHelper,
          projectRoot,
          sharedConfig,
        }).then((codexHome) => {
          const client = createClient({
            codexHome,
            label: route.provider.id,
            sanitizeEnvironment: true,
            workingDirectory: path.resolve(projectRoot),
          });
          ownedClients.set(route.provider.id, client);
          return client;
        }).catch((error) => {
          clientPromises.delete(route.provider.id);
          throw error;
        });
        clientPromises.set(route.provider.id, promise);
      }
      return clientPromises.get(route.provider.id);
    });
  };

  const complete = async (routeInput = {}, {
    instructions = '', input = '', maxOutputTokens = 320, textFormat = null, timeoutMs = 30000,
  } = {}) => {
    if (String(routeInput.modelProviderId || routeInput.model).startsWith('ccswitch_')) await refreshShared();
    const route = resolveRoute(routeInput);
    return withProviderUse(route.provider.id, async () => {
      const provider = route.provider;
      const source = provider.id === CURRENT_MODEL_PROVIDER_ID ? await nativeConfiguration
        : provider.id.startsWith('ccswitch_') && sharedConfig.readCatalogConfig ? await sharedConfig.readCatalogConfig(provider.id)
        : { baseUrl: provider.baseUrl, key: provider.id.startsWith('ccswitch_')
          ? await sharedConfig.readCredential(provider.id) : await credentialStore.read(provider.id) };
      const baseUrl = String(source?.baseUrl || '').replace(/\/$/u, '');
      const credential = source?.key;
      if (!baseUrl || !credential) throw statusError('选定渠道缺少可用的 Responses API 配置', 503);
      const response = await fetchResponse(`${baseUrl}/responses`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: route.model,
          instructions,
          input,
          reasoning: routeInput.reasoningEffort ? { effort: routeInput.reasoningEffort } : undefined,
          max_output_tokens: maxOutputTokens,
          ...(textFormat ? { text: { format: textFormat } } : {}),
          store: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw statusError(payload?.error?.message || `选定渠道返回 HTTP ${response.status}`, 502);
      const text = (payload.output || [])
        .flatMap(item => item?.content || [])
        .map(item => item?.text || '')
        .filter(Boolean)
        .join('\n')
        .trim();
      if (!text) throw statusError('选定渠道没有返回文本', 502);
      return { text, modelProviderId: provider.id, model: route.model,
        reasoningEffort: routeInput.reasoningEffort || '' };
    });
  };

  const close = () => {
    for (const client of ownedClients.values()) client.close?.();
    ownedClients.clear();
    clientPromises.clear();
  };
  const prepareResumeFile = async (providerId, info, ancestors = new Set(), { threadId = "" } = {}) => {
    const home = providerId === CURRENT_MODEL_PROVIDER_ID
      ? process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
      : path.join(path.resolve(runtimeRoot), providerId, 'codex-home');
    const basename = path.basename(info.path);
    const date = /^rollout-(\d{4})-(\d{2})-(\d{2})T/u.exec(basename);
    if (!date || !path.isAbsolute(info.path)) throw new Error('原会话记录位置无效');
    const targetBasename = threadId
      ? basename.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu, threadId)
      : basename;
    const destination = path.join(home, 'sessions', date[1], date[2], date[3], targetBasename);
    const generated = [];
    const temporaryFiles = [];
    try {
      if (path.resolve(destination).toLowerCase() !== path.resolve(info.path).toLowerCase()) {
        if (ancestors.has(info.path)) throw new Error('对话来源记录存在循环，未切换配置');
        ancestors.add(info.path);
        const header = JSON.parse(await readRolloutHead(info.path));
        const parentId = header.type === 'session_meta' ? header.payload?.forked_from_id : null;
        if (parentId) {
          if (!/^[a-f0-9-]{36}$/i.test(parentId)) throw new Error('对话来源编号无效，未切换配置');
          let parent;
          for (const pattern of [`**/rollout-*-${parentId}.jsonl`, `**/rollout-*-${parentId}*.jsonl.zst`]) {
            if (parent) break;
            for await (const file of fs.glob(pattern, { cwd: path.resolve(path.dirname(info.path), '../../..') })) {
              parent = path.resolve(path.dirname(info.path), '../../..', file); break;
            }
          }
          if (!parent) throw new Error('找不到分支来源对话记录，未切换配置');
          const parentInfo = await prepareResumeFile(providerId, { ...info, path: parent }, ancestors);
          generated.push(...(parentInfo.generatedPaths || []));
        }
        const existed = await fs.access(destination).then(() => true).catch(() => false);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        // Preserve the complete native rollout and its thread ID, not a text summary/new conversation.
        const temporary = `${destination}.resume-${process.pid}`;
        temporaryFiles.push(temporary);
        await fs.copyFile(info.path, temporary);
        await fs.rename(temporary, destination);
        temporaryFiles.pop();
        if (!existed) generated.push(destination);
      }
      return { ...info, path: destination, ...(generated.length ? { generatedPaths: [...new Set(generated)] } : {}) };
    } catch (error) {
      await Promise.all(temporaryFiles.map(file => fs.rm(file, { force: true }).catch(() => {})));
      await Promise.all(generated.map(file => fs.rm(file, { force: true }).catch(() => {})));
      throw error;
    }
  };

  return {
    catalogId,
    removeSharedProvider: async (providerId, remove, { requireEmpty = false } = {}) => {
      if (removing.has(providerId) || isInUse(providerId)) {
        throw statusError("配置仍在使用或正在删除", 409);
      }
      if (requireEmpty && (catalogs[providerId]?.baseUrl !== providerMap.get(providerId)?.baseUrl
        || catalogs[providerId]?.models?.length !== 0)) {
        throw statusError("目录已变更，请重新刷新", 409);
      }
      removing.add(providerId);
      try {
        const result = await remove();
        sharedDeletionRevision++;
        sharedConfigRefreshedAt = 0;
        providerMap.delete(providerId);
        fingerprints.delete(providerId);
        return result;
      } finally { removing.delete(providerId); }
    },
    isInUse,
    currentConfiguration: () => nativeConfiguration,
    providers: () => [...providerMap.values()].map((provider) => ({ ...provider })),
    resolveRoute,
    listModels,
    isProviderConfigured,
    getClient,
    complete,
    credentials: credentialStore,
    sharedConfig,
    refreshShared,
    refreshProviderModels,
    prepareResumeFile,
    close,
  };
};
