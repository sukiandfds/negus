import type { SecretMode } from '../../shared/components/SecretField';
export type ProviderConfiguration = {
  id: string; name: string; website: string; baseUrl: string; userId: string; model: string;
  hasUserKey: boolean; hasGroupKey: boolean;
};
export type SettingsSnapshot = { revision: string; defaultId: string; configurations: ProviderConfiguration[] };
export type ProviderDraft = Omit<ProviderConfiguration, 'hasUserKey' | 'hasGroupKey'> & {
  sourceId: string; userKey: string; groupKey: string; userKeyMode: SecretMode; groupKeyMode: SecretMode;
};
export const providerDraft = (entry?: ProviderConfiguration, copy = false): ProviderDraft => ({
  id: copy ? '' : entry?.id || '', sourceId: copy ? entry?.id || '' : '',
  name: (entry?.name || '') + (copy ? ' 副本' : ''), website: entry?.website || '', baseUrl: entry?.baseUrl || '',
  userId: entry?.userId || '', model: entry?.model || '', userKey: '', groupKey: '',
  userKeyMode: entry?.hasUserKey ? 'keep' : 'clear', groupKeyMode: entry?.hasGroupKey ? 'keep' : 'clear',
});
