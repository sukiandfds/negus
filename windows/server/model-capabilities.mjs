// GPT: Codex 0.165.0-alpha.1.2 model/list (2026-10-29), shared across providers.
// https://docs.x.ai/developers/model-capabilities/text/reasoning
// https://api-docs.deepseek.com/guides/thinking_mode (Responses API)
const standard = ['low', 'medium', 'high', 'xhigh'];
const extended = [...standard, 'max', 'ultra'];
const presets = {
  ...Object.fromEntries(['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-astra',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest'].map(model => [model, extended])),
  'gpt-6-luna': [...standard, 'max'],
  'gpt-5.6-luna': [...standard, 'max'],
  'gpt-5.5': standard,
  'codex-auto-review': [...standard, 'max'],
  'grok-4.5': ['low', 'medium', 'high'],
  'grok-4.6': standard,
  'grok-4.7': standard,
  'grok-4.20-multi-agent': standard,
  ...Object.fromEntries(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp'].map(model => [model, ['none', 'low', 'high', 'max']])),
};
export const withVerifiedReasoning = (entry) => {
  if (entry.supportedReasoningEfforts?.length) return entry;
  return { ...entry, supportedReasoningEfforts: (presets[entry.model] || [])
    .map(reasoningEffort => ({ reasoningEffort, description: '' })) };
};
