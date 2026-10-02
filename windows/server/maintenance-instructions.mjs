import path from "node:path";
import { fileURLToPath } from "node:url";

const installationRoot = process.env.NEGUS_INSTALL_ROOT ? path.resolve(process.env.NEGUS_INSTALL_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const maintenanceInstructions = ({ platform = process.platform, root = installationRoot } = {}) => [
  "<negus_service_maintenance>",
  "以下是 Negus 自带维护能力；仅当用户要求维护 Negus 本身时使用，不用于任意用户项目。",
  "Negus 安装目录：" + JSON.stringify(root) + "。命令必须在此目录执行；不要把当前业务项目目录误当作安装目录。",
  "运行主机平台：" + platform + "。以服务主机为准，不以用户浏览器所在设备为准。",
  platform === "darwin"
    ? "macOS：只读健康检查 node scripts/negus-watchdog.mjs check；恢复已退出的服务 node scripts/negus-watchdog.mjs recover；后端重启 node scripts/negus-supervisor.mjs restart；前端重新构建并发布 node scripts/negus.mjs rebuild；前端回退 node scripts/negus-frontend.mjs rollback。"
    : platform === "win32"
      ? "Windows：原有入口为 windows/scripts/restart-web-demo.ps1；执行前读取该脚本和 PROJECT.md 核实参数及限制。Mac 的自动检查与安全重启流程尚未适配 Windows，不得套用 Mac 安装命令或声称已有三次失败回退。"
      : "当前平台的系统自动恢复未适配；先核对 PROJECT.md 与维护说明，不直接套用 Mac/Windows 重启命令。",
  "只有用户授权重启、发布或恢复时才执行对应动作；普通检查用只读命令。用户已授权的范围内不重复确认。",
  "前后端分开：rebuild 只构建发布前端静态文件，不重启后端；后端源码修改需要后端重启。不要用直接清空线上 dist 的普通 build 代替在线前端发布。",
  "重启/发布脚本使用独立后台进程。收到 scheduled 仅代表已安排，记录返回的 workerPid；后端重启提交后及时结束本轮回复，不在本轮等待自身重启完成。",
  "脚本接手后连接可能短暂中断。恢复后查询 runtime/negus-backend-result.json 或 runtime/negus-frontend-result.json，并核对 action、at 与本次操作对应；旧结果不能证明本次成功。",
  "常规 restart 等待任务与队列收口；用户明确接受短暂断开或中断本轮时，可用 restart --handoff 交给独立脚本，15秒后接管旧进程。首次从旧部署升级须先 prepare --fallback-revision <已核对的基线提交>，隔离验证回退快照；缺少可恢复快照时不停止服务。不得绕过脚本直接杀 PID、杀端口或串联 stop/start。",
  "独立管理脚本保存源码、依赖和前端运行快照；新版本启动/健康校验连续失败3次后恢复已验证回退快照。旧进程无法确认退出时中止，不并发启动。此机制不回退业务数据，不保证供应商生成或所有业务功能正常；回退后仍需核对结果。",
  "前后端共用操作锁，分别执行；两者都更新时，先确认前端发布结果，再安排后端重启。不要并发提交维护。",
  "用 node scripts/negus-supervisor.mjs status 查询本次任务；详细行为、首次启用限制和日志见安装目录 docs/operations/NEGUS_SERVICE_CONTROL.md。报告区分已安排、成功、失败或回退，不输出 access-token、Key 或带令牌的日志。",
  "</negus_service_maintenance>",
].join("\n");
