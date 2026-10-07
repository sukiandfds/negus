import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.env.NEGUS_UI_STATE_ROOT || fileURLToPath(new URL('../../runtime/agent-experience-validation/2026-10-06T09-27-56-338Z/', import.meta.url)));
const webRoot = fileURLToPath(new URL('../dist/', import.meta.url));
if (!fs.existsSync(path.join(webRoot, 'index.html'))) throw Error('Build ui-feishu before starting the public backend.');
// Employee definitions use the host's existing loader and registry.
fs.cpSync(fileURLToPath(new URL('../employees/', import.meta.url)), path.join(root, 'employees'), { recursive: true });
const token = fs.readFileSync(path.join(root, 'runtime/browser-access-token'), 'utf8').trim();
const log = fs.openSync(fileURLToPath(new URL('../runtime/backend.log', import.meta.url)), 'a', 0o600);
const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./register.mjs', import.meta.url)), path.join(root, 'windows/scripts/remote-room-demo.mjs'), '--port', '49974', '--observer-port', '49975', '--project', '隔离体验验证', '--project-root', root, '--web-root', webRoot, '--token', token], {
  cwd: root, env: { ...process.env, CODEX_HOME: path.join(root, 'codex-home'), CODEX_SESSION_DIR: path.join(root, 'codex-home/sessions'), NEGUS_INSTALL_ROOT: root }, stdio: ['ignore', log, log],
});
console.log(JSON.stringify({ pid: child.pid, port: 49974 }));
child.on('exit', code => process.exit(code || 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
