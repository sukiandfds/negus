import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import TOML from '@iarna/toml';
import { fileURLToPath } from 'node:url';
export const installRoot = process.env.NEGUS_INSTALL_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const helperPath = path.join(installRoot, 'runtime/Negus Computer.app/Contents/MacOS/NegusComputer');
export const nativeComputerMcpArguments = ({configFile = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml')} = {}) => {
  // Reuse the user's installed desktop runtime without copying provider auth or plugins.
  // Isolated model-provider homes otherwise lose the host's computer-use MCP.
  try {
    const settings = TOML.parse(fs.readFileSync(configFile, 'utf8')).mcp_servers?.node_repl;
    if (!settings || settings.enabled === false || !path.isAbsolute(settings.command || '') || !fs.existsSync(settings.command)
      || !settings.env?.SKY_CUA_SERVICE_PATH || !fs.existsSync(settings.env.SKY_CUA_SERVICE_PATH)) return [];
    return ['-c', `mcp_servers.node_repl=${TOML.stringify.value(settings)}`];
  } catch { return []; }
};
export const computerMcpArguments = () => {
  const settings = { command: process.execPath, args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))], cwd: installRoot,
    env: { NEGUS_INSTALL_ROOT: installRoot },
    enabled: true, required: false, startup_timeout_sec: 20, tool_timeout_sec: 60 };
  return Object.entries(settings).flatMap(([key,value]) => ['-c', `mcp_servers.negus_computer.${key}=${key === 'env' ? '{ NEGUS_INSTALL_ROOT = ' + JSON.stringify(installRoot) + ' }' : JSON.stringify(value)}`]);
};
