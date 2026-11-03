// One preference for all Negus-managed background tasks; foreground models stay unchanged.
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

export const backgroundTaskRoute = async (providers, fallback) => {
  if (!providers?.providers) return fallback;
  await providers.refreshShared?.();
  const vip = providers.providers().find(provider => provider.displayName.toLowerCase() === 'vip');
  if (!vip || !await providers.isProviderConfigured(vip.id)) return fallback;
  if (!vip.models.some(entry => entry.model === 'gpt-6.1-terra')) await providers.refreshProviderModels(vip.id);
  return { ...providers.resolveRoute({ modelProviderId: vip.id, model: 'gpt-6.1-terra' }), reasoningEffort: 'xhigh' };
};
