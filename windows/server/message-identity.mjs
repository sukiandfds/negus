// Compare messages inside one conversation/room. Text and turn ID alone are never identities.
const prefix = "optimistic-";
export const optimisticMessageId = submissionId => prefix + submissionId;
export const isOptimisticId = id => typeof id === "string" && id.startsWith(prefix);
export const optimisticSubmissionId = id => isOptimisticId(id) ? id.slice(prefix.length) : "";
export const submissionIdOf = value => value.submissionId || value.clientMessageId
  || value.clientUserMessageId || value.clientId || value.client_id
  || (value.role === "user" ? optimisticSubmissionId(value.id) : "");

export const protocolUserSubmission = item => item?.type === "userMessage" ? submissionIdOf(item) : "";
export const containsSubmittedInput = (items, submissionId) =>
  Boolean(submissionId && items?.some(item => protocolUserSubmission(item) === submissionId));

const clientKey = m => {
  const id = submissionIdOf(m);
  return id && JSON.stringify(["send", m.clientMessageId ? m.authorId : m.role, id]);
};
export const sameSubmission = (left, right) => Boolean(clientKey(left) && clientKey(left) === clientKey(right));
const keys = m => [m.id && JSON.stringify(["id", m.id]), clientKey(m),
  m.workId && JSON.stringify(["work", m.workId, m.itemId || null])].filter(Boolean);
export const sameMessage = (left, right) => {
  const ids = keys(right);
  return keys(left).some(key => ids.includes(key));
};

// A receipt can connect a local placeholder and a protocol item already in the list.
export function mergeIdentified(messages, resolve) {
  const positions = new Map(), rows = [];
  for (const message of messages) {
    const aliases = keys(message);
    const hits = [...new Set(aliases.map(k => positions.get(k)).filter(Boolean))].sort((a,b) => a.index-b.index);
    const row = hits[0] || { index: rows.length, aliases: new Set(), value: message };
    if (!hits.length) rows.push(row);
    for (const other of hits.slice(1)) {
      row.value = resolve(row.value, other.value);
      for (const key of other.aliases) { row.aliases.add(key); positions.set(key, row); }
      rows[other.index] = null;
    }
    if (hits.length) row.value = resolve(row.value, message);
    for (const key of aliases) { positions.set(key, row); row.aliases.add(key); }
  }
  return rows.filter(Boolean).map(row => row.value);
}

// A native item ID belongs to its turn; a client receipt identifies a particular send.
export const receiptMatches = (message, receipt) => message.turnId === receipt.turnId
  && Boolean((message.itemId && message.itemId === receipt.itemId)
    || (submissionIdOf(message) && submissionIdOf(message) === submissionIdOf(receipt)));
