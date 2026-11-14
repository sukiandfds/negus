import { realtimeIntegration } from './realtime-integration.mjs';
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const buildId = process.env.NEGUS_BUILD_ID || `feishu-${Date.now().toString(36)}`;
const versionPlugin = {
  name: 'negus-version-asset',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ buildId, builtAt: new Date().toISOString() })}\n` });
  },
};
const backend = process.env.NEGUS_UI_BACKEND || 'http://127.0.0.1:49974';
const tokenFile = process.env.NEGUS_UI_TOKEN_FILE || path.resolve(root, '../runtime/access-token');
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
  plugins: [realtimeIntegration(path.join(root, 'src/projectEvents.ts')), versionPlugin],
  esbuild: { jsx: 'automatic' },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      'react': path.resolve(root, 'node_modules/react'),
      'react-dom': path.resolve(root, 'node_modules/react-dom'),
      'lucide-react': path.resolve(root, 'node_modules/lucide-react'),
    },
  },
  define: { __APP_BUILD_ID__: JSON.stringify(buildId) },
  server: { host: '127.0.0.1', port: 5180, strictPort: true, fs: { allow: [path.resolve(root, '..')] }, proxy },
  build: { outDir: 'dist', emptyOutDir: true },
});
