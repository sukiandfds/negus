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

export const githubInstructions = () => [
  'Negus 的 GitHub 能力在所有模型渠道和新建、恢复的对话中共用本机 GitHub CLI 登录。查询用户仓库（含私有仓库）优先使用 gh api user/repos 或 gh repo list；公开网页 read_url 不携带登录，不能据此判断没有私有仓库权限。',
  `Negus 自带工具目录：${JSON.stringify(githubBinDirectory)}。若 gh 报 command not found，先使用该目录下 gh（Windows 为 gh.exe）的完整路径，不得直接断言未安装或只能访问公开仓库。`,
  '执行环境提供 GH_CONFIG_DIR 和 NEGUS_GITHUB_PROXY。GitHub CLI 请求使用 NEGUS_GITHUB_PROXY 作为该命令的 HTTPS_PROXY；Git 请求通过 -c http.proxy 指定同一代理（变量为空则保留已有代理设置）。只为 GitHub 命令设置代理，不修改全局代理或供应商配置。',
  '使用现有登录，不读取或输出 token、私钥或凭据文件内容。认证失败、仓库无权限和网络失败应按实际错误分别报告。读取成功不代表获得写入授权，推送、删除等仍遵守用户授权范围。',
].join('\n');
