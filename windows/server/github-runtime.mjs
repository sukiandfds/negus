import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = process.env.NEGUS_INSTALL_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const githubBinDirectory = path.join(root, 'runtime', 'bin');

const systemProxy = () => {
  if (process.platform !== 'darwin') return '';
  const result = spawnSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 2000 });
  const text = result.status === 0 ? result.stdout : '';
  const host = text.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1];
  const port = text.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
  return /HTTPSEnable\s*:\s*1\b/.test(text) && host && port ? `http://${host}:${port}` : '';
};

// Keep GitHub's host login independent of model-provider CODEX_HOME directories.
export const githubEnvironment = (env = process.env) => ({
  PATH: [githubBinDirectory, env.PATH || env.Path || ''].filter(Boolean).join(path.delimiter),
  GH_CONFIG_DIR: env.GH_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'gh'),
  NEGUS_GITHUB_PROXY: env.NEGUS_GITHUB_PROXY || env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy || systemProxy(),
});
