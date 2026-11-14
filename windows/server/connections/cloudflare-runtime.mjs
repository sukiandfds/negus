import TOML from '@iarna/toml';
import { fileURLToPath } from 'node:url';
import { root } from '../../../scripts/negus-service-common.mjs';
export const cloudflareMcpArguments = () => ['-c', 'mcp_servers.negus_cloudflare=' + TOML.stringify.value({ command: process.execPath, args: [fileURLToPath(new URL('./cloudflare-mcp.mjs', import.meta.url))], env: { NEGUS_INSTALL_ROOT: root }, enabled: true, startup_timeout_sec: 20, tool_timeout_sec: 180 })];
export const cloudflareInstructions = () => 'Cloudflare 使用 negus_cloudflare 工具，服务器端连接在所有模型渠道及员工间共用。先 status 检查，再 discover 读取官方工具说明，随后 call 查询或执行用户明确要求的管理操作。尚未连接时引导用户打开设置 → 账号连接 → Cloudflare，不要求用户提交密钥或逐个模型登录。授权权限由 Cloudflare 决定；连接不等于用户批准任意写操作。';
