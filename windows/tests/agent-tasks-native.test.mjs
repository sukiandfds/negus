import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServerClient } from '../server/app-server-client.mjs';
import { createAgentTaskService } from '../server/agent-tasks/service.mjs';

// Uses an isolated native app-server without model generation or production state.
test('native runtime loads task MCP tools on new and existing conversations', {
  skip: process.env.NEGUS_NATIVE_TASK_TEST !== '1', timeout: 60000,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-task-native-'));
  const service = await createAgentTaskService({ stateFile: path.join(root, 'tasks.json'),
    registry: {}, conversations: {}, bindings: {}, queue: {}, execution: {} });
  const client = createAppServerClient({ codexHome: root, workingDirectory: root });
  const toolsFor = async threadId => {
    const result = await client.request('mcpServerStatus/list', { threadId, serverName: 'negus_tasks' });
    return Object.keys(result.data.find(server => server.name === 'negus_tasks')?.tools || {}).sort();
  };
  try {
    const config = service.leaderConfig('researcher');
    const first = await client.request('thread/start', { cwd: root, config, sandbox: 'read-only', approvalPolicy: 'never' });
    const expected = ['create_research_task', 'list_research_tasks'];
    assert.deepEqual(await toolsFor(first.thread.id), expected);
    const second = await client.request('thread/start', { cwd: root, sandbox: 'read-only', approvalPolicy: 'never' });
    await client.request('thread/inject_items', { threadId: second.thread.id,
      items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Protocol probe only; no work requested.' }] }] });
    await client.request('thread/unsubscribe', { threadId: second.thread.id });
    const resumed = await client.request('thread/resume', { threadId: second.thread.id, config });
    assert.equal(resumed.thread.id, second.thread.id);
    assert.deepEqual(await toolsFor(second.thread.id), expected);
  } finally {
    client.close(); await service.close(); await fs.rm(root, { recursive: true, force: true });
  }
});
