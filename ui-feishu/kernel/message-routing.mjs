// No UI/runtime dependency: channels supply their existing mention parser and selector.
export async function routeMessage({ text = '', members = [], explicitIds = [], requestedIds = [], receptionId,
  select, context = [], log = () => {} }) {
  const allowed = new Set(members.map(member => member.id));
  const valid = ids => [...new Set(Array.isArray(ids) ? ids : [])].filter(id => allowed.has(id));
  const explicit = valid(explicitIds);
  if (explicit.length) return { agentIds: explicit, reason: 'explicit' };
  const requested = valid(requestedIds);
  if (requested.length) return { agentIds: requested, reason: 'requested' };
  if (!members.length) throw Object.assign(new Error('当前对话没有可接待的员工'), { statusCode: 409 });
  if (!allowed.has(receptionId)) throw new Error('接待员工必须属于当前对话');
  if (members.length === 1) return { agentIds: [receptionId], reason: 'only-member' };
  try {
    const selected = await select?.({ text, members, context });
    if (typeof selected === 'string' && allowed.has(selected)) return { agentIds: [selected], reason: 'selected' };
    log({ event: 'routing_fallback', reason: 'invalid-selection' });
  } catch {
    // Provider errors can contain credentials or prompts; the provider logger owns those diagnostics.
    log({ event: 'routing_fallback', reason: 'selector-failed' });
  }
  return { agentIds: [receptionId], reason: 'reception' };
}
