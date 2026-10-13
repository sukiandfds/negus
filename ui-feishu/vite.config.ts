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
  // Product wording is passed to the shared composer through explicit props.
  plugins: [realtimeIntegration(path.join(root, 'src/projectEvents.ts'))],
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
