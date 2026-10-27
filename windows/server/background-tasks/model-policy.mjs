// One preference for all Negus-managed background tasks; foreground models stay unchanged.
export const backgroundTaskRoute = async (providers, fallback) => {
  if (!providers?.providers) return fallback;
  await providers.refreshShared?.();
  const vip = providers.providers().find(provider => provider.displayName.toLowerCase() === 'vip');
  if (!vip || !await providers.isProviderConfigured(vip.id)) return fallback;
  if (!vip.models.some(entry => entry.model === 'gpt-6.1-terra')) await providers.refreshProviderModels(vip.id);
  return providers.resolveRoute({ modelProviderId: vip.id, model: 'gpt-6.1-terra' });
};
