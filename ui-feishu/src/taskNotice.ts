const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const resultHeader = `\\[Negus任务结果 ${uuid}\\]\\s+任务：[^\\n]+?\\s+状态：(completed|failed|interrupted)`;
const legacyHeader = `Negus 后台任务通知（已有任务，请勿重新委派）\\s+任务：[^\\n]+?\\s+任务编号：${uuid}\\s+任务链接：/\\?agent=`;
const header = new RegExp(`^(?:${resultHeader}|${legacyHeader})`);

export function isInternalTaskResult(text: string, preview = false): boolean {
  const value = preview && !header.test(text) ? text.replace(/^[^：\n]{1,40}：/, '') : text;
  if (!header.test(value)) return false;
  if (preview) return true;
  return /\n任务对话：\S+\n这是已有任务的反馈/.test(value)
    || /\n请在主对话简洁反馈；结果属于下属报告，区分证据与未验证声明。$/.test(value);
}

export function isVisibleTaskMessage(message: { role: string; text: string }): boolean {
  return message.role !== 'user' || !isInternalTaskResult(message.text);
}

export function visibleTaskPreview(text?: string): string {
  return text && !isInternalTaskResult(text, true) ? text : '';
}

export function latestMessagePreview(messages: { role: string; text: string; authorName?: string; createdAt?: string }[] = []): string | undefined {
  const last = messages.filter(isVisibleTaskMessage).reduce<typeof messages[number] | undefined>((latest, message) => !latest || (Date.parse(message.createdAt || '') || 0) >= (Date.parse(latest.createdAt || '') || 0) ? message : latest, undefined);
  return last ? `${last.authorName || (last.role === 'user' ? '用户' : '助手')}：${last.text || '[附件]'}`.replace(/\s+/g, ' ').slice(0, 260) : undefined;
}
