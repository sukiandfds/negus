export function shortConversationTitle(text) {
  const chars = [...String(text || '').replace(/\s+/gu, ' ').trim()];
  return chars.length > 20 ? chars.slice(0, 20).join('') + '…' : chars.join('');
}
