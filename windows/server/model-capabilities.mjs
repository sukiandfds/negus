// Supplier-specific Responses capabilities verified in FEAT-022.
// Grok 4.7: 2026-09-22; GPT 6.1 sol: 2026-09-30.
const verified = {
  'grok-4.7': ['low', 'medium', 'high'],
  'gpt-6.1-sol': ['low', 'medium', 'high', 'xhigh'],
};
export const withVerifiedReasoning = (entry, baseUrl) => {
  if (entry.supportedReasoningEfforts?.length) return entry;
  const efforts = baseUrl?.replace(/\/$/u, '') === 'https://fushengyunsuan.cn/v1' ? verified[entry.model] : null;
  return { ...entry, supportedReasoningEfforts: efforts
    ? efforts.map(reasoningEffort => ({ reasoningEffort, description: '' }))
    : entry.supportedReasoningEfforts || [] };
};
