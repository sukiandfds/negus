import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';

export function createHandoffMcpServer({ endpoint = process.env.NEGUS_HANDOFF_ENDPOINT, token = process.env.NEGUS_HANDOFF_TOKEN, fetchResponse = fetch } = {}) {
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
    description: '将用户已授权的工作异步交给现有员工。工具保存任务后立即返回；你可以继续回复用户，结果完成后自动回到本对话。重试同一次交接必须沿用 requestId；新的工作使用新的 requestId。普通提到同事名字不会派发任务。',
    inputSchema: z.object({ requestId: z.string().min(1), agentId: z.string().min(1), title: z.string().min(1), instructions: z.string().min(1) }),
  }, args => call('delegate', args));
  server.registerTool('list_tasks', { description: '查询当前对话的任务和结果，不重复执行。', inputSchema: z.object({}), annotations: { readOnlyHint: true } }, args => call('list', args));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serveStdio(() => createHandoffMcpServer(), { legacy: 'serve' });
