import type { GroupAgent } from "./types";

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentionBoundary = "(?=$|[^\\p{L}\\p{N}_-])";

const mentionMatches = (text: string, agents: GroupAgent[]) => {
  const matches = agents.flatMap((agent, agentOrder) => [...new Set([agent.name, ...(agent.aliases || [])])]
    .filter(Boolean)
    .flatMap((name) => [...text.matchAll(new RegExp(`@${escapePattern(name)}${mentionBoundary}`, "gu"))]
      .map((match) => ({ agentId: agent.id, agentOrder, index: match.index ?? 0, length: name.length }))));
  const selected = new Map<number, typeof matches[number]>();
  for (const match of matches) {
    const current = selected.get(match.index);
    if (!current || match.length > current.length || (match.length === current.length && match.agentOrder < current.agentOrder)) selected.set(match.index, match);
  }
  return [...selected.values()].sort((left, right) => left.index - right.index);
};

export const mentionedAgentIds = (text: string, agents: GroupAgent[]) => [...new Set(mentionMatches(text, agents).map((match) => match.agentId))];

export const splitMentions = (text: string, agents: GroupAgent[]) => {
  const parts: Array<{ text: string; mention: boolean }> = [];
  let cursor = 0;
  for (const match of mentionMatches(text, agents)) {
    const end = match.index + match.length + 1;
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), mention: false });
    parts.push({ text: text.slice(match.index, end), mention: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), mention: false });
  if (!parts.length) parts.push({ text, mention: false });
  return parts;
};
