import { requestedBackgroundRoute } from '../../windows/server/background-tasks/model-policy.mjs';

export const GROUP_SELECTOR_MODEL = 'deepseek-flash';
export const GROUP_SELECTOR_EFFORT = 'low';
export const GROUP_SELECTOR_CONTEXT_LIMIT = 8;
export const GROUP_SELECTOR_MAX_OUTPUT_TOKENS = 2048;
const GROUP_SELECTOR_TIMEOUT_MS = 30000;
export const GROUP_SELECTION_FORMAT = {
  type: 'json_schema',
  name: 'group_agent_selection',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      agentIds: {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string' },
      },
    },
    required: ['agentIds'],
  },
};

const clip = (value, length) => String(value || '').trim().slice(0, length);

const contextMessage = message => ({
  id: String(message?.id || ''),
  type: String(message?.type || ''),
  authorId: String(message?.authorId || ''),
  authorName: clip(message?.authorName, 80),
  agentId: String(message?.agentId || ''),
  text: clip(message?.text, 600),
  targetAgentIds: Array.isArray(message?.targetAgentIds) ? message.targetAgentIds : [],
  ...(message?.replyTo?.text ? { replyTo: clip(message.replyTo.text, 300) } : {}),
});

export function buildGroupSelectionContext({
  messages = [], quoted = null, limit = GROUP_SELECTOR_CONTEXT_LIMIT,
} = {}) {
  return {
    messages: messages
      .filter(message => message?.id && (message.text || message.attachments?.length))
      .slice(-Math.max(1, limit))
      .map(contextMessage),
    quoted: quoted ? contextMessage(quoted) : null,
  };
}

export function groupSelectionPrompt({ text = '', members = [], context = {} } = {}) {
  const employees = members.map(member => ({
    id: String(member.id || ''),
    name: clip(member.name, 80),
    responsibility: clip(member.responsibility, 500),
  })).filter(member => member.id);
  return [
    '你是群聊消息的后台路由小助手。你的唯一工作是判断当前用户消息应唤醒本群的哪些员工；不要回复用户消息。',
    '群内员工见下面 members，每项含 id、name、responsibility。只能从这些 id 中选择，不能使用名单外身份。',
    '以用户当前原话表达的真实意图为准，结合成员职责、引用消息和近期群聊自主判断一名、多名或全部员工，人数不设默认值。',
    '没有明确指向时，根据职责和上下文判断实际需要接手的员工；不要让职位名称、群内顺序或某个固定接待人替用户决定。',
    '引用、追问、极短或省略式消息必须结合引用和近期上下文判断接续对象。',
    '只把 agentIds 数组作为结果，ID 不得重复；没有适合回复的员工时返回空数组。',
    '不要执行工作、调用工具、访问文件或网络、发布消息或修改数据。',
    '',
    `members：${JSON.stringify(employees)}`,
    `用户当前消息：${clip(text || '请查看附件。', 6000)}`,
    `引用消息：${JSON.stringify(context?.quoted || null)}`,
    `近期群聊：${JSON.stringify(context?.messages || [])}`,
  ].join('\n');
}

const jsonCandidateAt = (value, start) => {
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { if (quote) escaped = true; continue; }
    if (char === '"') { quote = !quote; continue; }
    if (quote) continue;
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) {
      try { return JSON.parse(value.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
};

const selectionObjectFrom = text => {
  const value = String(text || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  try {
    const whole = JSON.parse(value);
    if (whole && Object.hasOwn(whole, 'agentIds')) return whole;
  } catch {}
  let otherObject = null;
  for (let start = value.lastIndexOf('{'); start >= 0;) {
    const candidate = jsonCandidateAt(value, start);
    if (candidate && Object.hasOwn(candidate, 'agentIds')) return candidate;
    if (candidate) otherObject = candidate;
    if (start === 0) break;
    start = value.lastIndexOf('{', start - 1);
  }
  if (otherObject) return otherObject;
  throw new Error('选人结果不是有效 JSON');
};

export function parseGroupAgentSelection(text, members = []) {
  const parsed = selectionObjectFrom(text);
  if (!Array.isArray(parsed.agentIds)) throw new Error('选人结果缺少 agentIds 数组');
  const requested = parsed.agentIds;
  const ids = [...new Set(requested.map(id => String(id || '').trim()).filter(Boolean))];
  const allowed = new Set(members.map(member => String(member.id || '')));
  if (ids.some(id => !allowed.has(id))) throw new Error('选人结果包含群外员工');
  if (!ids.length) throw new Error('选人结果为空');
  return ids;
}

export function createGroupMessageSelector({
  modelProviders, tasks = () => [], timeoutMs = GROUP_SELECTOR_TIMEOUT_MS,
} = {}) {
  return {
    async select({ text = '', members = [], context = {} } = {}) {
      if (!modelProviders) throw new Error('群聊选人模型服务未连接');
      if (typeof modelProviders.complete !== 'function') throw new Error('群聊选人需要无工具 Responses 文本接口');
      const startedAt = Date.now();
      const route = await requestedBackgroundRoute(modelProviders, {
        model: GROUP_SELECTOR_MODEL,
        reasoningEffort: GROUP_SELECTOR_EFFORT,
      }, tasks());
      if (route.model !== GROUP_SELECTOR_MODEL || route.reasoningEffort !== GROUP_SELECTOR_EFFORT) {
        throw new Error(`群聊选人要求 ${GROUP_SELECTOR_MODEL}/${GROUP_SELECTOR_EFFORT}`);
      }
      const completion = await modelProviders.complete({
        modelProviderId: route.modelProviderId,
        model: route.model,
        reasoningEffort: GROUP_SELECTOR_EFFORT,
      }, {
        instructions: '你是无工具的后台消息路由函数。禁止调用工具、执行命令、访问网络或产生外部副作用；只按用户消息和给定上下文返回 JSON。',
        input: groupSelectionPrompt({ text, members, context }),
        maxOutputTokens: GROUP_SELECTOR_MAX_OUTPUT_TOKENS,
        textFormat: GROUP_SELECTION_FORMAT,
        timeoutMs,
      });
      return {
        agentIds: parseGroupAgentSelection(completion.text, members),
        selection: {
          model: route.model,
          modelProviderId: route.modelProviderId,
          reasoningEffort: route.reasoningEffort,
          routing: route.taskRouting || null,
          durationMs: Date.now() - startedAt,
        },
      };
    },
  };
}
