import fs from "node:fs/promises";
import path from "node:path";
import os from 'node:os';
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from 'node:crypto';
import { createAppServerClient } from "./app-server-client.mjs";
import { createCcSwitchConfigService } from "./cc-switch-config-service.mjs";

export const CURRENT_MODEL_PROVIDER_ID = "current";
export const GROK_MODEL_PROVIDER_ID = "fusheng-grok";
export const GROK_MODEL_ID = "grok-4.6";
const SHARED_CONFIG_CACHE_MS = 15_000;

const providerIdPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
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
  const id = clean(value?.id, 80);
  if (!providerIdPattern.test(id)) throw new Error(`Invalid model provider id: ${id || "empty"}`);
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
    displayName: "当前运行渠道",
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
      supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
      experimental: true,
    }, {
      id: "grok-4.5",
      model: "grok-4.5",
      displayName: "Grok 4.5",
      description: "Fusheng Grok",
      supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
      experimental: true,
    }],
  }),
];

const requireProviderId = (providerId) => {
  const id = clean(providerId, 80);
  if (!providerIdPattern.test(id)) throw statusError("Invalid model provider id.", 400);
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
    } catch { throw statusError("无法读取渠道凭据", 503); }
  };
  return { credentialPath, isConfigured, save, read };
};

export const renderModelProviderConfig = ({
  provider,
  credentialFile,
  credentialHelper = helperScript,
  workingDirectory,
}) => {
  const normalized = normalizeProvider(provider);
  if (normalized.mode !== "isolated" || !normalized.baseUrl || !normalized.defaultModel) {
    throw new Error(`Provider ${normalized.id} does not have an isolated runtime configuration.`);
  }
  const cwd = path.resolve(workingDirectory);
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
    `[model_providers.${normalized.id}]`,
    `name = ${tomlString(normalized.displayName)}`,
    `base_url = ${tomlString(normalized.baseUrl)}`,
    `wire_api = ${tomlString(normalized.wireApi)}`,
    "",
    `[model_providers.${normalized.id}.auth]`,
    `command = ${tomlString("powershell.exe")}`,
    `args = ${tomlStringArray(args)}`,
    "timeout_ms = 5000",
    "refresh_interval_ms = 300000",
    `cwd = ${tomlString(cwd)}`,
    "",
  ].join("\n");
};

const ensureCodexHome = async ({ runtimeRoot, provider, credentialStore, credentialHelper, projectRoot }) => {
  const codexHome = path.join(path.resolve(runtimeRoot), provider.id, "codex-home");
  const configFile = path.join(codexHome, "config.toml");
  const config = renderModelProviderConfig({
    provider,
    credentialFile: credentialStore.credentialPath(provider.id),
    credentialHelper,
    workingDirectory: projectRoot,
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
  providers = defaultModelProviders(),
  runtimeRoot = path.join(projectRoot, "runtime", "model-providers"),
  credentialRoot = path.join(projectRoot, "runtime", "model-provider-credentials"),
  credentialHelper = helperScript,
  credentialStore = createModelProviderCredentialStore({ root: credentialRoot, credentialHelper }),
  createClient = createAppServerClient,
  sharedConfig = createCcSwitchConfigService(),
  fetchModels = globalThis.fetch,
} = {}) => {
  if (!projectRoot) throw new Error("Project root is required for model provider routing.");
  const providerMap = new Map(providers.map(normalizeProvider).map((provider) => [provider.id, provider]));
  const currentProvider = providerMap.get(CURRENT_MODEL_PROVIDER_ID);
  if (!currentProvider || currentProvider.mode !== "current") {
    throw new Error(`Provider ${CURRENT_MODEL_PROVIDER_ID} must use the current runtime.`);
  }
  const clientPromises = new Map();
  const ownedClients = new Map();
  let refreshing = null;
  let sharedConfigRefreshedAt = 0;
  const fingerprints = new Map();
  const catalogFile = path.join(runtimeRoot, 'model-catalog.json');
  let catalogs = {};
  const catalogReady = fs.readFile(catalogFile, 'utf8').then((text) => { catalogs = JSON.parse(text); }).catch(() => {});
  const applyCatalog = (provider) => {
    const cached = catalogs?.[provider.id];
    if (cached?.baseUrl !== provider.baseUrl || !Array.isArray(cached.models)) return;
    provider.models = [...new Map([...provider.models, ...cached.models].map((model) => [model.model, model])).values()];
  };
  const refreshShared = ({ force = false } = {}) => {
    if (!force && sharedConfigRefreshedAt && Date.now() - sharedConfigRefreshedAt < SHARED_CONFIG_CACHE_MS) return Promise.resolve();
    if (!refreshing) refreshing = (async () => {
      await catalogReady;
      const entries = await sharedConfig.runtimeProviders({ force });
      const currentDisplayName = await sharedConfig.currentDisplayName?.({ force });
      if (currentDisplayName) currentProvider.displayName = currentDisplayName;
      for (const entry of entries) {
        // Running clients retain their configuration until the service is safely restarted.
        if (clientPromises.has(entry.id)) continue;
        const fingerprint = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
        if (fingerprints.get(entry.id) === fingerprint) continue;
        await credentialStore.save(entry.id, entry.key);
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
  const refreshProviderModels = (providerId) => {
    const id = requireProviderId(providerId);
    if (catalogRequests.has(id)) return catalogRequests.get(id);
    const request = (async () => {
      await refreshShared({ force: true });
      const provider = providerMap.get(id);
      if (!provider || provider.mode === 'current') return;
      const credential = await credentialStore.read(id);
      let payload;
      try {
        const url = new URL(`${provider.baseUrl.replace(/\/$/, '')}/models`);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid URL');
        const response = await fetchModels(url, { headers: { Authorization: `Bearer ${credential}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('upstream failed');
        payload = await response.json();
        if (!Array.isArray(payload.data)) throw new Error('invalid models');
      } catch { throw statusError('渠道模型目录读取失败，请稍后重试', 502); }
      const ids = [...new Set(payload.data.map((entry) => entry?.id).filter((model) => typeof model === 'string'
        && model.length > 0 && model.length <= 120 && !model.includes('::')
        && (id !== GROK_MODEL_PROVIDER_ID || /^grok-/i.test(model))))];
      if (!ids.length) throw statusError('渠道未返回可用模型', 502);
      const models = ids.map((model) => provider.models.find((entry) => entry.model === model) || {
        id: model, model, displayName: model, description: provider.displayName, isDefault: false,
        supportedReasoningEfforts: [], experimental: false,
      });
      catalogs[id] = { baseUrl: provider.baseUrl, models };
      applyCatalog(provider);
      catalogWrite = catalogWrite.catch(() => {}).then(async () => {
        await fs.mkdir(runtimeRoot, { recursive: true });
        const temporary = `${catalogFile}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(catalogs), 'utf8');
        await fs.rename(temporary, catalogFile);
      });
      await catalogWrite;
    })();
    catalogRequests.set(id, request);
    void request.finally(() => catalogRequests.delete(id)).catch(() => {});
    return request;
  };

  const modelOwner = (model) => {
    const modelId = clean(model, 120);
    return [...providerMap.values()].find((provider) => (
      provider.mode === "isolated" && !provider.id.startsWith('ccswitch_') && provider.models.some((entry) => entry.model === modelId)
    )) || currentProvider;
  };

  const resolveRoute = ({ model = "", modelProviderId = "" } = {}) => {
    const parts = String(model).split('::');
    const requestedModel = clean(parts.length === 2 ? parts[1] : model, 120);
    const requestedProviderId = modelProviderId ? requireProviderId(modelProviderId) : parts.length === 2 ? requireProviderId(parts[0]) : "";
    const requestedProvider = requestedProviderId ? providerMap.get(requestedProviderId) : null;
    if (requestedProviderId && !requestedProvider) throw statusError("Model provider is not registered.", 400);
    const modelId = requestedModel || requestedProvider?.defaultModel || "";
    const inferred = modelOwner(modelId);
    const provider = requestedProvider || inferred;
    if (!provider) throw statusError("Model provider is not registered.", 400);
    if (provider.id.startsWith('ccswitch_') ? Boolean(modelId && !provider.models.some((entry) => entry.model === modelId)) : provider.id !== inferred.id) {
      throw statusError(`Model ${modelId || "(default)"} does not belong to provider ${provider.id}.`, 400);
    }
    return { modelProviderId: provider.id, model: modelId, provider };
  };

  const isProviderConfigured = async (providerId) => {
    const provider = providerMap.get(requireProviderId(providerId));
    if (!provider) return false;
    return provider.mode === "current" || credentialStore.isConfigured(provider.id);
  };

  const listModels = async (currentModels = []) => {
    await refreshShared().catch(() => {});
    const current = (Array.isArray(currentModels) ? currentModels : []).filter((model) => !model.modelProviderId || model.modelProviderId === CURRENT_MODEL_PROVIDER_ID).map((model) => ({
      ...model,
      modelProviderId: CURRENT_MODEL_PROVIDER_ID,
      providerDisplayName: currentProvider.displayName,
      available: true,
      experimental: Boolean(model?.experimental),
    }));
    const external = [];
    for (const provider of providerMap.values()) {
      if (provider.mode === "current") continue;
      const available = await credentialStore.isConfigured(provider.id);
      external.push(...provider.models.map((model) => ({
        ...model,
        ...(provider.id === GROK_MODEL_PROVIDER_ID && model.model === 'grok-4.7'
          ? { supportedReasoningEfforts: ['low', 'medium', 'high'].map((reasoningEffort) => ({ reasoningEffort, description: '' })) }
          : {}),
        ...(provider.id.startsWith('ccswitch_') ? { supportedReasoningEfforts: current.find((entry) => entry.model === model.model)?.supportedReasoningEfforts || model.supportedReasoningEfforts } : {}),
        ...(provider.id.startsWith('ccswitch_') ? { id: `${provider.id}::${model.model}`, model: `${provider.id}::${model.model}`, displayName: `${provider.displayName} · ${model.model}` } : {}),
        modelProviderId: provider.id,
        providerDisplayName: provider.displayName,
        available,
      })));
    }
    return [...current, ...external];
  };

  const getClient = async (routeInput = {}) => {
    if (String(routeInput.modelProviderId || routeInput.model).startsWith('ccswitch_')) await refreshShared();
    const route = resolveRoute(routeInput);
    if (route.provider.mode === "current") {
      if (!defaultClient) throw statusError("Current Codex provider is unavailable.", 503);
      return defaultClient;
    }
    if (!await credentialStore.isConfigured(route.provider.id)) {
      throw statusError(`${route.provider.displayName} credential is not configured.`, 503);
    }
    if (!clientPromises.has(route.provider.id)) {
      const promise = ensureCodexHome({
        runtimeRoot,
        provider: route.provider,
        credentialStore,
        credentialHelper,
        projectRoot,
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
  };

  const close = () => {
    for (const client of ownedClients.values()) client.close?.();
    ownedClients.clear();
    clientPromises.clear();
  };
  const prepareResumeFile = async (providerId, info) => {
    const home = providerId === CURRENT_MODEL_PROVIDER_ID
      ? process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
      : path.join(path.resolve(runtimeRoot), providerId, 'codex-home');
    const basename = path.basename(info.path);
    const date = /^rollout-(\d{4})-(\d{2})-(\d{2})T/u.exec(basename);
    if (!date || !path.isAbsolute(info.path)) throw new Error('原会话记录位置无效');
    const destination = path.join(home, 'sessions', date[1], date[2], date[3], basename);
    if (path.resolve(destination).toLowerCase() !== path.resolve(info.path).toLowerCase()) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // Preserve the complete native rollout and its thread ID, not a text summary/new conversation.
      const temporary = `${destination}.resume-${process.pid}`;
      await fs.copyFile(info.path, temporary);
      await fs.rename(temporary, destination);
    }
    return { ...info, path: destination };
  };

  return {
    providers: () => [...providerMap.values()].map((provider) => ({ ...provider })),
    resolveRoute,
    listModels,
    isProviderConfigured,
    getClient,
    credentials: credentialStore,
    sharedConfig,
    refreshShared,
    refreshProviderModels,
    prepareResumeFile,
    close,
  };
};
