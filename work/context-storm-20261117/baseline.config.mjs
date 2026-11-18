import base from '../../ui-feishu/vite.config.ts';
import { execFileSync } from 'node:child_process';
const root = '/Users/hans/myproject/negus/';
const files = new Set([
  'ui-feishu/shared/features/conversations/state/conversationStore.ts',
  'ui-feishu/shared/features/context-management/hooks/useContextManagement.ts',
  'ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts',
  'ui-feishu/src/usePageSnapshot.ts',
]);
export default { ...base, plugins: [{ name: 'baseline-readonly', enforce: 'pre',
  load(id) { const relative = id.split('?')[0].replace(root, '');
    if (files.has(relative)) return execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, encoding: 'utf8' });
  } }, ...base.plugins] };
