// No UI/runtime dependency: channels supply their existing mention parser and selector.
export async function routeMessage({ text = '', members = [], explicitIds = [], requestedIds = [], receptionId, allowBroadcast = true,
  select, context = [], log = () => {}, replyAgentId = '' }) {
  const allowed = new Set(members.map(member => member.id));
  const valid = ids => [...new Set(Array.isArray(ids) ? ids : [])].filter(id => allowed.has(id));
  const explicit = valid(explicitIds);
  if (explicit.length) return { agentIds: explicit, reason: 'explicit' };
  const broadcast = /(?:^|[\s,@，。！？：；、])(?:(?:先|请|让)[\s,，]?)*(?:@everyone|@?(?:所有人|全员|各位|每个人|全部员工|所有员工)|大家)(?=$|[\s,@，。！？：；、]|看|都|一起|讨论|检查|先|请|帮|来)/iu.test(String(text || ''));
  if (allowBroadcast && broadcast) return { agentIds: members.map(member => member.id), reason: 'broadcast' };
  const replied = valid([replyAgentId]);
  if (replied.length) return { agentIds: replied, reason: 'reply' };
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

const collaborationRequest = /(?:几个人|多人|多个(?:员工|成员|岗位)|各(?:个)?岗位|各司其职|分工|协同(?:完成|处理|推进)?|协作(?:完成|处理|推进)?|合作完成|相互配合|互相配合|各自负责|职责合作|团队协作)/iu;
const implementationRequest = /(?:更新(?:.{0,24})?数据|数据(?:更新|同步|修复)|页面|网站|构建|发布|上线|接口|可视化|图表|对比)/iu;
const productDataRequest = /(?:(?:产品|竞品|系列|规格|参数|功能|用户|体验|市场).{0,16}数据|数据.{0,16}(?:核实|来源|口径|准确性|对比))/iu;
const roleDefinitions = [
  { id: 'researcher', match: /产品|需求|研究|调研|资料|事实核实|用户体验|方案分析/iu,
    focus: '核实需求、资料与用户流程',
    instructions: '先核实本次需求相关的事实、现有资料和用户流程，列出证据、影响范围和仍需确认项。只做产品分析，不修改代码、不发布。完成后以本人身份在群内汇报结论和证据。' },
  { id: 'developer', match: /技术|代码|开发|实现|修复|缺陷|前端|后端|接口|服务端|客户端|页面|网站|构建|发布|上线|可视化|图表|\bbug\b/iu,
    implementation: true,
    focus: '完成代码实现与定向验证',
    instructions: '按本次已确认范围完成代码实现与定向验证，优先复用已有实现并保留未授权范围。完成后以本人身份在群内汇报改动、验证证据和剩余风险。' },
  { id: 'reviewer', match: /风控|质量|复核|审查|审核|验收|回归风险|独立检查|独立测试/iu,
    focus: '独立复核风险与发布验收',
    instructions: '独立复核产品分析结论和技术研发交付，检查用户流程、回归风险、证据完整性和发布前阻断项。不要代替研发修改代码，完成后以本人身份在群内汇报通过项、问题和结论。' },
];

const agentSearchText = agent => [agent?.id, agent?.name, agent?.shortName, agent?.responsibility].filter(Boolean).join(' ');

// Deterministic only for an explicit collaboration request or two clearly
// separate work roles. It never expands an ordinary request to the whole team.
export function planGroupCollaboration({ text = '', members = [], receptionId = '' } = {}) {
  const current = String(text || '').trim();
  // Only the current request can trigger collaboration. Earlier multi-agent
  // messages must not turn a later ordinary request into a team assignment.
  const domains = roleDefinitions.filter(role => role.match.test(` ${current} `)
    || (role.id === 'researcher' && productDataRequest.test(current)));
  if (implementationRequest.test(current) && !domains.some(role => role.implementation)) {
    domains.push(roleDefinitions.find(role => role.implementation));
  }
  const explicit = collaborationRequest.test(current);
  if ((!explicit && domains.length < 2) || !members.length) return null;
  const reception = members.find(member => member.id === receptionId);
  if (!reception) return null;
  if (explicit && !domains.length) return {
    receptionId: reception.id,
    receptionName: reception.name || reception.id,
    explicit: true,
    reason: 'clarification',
    assignments: [],
  };
  const assignments = [];
  const assignRole = role => {
    const candidates = members.filter(member => member.id !== receptionId);
    const agent = candidates.find(member => member.id === role.id)
      || candidates.find(member => role.match.test(` ${agentSearchText(member)} `));
    if (!agent || assignments.some(item => item.agentId === agent.id)) return;
    assignments.push({
      agentId: agent.id,
      agentName: agent.name || agent.id,
      responsibility: String(agent.responsibility || role.focus).trim(),
      focus: role.focus,
      instructions: role.instructions,
    });
  };
  for (const role of domains) assignRole(role);
  if (!assignments.length) return null;
  return {
    receptionId: reception.id,
    receptionName: reception.name || reception.id,
    explicit,
    reason: explicit ? 'explicit-collaboration' : 'cross-role',
    assignments,
  };
}

export const groupCollaborationText = plan => plan?.assignments?.length
  ? `分工：${plan.assignments.map(item => `${item.agentName}负责${item.focus}`).join('；')}。对应任务已经创建，完成后由各自在群内汇报。`
  : '';
