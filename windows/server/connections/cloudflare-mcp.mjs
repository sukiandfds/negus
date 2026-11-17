import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { fromJsonSchema } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { createCloudflareConnection } from './cloudflare.mjs';

// Discover on every request: connecting/disconnecting works in already-open conversations.
const connection = createCloudflareConnection();
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
serveStdio(() => {
  const server = new McpServer({ name: 'negus-cloudflare', version: '1.0.0' });
  server.registerTool('status', { description: 'Check the shared server-side Cloudflare connection. No credentials are returned.', inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => result(await connection.status()));
  server.registerTool('discover', { description: 'List official Cloudflare tools and their input schemas. Read these before calling a tool.', inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => {
    try { return result(await connection.tools()); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
  server.registerTool('call', { description: 'Call a Cloudflare tool previously returned by discover. Queries and management run on the Negus host using the connected account. Only perform writes explicitly requested by the user.', inputSchema: z.object({ name: z.string().max(100), arguments: z.record(z.string(), z.unknown()) }), annotations: { destructiveHint: true, openWorldHint: true } }, async params => {
    try {
      const { tools } = await connection.tools();
      const tool = tools.find(item => item.name === params.name);
      if (!tool) throw Error('请先 discover 并选择返回的工具。');
      const validated = await fromJsonSchema(tool.inputSchema)['~standard'].validate(params.arguments);
      if (validated.issues) throw Error('工具参数不符合 discover 返回的输入格式。');
      return await connection.call(params);
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
  return server;
}, { legacy: 'serve' });
