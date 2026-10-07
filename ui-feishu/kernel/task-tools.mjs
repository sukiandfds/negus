import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Per-run capabilities: a tool cannot select or impersonate a different source task.
export async function createTaskTools({ invoke }) {
  const scopes = new Map();
  const byTask = new Map();
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const source = scopes.get(String(request.headers.authorization || '').replace(/^Bearer /u, ''));
    if (!source || request.method !== 'POST' || request.url !== '/') {
      response.writeHead(401); response.end(JSON.stringify({ error: 'Unauthorized' })); return;
    }
    try {
      let text = '';
      for await (const chunk of request) text += chunk;
      const result = await invoke(source, JSON.parse(text));
      response.end(JSON.stringify(result));
    } catch (error) { response.writeHead(error.statusCode || 500); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    config: taskId => {
      if (!byTask.has(taskId)) { const token = randomBytes(32).toString('hex'); scopes.set(token, taskId); byTask.set(taskId, token); }
      return { 'mcp_servers.negus_handoffs': {
        command: process.execPath, args: [fileURLToPath(new URL('./task-tools-mcp.mjs', import.meta.url))], required: true,
        env: { NEGUS_HANDOFF_ENDPOINT: `http://127.0.0.1:${server.address().port}/`, NEGUS_HANDOFF_TOKEN: byTask.get(taskId) },
      } };
    },
    release: taskId => { scopes.delete(byTask.get(taskId)); byTask.delete(taskId); },
    close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }),
  };
}
