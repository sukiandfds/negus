import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

// Bundle the actual UI helpers without mounting React or making API requests.
globalThis.window = { location: { search: '' }, localStorage: { getItem: () => null } };
const require = createRequire(realpathSync(new URL('../../web-ui/node_modules/vite/package.json', import.meta.url)));
const { build } = require('esbuild');
const resultModule = await build({
  stdin: { contents: "export { buildConversationDirectory } from './conversationDirectory'; export { buildTaskSections } from './useTaskConversations'; export { sortPinned, pinKey } from './usePinnedConversations';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.css': 'empty', '.module.css': 'empty' },
  alias: Object.fromEntries(['react', 'react-dom', 'lucide-react'].map(name => [name, realpathSync(new URL(`../../web-ui/node_modules/${name}`, import.meta.url))])),
});
const { buildConversationDirectory, buildTaskSections, sortPinned, pinKey } = await import(`data:text/javascript;base64,${Buffer.from(resultModule.outputFiles[0].text).toString('base64')}`);
  const time = hour => `2026-10-06T${hour}:00:00Z`;
  const project = { id: 'p', projectId: 'p', name: '项目', kind: 'business', conversations: [{ id: 'ordinary', threadId: 'ordinary', title: '普通聊天', updatedAt: time('10') }] };
  const employee = { id: 'e', employeeId: 'researcher', name: '员工', kind: 'employee', mainThreadId: 'main', conversations: [
    { id: 'main', threadId: 'main', conversationId: 'main-binding', main: true, title: '主对话', lastActivityAt: time('09') },
    { id: 'worker', threadId: 'worker', conversationId: 'task-binding', title: '外派调研', targetProjectId: 'p', lastActivityAt: time('11'), status: { phase: 'completed' } },
    { id: 'group-worker', threadId: 'group-worker', title: '群执行', role: 'project' },
  ] };
  const session = { threadId: 'worker', source: 'codex', title: '外派调研', updatedAt: time('11'), messageCount: 2, latestUser: '', latestAssistant: '报告' };
  const directory = { projects: [project, employee], statusByThread: { main: { updatedAt: time('23'), active: false } } };
  const before = JSON.stringify(directory);
  const result = buildConversationDirectory(directory, [session], false);
  assert.deepEqual(result.all.map(row => row.threadId), ['worker', 'ordinary', 'main']);
  assert.equal(result.employees[0].children[0].conversationId, 'task-binding');
  assert.equal(result.projects[0].children[0].threadId, 'worker');
  assert.equal(result.projects[0].threadId, undefined, 'A random child must not become the project group');
  assert.equal(JSON.stringify(directory), before, 'View construction must not mutate shared data');
  const archived = buildConversationDirectory(directory, [{ ...session, archived: true }], true);
  assert.equal(archived.employees.length, 0);
  assert.deepEqual(archived.all.map(row => row.threadId), ['worker']);
  const task = { id: 'worker', title: '外派调研', project: employee, conversation: employee.conversations[1], category: 'running', label: '正在执行', updatedAt: time('11'), goal: { status: 'active' } };
  const sections = buildTaskSections([task], [{ id: 'daily', name: '每日检查', status: 'PAUSED', schedule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', threadId: 'main', lastRunAt: Date.parse(time('10')), runs: [{ threadId: 'worker', status: 'COMPLETED', updatedAt: Date.parse(time('11')) }] }], result.all);
  assert.equal(sections[0].items[0].conversationId, 'task-binding');
  assert.equal(sections[1].items[0].threadId, 'worker');
  assert.equal(sections[2].items[0].children[0].conversationId, 'task-binding');
  assert.equal(sections[2].items[0].conversationId, 'main-binding');
  assert.match(sections[2].items[0].preview, /每天 09:00.*已暂停/);
  assert.equal(buildTaskSections([{ ...task, category: 'completed' }], [], result.all)[0].items.length, 0);
  assert.equal(sortPinned(result.all, new Set(['employee:researcher']))[0].threadId, 'main');
  assert.equal(sortPinned(result.all, new Set(['ordinary']))[0].threadId, 'ordinary');
  assert.equal(pinKey({ main: true, agentId: 'researcher', threadId: 'new-main' }), 'employee:researcher');
  console.log('PASS: deduplication, update sorting, employee/project identity, no fabricated group, immutable input, archive view, goal and scheduled task routes.');
