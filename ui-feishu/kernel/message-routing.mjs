// No UI/runtime dependency: channels supply their existing mention parser and selector.
export async function routeMessage({ text = '', members = [], explicitIds = [], requestedIds = [],
  select, context = [], log = () => {}, replyAgentId = '' }) {
  const allowed = new Set(members.map(member => member.id));
  const valid = ids => [...new Set(Array.isArray(ids) ? ids : [])].filter(id => allowed.has(id));
  const explicit = valid(explicitIds);
  if (explicit.length) return { agentIds: explicit, reason: 'explicit' };
  const replied = valid([replyAgentId]);
  if (replied.length) return { agentIds: replied, reason: 'reply' };
  const requested = valid(requestedIds);
  if (requested.length) return { agentIds: requested, reason: 'requested' };
  if (!members.length) throw Object.assign(new Error('当前对话没有可接待的员工'), { statusCode: 409 });
  try {
    const selected = await select?.({ text, members, context });
    const selectedIds = valid(Array.isArray(selected) ? selected
      : typeof selected === 'string' ? [selected] : selected?.agentIds);
    if (selectedIds.length) return { agentIds: selectedIds, reason: 'selected',
      ...(selected?.selection ? { selection: selected.selection } : {}) };
    log({ event: 'routing_fallback', reason: 'invalid-selection' });
  } catch {
    // Provider errors can contain credentials or prompts; the provider logger owns those diagnostics.
    log({ event: 'routing_fallback', reason: 'selector-failed' });
  }
  return { agentIds: [], reason: select ? 'selector-failed' : 'selector-unavailable' };
}
