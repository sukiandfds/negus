import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';

export function createHandoffMcpServer({ endpoint = process.env.NEGUS_HANDOFF_ENDPOINT, token = process.env.NEGUS_HANDOFF_TOKEN, background = process.env.NEGUS_BACKGROUND_TASKS === '1', fetchResponse = fetch } = {}) {
  const server = new McpServer({ name: 'negus-handoffs', version: '1.0.0' });
  const call = async (action, args) => {
    try {
      const response = await fetchResponse(endpoint, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...args }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '任务服务不可用');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  };
  server.registerTool('delegate_task', {
    description: '将用户已授权的工作异步交给现有员工。工具保存任务后立即返回；群内请求意见、验收或等待结果继续处理时保持 notifySource 为 true（默认），纯告知且无需后续处理时可设为 false。重试同一次交接必须沿用 requestId；新的工作使用新的 requestId。普通提到同事名字不会派发任务。',
    inputSchema: z.object({ requestId: z.string().min(1), agentId: z.string().min(1), title: z.string().min(1), instructions: z.string().min(1), notifySource: z.boolean().optional() }),
  }, args => call('delegate', args));
  if (background) server.registerTool('create_background_task', {
    description: '将用户已授权的执行工作放到独立后台对话。只指定模型时自动匹配配置，优先上次成功配置；model 也可填配置名称以使用该配置默认模型。仅用户明确指定配置时传 modelProviderId，勿自行填 current。保存后立即返回；确认接单后结束本轮回复，不等待或查询，结果会自动回到本对话。重试沿用 requestId。',
    inputSchema: z.object({ requestId: z.string().min(1), title: z.string().min(1), instructions: z.string().min(1),
      modelProviderId: z.string().min(1).optional(), model: z.string().min(1).optional(), reasoningEffort: z.string().min(1).optional() }),
  }, args => call('background', args));
  if (background) server.registerTool('followup_background_task', {
    description: '在本来源助手已创建的后台对话中追加要求。沿用原 taskId、线程和供应商；同一次调用重试须使用相同 requestId。未确认发送时只核对，不重复发送。',
    inputSchema: z.object({ taskId: z.string().min(1), requestId: z.string().min(1), instructions: z.string().min(1) }),
  }, args => call('followup', args));
  server.registerTool('list_tasks', { description: '查询当前对话的任务和结果，不重复执行。', inputSchema: z.object({}), annotations: { readOnlyHint: true } }, args => call('list', args));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serveStdio(() => createHandoffMcpServer(), { legacy: 'serve' });
