import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_SELECTION_FORMAT,
  GROUP_SELECTOR_MAX_OUTPUT_TOKENS,
  buildGroupSelectionContext,
  createGroupMessageSelector,
  groupSelectionPrompt,
  parseGroupAgentSelection,
} from '../server/group-message-selector.mjs';

const members = [
  { id: 'manager', name: '运营管理', responsibility: '整体协调与汇总' },
  { id: 'developer', name: '技术研发', responsibility: '代码实现、接口与验证' },
  { id: 'reviewer', name: '风控质量', responsibility: '缺陷、风险与验收' },
];

test('群聊选人上下文只保留最近八条并单独保留引用和成员职责', () => {
  const messages = Array.from({ length: 10 }, (_, index) => ({
    id: `m${index}`, type: index % 2 ? 'agent' : 'human', authorId: index % 2 ? 'developer' : 'user',
    authorName: index % 2 ? '技术研发' : '用户', agentId: index % 2 ? 'developer' : '', text: `消息 ${index}`,
  }));
  const quoted = { id: 'quote', type: 'agent', authorId: 'reviewer', authorName: '风控质量', agentId: 'reviewer', text: '复验结论' };
  const context = buildGroupSelectionContext({ messages, quoted });
  const prompt = groupSelectionPrompt({ text: '继续处理这个风险', members, context });
  assert.deepEqual(context.messages.map(message => message.id), ['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  assert.equal(context.quoted.id, 'quote');
  assert.match(prompt, /代码实现、接口与验证/);
  assert.match(prompt, /复验结论/);
  assert.match(prompt, /继续处理这个风险/);
  assert.match(prompt, /一名、多名或全部员工/);
  assert.match(prompt, /人数不设默认值/);
  assert.doesNotMatch(prompt, /默认选择一名|大家都出来|先每个人都出来打招呼|全员发言/);
  assert.doesNotMatch(prompt, /消息 [01](?:\\D|$)/);
});

test('群聊选人只接受本群员工 ID，并拒绝空结果和群外员工', () => {
  assert.deepEqual(parseGroupAgentSelection('{"agentIds":["developer","reviewer"]}', members), ['developer', 'reviewer']);
  assert.deepEqual(parseGroupAgentSelection('```json\n{"agentIds":["developer"]}\n```', members), ['developer']);
  assert.deepEqual(parseGroupAgentSelection('{"agentIds":["developer"]}\n额外说明', members), ['developer']);
  assert.deepEqual(parseGroupAgentSelection('先核对名单：{\n"agentIds": ["developer", "reviewer"]\n}', members), ['developer', 'reviewer']);
  assert.deepEqual(parseGroupAgentSelection('{"agentIds":["developer","developer"]}', members), ['developer']);
  assert.throws(() => parseGroupAgentSelection('{"agentIds":[]}', members), /为空/);
  assert.throws(() => parseGroupAgentSelection('{"agentIds":["outside"]}', members), /群外员工/);
  assert.throws(() => parseGroupAgentSelection('{"agentId":"developer"}', members), /缺少/);
});

test('后台选人优先使用无工具的 DeepSeek Flash Low Responses 文本请求', async () => {
  let completion = null;
  let clientTouched = false;
  const selector = createGroupMessageSelector({ modelProviders: {
    providers: () => [{ id: 'deepseek', displayName: 'DeepSeek', defaultModel: 'deepseek-flash',
      models: [{ model: 'deepseek-flash' }] }],
    isProviderConfigured: async () => true,
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
    refreshShared: async () => {},
    complete: async (route, options) => {
      completion = { route, options };
      return { text: '{"agentIds":["reviewer"]}', modelProviderId: route.modelProviderId,
        model: route.model, reasoningEffort: route.reasoningEffort };
    },
    getClient: async () => {
      clientTouched = true;
      throw new Error('不应启动应用会话');
    },
  } });
  const result = await selector.select({ text: '检查回归风险', members, context: { messages: [], quoted: null } });
  assert.deepEqual(result.agentIds, ['reviewer']);
  assert.equal(completion.route.model, 'deepseek-flash');
  assert.equal(completion.route.reasoningEffort, 'low');
  assert.equal(completion.options.maxOutputTokens, GROUP_SELECTOR_MAX_OUTPUT_TOKENS);
  assert.deepEqual(completion.options.textFormat, GROUP_SELECTION_FORMAT);
  assert.deepEqual(GROUP_SELECTION_FORMAT.schema.required, ['agentIds']);
  assert.equal(GROUP_SELECTION_FORMAT.schema.properties.agentIds.uniqueItems, true);
  assert.match(completion.options.input, /检查回归风险/);
  assert.equal(clientTouched, false);
});

test('缺少无工具文本接口时直接失败且不启动带工具的应用会话', async () => {
  let clientTouched = false;
  const modelProviders = {
    providers: () => [{ id: 'deepseek', displayName: 'DeepSeek', defaultModel: 'deepseek-flash',
      models: [{ model: 'deepseek-flash' }] }],
    isProviderConfigured: async () => true,
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
    getClient: async () => { clientTouched = true; return {}; },
    refreshShared: async () => {},
  };
  const selector = createGroupMessageSelector({ modelProviders });
  await assert.rejects(selector.select({ text: '检查', members }), /无工具 Responses 文本接口/);
  assert.equal(clientTouched, false);
});
