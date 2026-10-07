import { realtimeIntegration } from './realtime-integration.mjs';
import { defineConfig } from '../web-ui/node_modules/vite/dist/node/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const backend = process.env.NEGUS_UI_BACKEND || 'http://127.0.0.1:49974';
const tokenFile = process.env.NEGUS_UI_TOKEN_FILE || path.resolve(root, '../runtime/agent-experience-validation/2026-10-06T09-27-56-338Z/runtime/browser-access-token');
const proxy = Object.fromEntries(['/api', '/events'].map(prefix => [prefix, {
  target: backend,
  changeOrigin: true,
  configure(server: any) {
    server.on('proxyReq', (request: any) => {
      request.setHeader('Cookie', `codex_demo_token=${encodeURIComponent(fs.readFileSync(tokenFile, 'utf8').trim())}`);
    });
  },
}]));

export default defineConfig({
  root,
  // Reuse the original composer without editing it; only this UI's product copy differs.
  plugins: [realtimeIntegration(path.join(root, 'src/projectEvents.ts')), { name: 'negus-group-composer-copy', enforce: 'pre', transform(source, id) {
    if (!id.split('?')[0].endsWith('/group-chat/components/GroupComposer.tsx')) return null;
    const replacements = [
      ['发给项目群。需要员工回答时，用 @ 点名', '发送消息，合适的员工会回复；也可以 @ 指定员工'],
      ['被点到的员工按顺序回复，没被点名的不会插话', '点名优先交给指定员工；不点名时自动选择合适的员工'],
      ['群里的完整记录一直保留。每次点名是单独一件事，先发的先做，后一条等下一轮。点名后的补充跟着这一条；短的续话接着上一条理解。已经点到的同事会自己回复。', '群里的完整记录一直保留。员工会结合这次消息和相关记录回复；同一员工的工作按顺序处理，不同员工可以同时工作。外派结果会回到来源对话。'],
      ['会在当前任务结束后按顺序回复', '已收到点名，会根据各自任务进度回复'],
      ['按顺序回复：', '已点名：'],
      ['停止当前任务', '停止群内全部任务'],
    ];
    for (const [before, after] of replacements) {
      if (!source.includes(before)) throw new Error(`Group composer integration point changed: ${before}`);
      source = source.replaceAll(before, after);
    }
    return { code: source, map: null };
  } }],
  esbuild: { jsx: 'automatic' },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      'react': path.resolve(root, '../web-ui/node_modules/react'),
      'react-dom': path.resolve(root, '../web-ui/node_modules/react-dom'),
      'lucide-react': path.resolve(root, '../web-ui/node_modules/lucide-react'),
    },
  },
  define: { __APP_BUILD_ID__: JSON.stringify('feishu-ui-development') },
  server: { host: '127.0.0.1', port: 5180, strictPort: true, fs: { allow: [path.resolve(root, '..')] }, proxy },
  build: { outDir: 'dist', emptyOutDir: true },
});
