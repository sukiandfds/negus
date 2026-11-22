import TOML from '@iarna/toml';
import { fileURLToPath } from 'node:url';
import { root } from '../../../scripts/negus-service-common.mjs';
export const cloudflareMcpArguments = () => ['-c', 'mcp_servers.negus_cloudflare=' + TOML.stringify.value({ command: process.execPath, args: [fileURLToPath(new URL('./cloudflare-mcp.mjs', import.meta.url))], env: { NEGUS_INSTALL_ROOT: root }, enabled: true, startup_timeout_sec: 20, tool_timeout_sec: 180 })];
