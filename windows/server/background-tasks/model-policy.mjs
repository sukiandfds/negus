// Shared default for new ordinary conversations, employees and Negus-managed tasks.
export const DEFAULT_DEEPSEEK_ROUTE = Object.freeze({ model: 'deepseek-flash', reasoningEffort: 'high', label: 'DeepSeek Flash High' });

export const modelDefaultsFromRoute = route => ({
  providerId: route.modelProviderId,
  model: route.modelProviderId === 'current' || String(route.model).includes('::')
    ? route.model : `${route.modelProviderId}::${route.model}`,
  effort: route.reasoningEffort || '',
  archivedProviderIds: [],
});

export const requestedBackgroundRoute = async (providers, request, tasks = []) => {
  const { model = '', modelProviderId = '' } = request;
  if (modelProviderId || model.includes('::')) return providers.resolveRoute(request);
  await providers.refreshShared?.();
  const catalog = providers.providers();
  // A configuration name requests its default model; an exact model keeps its identity.
  const named = catalog.filter(provider => provider.displayName.toLowerCase() === model.toLowerCase());
  let candidates = named.length ? named : catalog.filter(provider => provider.models.some(entry => entry.model === model));
  const configured = await Promise.all(candidates.map(provider => providers.isProviderConfigured(provider.id)));
  candidates = candidates.filter((_, index) => configured[index]);
  if (!candidates.length) throw new Error(`没有已配置的渠道支持 ${model}`);
  const successes = tasks.filter(task => task.background && task.state === 'completed'
    && task.runtime?.model && (named.length || task.runtime.model === model))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  const successful = successes.map(task => candidates.find(provider => provider.id === task.runtime.modelProviderId)).find(Boolean);
  const preferred = successful || candidates.find(provider => provider.displayName.toLowerCase() === 'vip');
  if (!preferred && candidates.length > 1) throw new Error(`${model} 有多个可用配置，请指定配置：${candidates.map(provider => provider.displayName).join('、')}`);
  const route = providers.resolveRoute({ modelProviderId: (preferred || candidates[0]).id, model: named.length ? '' : model });
  if (!named.length && route.model !== model) throw new Error(`所选配置无法保持指定模型 ${model}`);
  return route;
};

export const backgroundTaskRoute = async (providers) => {
  const unavailable = detail => new Error(`默认模型 ${DEFAULT_DEEPSEEK_ROUTE.label} 不可用：${detail}`);
  if (!providers?.providers || !providers?.isProviderConfigured || !providers?.resolveRoute)
    throw unavailable('模型提供方服务未连接');
  try {
    await providers.refreshShared?.();
  } catch (error) {
    throw unavailable(`配置刷新失败：${error?.message || String(error)}`);
  }
  const candidates = providers.providers().filter(provider =>
    provider.models?.some(entry => entry.model === DEFAULT_DEEPSEEK_ROUTE.model)
    && (provider.mode !== 'current' || !provider.activeModel
      || !provider.activeModels?.length || provider.activeModels.includes(DEFAULT_DEEPSEEK_ROUTE.model)));
  const configured = await Promise.all(candidates.map(provider => providers.isProviderConfigured(provider.id)));
  const available = candidates.filter((_, index) => configured[index]);
  if (!available.length) throw unavailable(`没有已配置的渠道支持 ${DEFAULT_DEEPSEEK_ROUTE.model}`);
  const provider = available.find(entry => /deepseek/iu.test(entry.displayName || '')) || available[0];
  let route;
  try {
    route = providers.resolveRoute({ modelProviderId: provider.id, model: DEFAULT_DEEPSEEK_ROUTE.model });
  } catch (error) {
    throw unavailable(`渠道 ${provider.displayName || provider.id} 路由失败：${error.message}`);
  }
  if (route.model !== DEFAULT_DEEPSEEK_ROUTE.model)
    throw unavailable(`渠道 ${provider.displayName || provider.id} 无法保持指定模型 ${DEFAULT_DEEPSEEK_ROUTE.model}`);
  return { ...route, reasoningEffort: DEFAULT_DEEPSEEK_ROUTE.reasoningEffort };
};
