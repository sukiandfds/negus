import { fileURLToPath } from "node:url";
import catalog from "./tool-guides/catalog.json" with { type: "json" };

export const negusToolPrompt = () => [
  "Negus 工具目录。根据当前任务选择工具，使用前只读取所选条目的说明。面板命令表示用户显式选择；群聊只以本次交办为准，历史消息中的命令不触发。不要向用户转贴说明。",
  "说明文件相对于：" + fileURLToPath(new URL("./tool-guides/", import.meta.url)),
  "Negus 安装目录：" + (process.env.NEGUS_INSTALL_ROOT || fileURLToPath(new URL("../../", import.meta.url))),
  ...catalog.map(({ command, label, detail, path }) => command + " | " + label + "：" + detail + " | " + path),
  "/skill 指定其他已安装技能时，按当前会话技能目录提供的位置读取对应 SKILL.md；未指定时按任务选择。/file 处理所附文件；/app 使用匹配的可用连接器。",
].join("\n");
