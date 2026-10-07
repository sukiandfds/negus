import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export function createTaskMcpServer({ endpoint = process.env.NEGUS_TASK_ENDPOINT, token = process.env.NEGUS_TASK_TOKEN, fetchResponse = fetch } = {}) {
  const server = new McpServer({ name: 'negus-tasks', version: '0.1.0' });
  const call = async (action, args = {}) => {
    try {
      const response = await fetchResponse(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...args }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '后台任务服务不可用');
      return { ...(value.state === 'failed' ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(value) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  };
  server.registerTool('create_research_task', {
    description: '将用户已要求的调研交给独立后台执行者。传入明确目标、必要背景、约束及交付标准；成功后立即告知用户并结束本轮，不等待结果。每位负责人同时支持一个后台任务。',
    inputSchema: z.object({ title: z.string().min(1).max(120), instructions: z.string().min(1).max(16000) }),
  }, args => call('create', args));
  server.registerTool('list_research_tasks', {
    description: '读取自己的后台任务进度和最近结果，不重新执行工作。',
    inputSchema: z.object({}), annotations: { readOnlyHint: true },
  }, () => call('list'));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serveStdio(() => createTaskMcpServer(), { legacy: 'serve' });
}
