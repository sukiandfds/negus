export const agentRoleIds = Object.freeze({ default: "manager", output: "developer" });

export const cleanAgentIds = (ids, agents) => [...new Set((Array.isArray(ids) ? ids : [])
  .map((id) => String(id || "").trim())
  .filter((id) => agents.some((agent) => agent.id === id)))];

const escapePattern = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentionBoundary = "(?=$|[^\\p{L}\\p{N}_-])";

export const mentionedAgentIds = (text, agents) => {
  const matches = agents.flatMap((agent, agentOrder) => [...new Set([agent.name, ...(Array.isArray(agent.aliases) ? agent.aliases : [])])]
    .filter(Boolean)
    .flatMap((name) => [...String(text || "").matchAll(new RegExp(`@${escapePattern(name)}${mentionBoundary}`, "gu"))]
      .map((match) => ({ agentId: agent.id, agentOrder, index: match.index, length: String(name).length }))));
  const selected = new Map();
  for (const match of matches) {
    const current = selected.get(match.index);
    if (!current || match.length > current.length || (match.length === current.length && match.agentOrder < current.agentOrder)) selected.set(match.index, match);
  }
  return [...new Set([...selected.values()]
    .sort((left, right) => left.index - right.index)
    .map((match) => match.agentId))];
};

// These phrases are an explicit broadcast request.  They must be resolved at
// the routing boundary so every downstream consumer (context, queue, status,
// and persistence) sees the same target set.
const broadcastPattern = /(?:^|[\s,@，。！？：；、])(?:@?(?:所有人|全员|各位|每个人|全部员工|所有员工)|大家)(?=$|[\s,@，。！？：；、]|看|都|一起|讨论|检查|先|请|帮|来)/u;

export const isBroadcastRequest = (text) => broadcastPattern.test(String(text || ""));

export const resolveAgentRouting = ({ text = "", requestedAgentIds = [], explicitAgentIds, agents = [], outputRequested = false } = {}) => {
  const explicit = cleanAgentIds(
    Array.isArray(explicitAgentIds) && explicitAgentIds.length ? explicitAgentIds : mentionedAgentIds(text, agents),
    agents,
  );
  const outputAgentId = cleanAgentIds([agentRoleIds.output], agents)[0] || "";
  const broadcast = !explicit.length && isBroadcastRequest(text);
  let targets = broadcast
    ? agents.map((agent) => agent.id)
    : explicit.length ? explicit : cleanAgentIds(requestedAgentIds, agents);
  if (!explicit.length && !broadcast && outputRequested && outputAgentId) targets = [outputAgentId];
  return { explicitAgentIds: explicit, targetAgentIds: [...new Set(targets)], outputAgentId, broadcast };
};
