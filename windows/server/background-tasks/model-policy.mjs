import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const installRoot = process.env.NEGUS_INSTALL_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const TASK_ROUTING_CONFIG_FILE = path.join(installRoot, 'runtime', 'model-routing.json');
const bundledRoutingConfig = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../model-routing.default.json');
const reasoningEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

const normalizeRoutingPolicy = value => {
  if (value?.version !== 1 || !Array.isArray(value?.channels) || !value.channels.length)
    throw new Error('任务模型路由配置格式错误');
  const channels = [];
  const names = new Set();
  for (const channel of value.channels) {
    const name = String(channel?.name || '').trim();
    if (!name || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    channels.push({ name });
  }
  const defaultModel = String(value.defaultModel || '').trim();
  const reasoningEffort = String(value.reasoningEffort || '').trim();
  if (!channels.length || !defaultModel || !reasoningEfforts.has(reasoningEffort))
    throw new Error('任务模型路由配置没有有效的默认模型或思考等级');
  return { version: 1, defaultModel, reasoningEffort, channels };
};

export const loadTaskRoutingPolicy = async ({ file = TASK_ROUTING_CONFIG_FILE } = {}) => {
  for (const candidate of [file, bundledRoutingConfig]) {
    try {
      return normalizeRoutingPolicy(JSON.parse(await fs.readFile(candidate, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT' && candidate === file) continue;
      if (error.code === 'ENOENT') throw new Error('任务模型路由配置缺失');
      if (error instanceof SyntaxError || /配置/.test(error.message))
        throw new Error(`任务模型路由配置无效：${error.message}`);
      throw error;
    }
  }
  throw new Error('任务模型路由配置缺失');
};

export const modelDefaultsFromRoute = route => ({
  providerId: route.modelProviderId,
  model: route.modelProviderId === 'current' || String(route.model).includes('::')
    ? route.model : `${route.modelProviderId}::${route.model}`,
  effort: route.reasoningEffort || '',
  archivedProviderIds: [],
});

const matchesChannel = (provider, channelName) => [provider?.id, provider?.displayName]
  .filter(Boolean).some(value => String(value).toLowerCase() === channelName.toLowerCase());

const requestedRouteRequest = (request, policy) => {
  let model = String(request?.model || '').trim();
  let modelProviderId = String(request?.modelProviderId || '').trim();
  if (model.includes('::')) {
    const [providerId, exactModel] = model.split('::');
    modelProviderId ||= providerId;
    model = exactModel;
  }
  const namedChannel = policy.channels.find(channel => channel.name.toLowerCase() === model.toLowerCase());
  let requestedChannel = false;
  if (namedChannel) {
    modelProviderId ||= namedChannel.name;
    model = '';
    requestedChannel = true;
  }
  return { requestedModel: model, preferredProviderId: modelProviderId, requestedChannel };
};

export const selectTaskRoute = async (providers, request = {}, {
  tasks: _tasks = [], policy = null, unavailableMessage = '',
} = {}) => {
  if (!providers?.providers || !providers?.isProviderConfigured || !providers?.resolveRoute)
    throw new Error(`${unavailableMessage}模型提供方服务未连接`);
  const routing = policy || await loadTaskRoutingPolicy();
  let refreshError = '';
  try {
    await providers.refreshShared?.();
  } catch (error) {
    refreshError = error?.message || String(error);
  }
  const catalog = providers.providers();
  const routeFailurePattern = /无可用渠道|distributor|\b(?:401|403|408|409|42[0-9]|5\d\d)\b|timeout|timed out|超时|rate.?limit|限流|network|fetch failed|ECONN|unauthori[sz]ed|authentication failed|auth(?:entication)? error|not authenticated|invalid (?:api key|token)|token expired|access token[^\n]*expired|鉴权失败|认证失败|未认证|身份(?:验证|认证)失败|令牌过期|令牌无效|凭据无效|凭证无效|无效(?:的)?\s*(?:token|令牌|凭证|凭据)|credential|凭证|model[^\n]*(?:not available|unavailable|not found|不支持|不可用)/iu;
  const latestTerminalRoutes = new Map();
  for (const task of _tasks || []) {
    if (!['completed', 'failed', 'interrupted'].includes(task?.state)) continue;
    const providerId = task.modelProviderId || task.runtime?.modelProviderId;
    const model = task.model || task.runtime?.model;
    if (!providerId || !model) continue;
    const key = `${providerId}::${model}`;
    const previous = latestTerminalRoutes.get(key);
    const taskTime = Date.parse(task.updatedAt || task.createdAt || '') || 0;
    const previousTime = Date.parse(previous?.updatedAt || previous?.createdAt || '') || 0;
    if (!previous || taskTime >= previousTime) latestTerminalRoutes.set(key, task);
  }
  const recentFailures = new Map([...latestTerminalRoutes]
    .filter(([, task]) => task.state !== 'completed' && routeFailurePattern.test(String(task.error || '')))
    .map(([key, task]) => [key, task.error]));
  const routeRequest = requestedRouteRequest(request, routing);
  const preferredProviderId = routeRequest.preferredProviderId;
  const configuredChannels = routing.channels.map(channel => channel.name);
  const rank = provider => {
    const preferredRank = !preferredProviderId ? 2
      : provider.id === preferredProviderId ? 0
        : matchesChannel(provider, preferredProviderId) ? 1 : 2;
    const channelIndex = configuredChannels.findIndex(name => matchesChannel(provider, name));
    const currentRank = channelIndex >= 0 && provider.id === 'current' ? 1 : 0;
    return `${preferredRank}:${channelIndex < 0 ? 1 : 0}:${channelIndex < 0 ? 999 : channelIndex}:${currentRank}:${provider.displayName || provider.id}`;
  };
  const orderedProviders = [...catalog].sort((left, right) => rank(left).localeCompare(rank(right)));
  const attempted = [];
  const preferredProvider = preferredProviderId
    ? orderedProviders.find(provider => matchesChannel(provider, preferredProviderId)) : null;
  let requestedModel = routeRequest.requestedModel;
  if ((routeRequest.requestedChannel || (!requestedModel && preferredProviderId)) && preferredProvider?.defaultModel) {
    requestedModel = String(preferredProvider.defaultModel).trim();
  }
  if (routeRequest.requestedChannel && !preferredProvider) {
    attempted.push({ providerId: preferredProviderId, displayName: preferredProviderId, model: '',
      reason: '配置渠道当前不可用' });
  } else if (routeRequest.requestedChannel && !requestedModel) {
    attempted.push({ providerId: preferredProvider.id, displayName: preferredProvider.displayName || preferredProvider.id,
      model: '', reason: '渠道没有默认模型' });
  }
  requestedModel ||= routing.defaultModel;
  const modelOrder = [];
  const addModel = model => {
    const value = String(model || '').trim();
    if (value && !modelOrder.includes(value)) modelOrder.push(value);
  };
  addModel(requestedModel);
  for (const provider of orderedProviders) {
    addModel(provider.defaultModel);
    for (const entry of provider.models || []) addModel(entry.model);
  }
  for (const channel of routing.channels) {
    if (!orderedProviders.some(provider => matchesChannel(provider, channel.name))) {
      attempted.push({ providerId: channel.name, displayName: channel.name, model: requestedModel,
        reason: '配置渠道当前不可用' });
    }
  }
  const consider = async (provider, model, channel = '') => {
    if (attempted.some(item => item.providerId === provider.id && item.model === model)) return null;
    const previousFailure = recentFailures.get(`${provider.id}::${model}`);
    if (previousFailure) {
      attempted.push({ providerId: provider.id, displayName: provider.displayName || provider.id, model,
        reason: `最近一次执行失败：${previousFailure}` });
      return null;
    }
    const supported = model === provider.defaultModel || provider.models?.some(entry => entry.model === model);
    if (!supported) {
      attempted.push({ providerId: provider.id, displayName: provider.displayName || provider.id, model,
        reason: '渠道模型目录不包含该模型' });
      return null;
    }
    const configured = await providers.isProviderConfigured(provider.id).catch(() => false);
    if (!configured) {
      attempted.push({ providerId: provider.id, displayName: provider.displayName || provider.id, model, reason: '渠道未配置' });
      return null;
    }
    try {
      const route = providers.resolveRoute({ modelProviderId: provider.id, model });
      if (route.model !== model) {
        attempted.push({ providerId: provider.id, displayName: provider.displayName || provider.id, model,
          reason: `实际路由为 ${route.model || '(空)'}` });
        return null;
      }
      const reason = model === requestedModel
        ? preferredProviderId && !matchesChannel(provider, preferredProviderId)
          ? '同模型改用其他渠道'
          : '使用配置渠道'
        : preferredProviderId && matchesChannel(provider, preferredProviderId)
          ? '目标渠道没有可用模型，改用其他模型'
          : '目标模型不可用，改用其他渠道和模型';
      const requestedEffort = String(request?.reasoningEffort || '').trim();
      return { ...route, taskRouting: {
        configFile: TASK_ROUTING_CONFIG_FILE,
        requestedModel,
        requestedProviderId: preferredProviderId,
        selectedModel: model,
        selectedProviderId: provider.id,
        selectedProviderName: provider.displayName || provider.id,
        reason,
        attempted,
        ...(refreshError ? { refreshWarning: refreshError } : {}),
      }, reasoningEffort: requestedEffort && reasoningEfforts.has(requestedEffort)
        ? requestedEffort : routing.reasoningEffort };
    } catch (error) {
      attempted.push({ providerId: provider.id, displayName: provider.displayName || provider.id, model,
        reason: error.message });
      return null;
    }
  };

  if (preferredProvider) {
    const preferredRoute = await consider(preferredProvider, requestedModel, preferredProviderId);
    if (preferredRoute) return preferredRoute;
  }
  for (const model of modelOrder) {
    for (const provider of orderedProviders) {
      const channel = routing.channels.find(item => matchesChannel(provider, item.name))?.name || '';
      const route = await consider(provider, model, channel);
      if (route) return route;
    }
  }
  const details = { configFile: TASK_ROUTING_CONFIG_FILE, requestedModel, requestedProviderId: preferredProviderId, attempts: attempted,
    ...(refreshError ? { refreshWarning: refreshError } : {}) };
  const summary = attempted.map(item => `${item.displayName}/${item.model}：${item.reason}`).join('；');
  const error = new Error(`${unavailableMessage || '任务模型不可用：'}按 ${TASK_ROUTING_CONFIG_FILE} 尝试全部渠道和模型后仍无可用配置${summary ? `。尝试记录：${summary}` : ''}`);
  error.details = details;
  throw error;
};

export const requestedBackgroundRoute = async (providers, request, tasks = [], policy = null) =>
  selectTaskRoute(providers, request, { tasks, policy });

export const employeeTaskRoute = async (providers, employee, tasks = [], policy = null) => {
  const route = await selectTaskRoute(providers,
    { model: employee?.model || '', modelProviderId: employee?.modelProviderId || '', reasoningEffort: employee?.reasoningEffort || '' },
    { tasks, policy, unavailableMessage: '任务模型不可用：' });
  return { ...route, ...(employee?.reasoningEffort ? { reasoningEffort: employee.reasoningEffort } : {}) };
};

export const backgroundTaskRoute = async (providers, policy = null) => {
  const selectedPolicy = policy || await loadTaskRoutingPolicy();
  const route = await selectTaskRoute(providers, { model: selectedPolicy.defaultModel }, {
    policy: selectedPolicy,
    unavailableMessage: `默认模型 ${selectedPolicy.defaultModel} 不可用：`,
  });
  return { ...route, reasoningEffort: route.reasoningEffort || selectedPolicy.reasoningEffort };
};
