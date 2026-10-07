import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageInstallationRoot } from "./image-settings.mjs";

// Process-level overrides work across project directories and isolated CODEX_HOME profiles.
export const imageMcpArguments = () => {
  const settings = {
    command: process.execPath,
    args: [fileURLToPath(new URL("./mcp-server.mjs", import.meta.url))],
    cwd: imageInstallationRoot,
    enabled: true,
    required: false,
    enabled_tools: ["generate_image", "edit_image"],
    env: {
      NEGUS_INSTALL_ROOT: imageInstallationRoot,
      NEGUS_IMAGE_OUTPUT_DIR: path.join(imageInstallationRoot, "runtime/generated-images"),
      NEGUS_IMAGE_PROVIDER_MODE: process.env.NEGUS_IMAGE_PROVIDER_MODE || "flare",
      NEGUS_FAST_IMAGE_MODEL: process.env.NEGUS_FAST_IMAGE_MODEL || "gpt-image-2.5-flare",
    },
    startup_timeout_sec: 20,
    tool_timeout_sec: 900,
  };
  return Object.entries(settings).flatMap(([key, value]) => {
    const encoded = key === "env" ? "{ " + Object.entries(value).map(([name, v]) => name + " = " + JSON.stringify(v)).join(", ") + " }" : JSON.stringify(value);
    return ["-c", `mcp_servers.negus_image.${key}=${encoded}`];
  });
};

export const imageInstructions = () => [
  "Negus 图片能力：用户要求实际生成或编辑图片时，先查找 negus_image 的 generate_image / edit_image 工具（工具可能需要通过工具搜索发现）。",
  "工具使用 Negus 设置 → 图片生成中的供应商配置；不要因为内置 image_gen 不可用就要求 OPENAI_API_KEY，也不要改用 shell 自行调用供应商或读取密钥。",
  "只讨论图片或编写提示词时不生成。生成时保留用户要求，按明确比例、分辨率和数量传参；未指定数量为一张。IMAX 可能指 1.43:1 或 1.90:1，未明确且影响构图时先确认。分辨率与 quality 是不同参数，不擅自选择最高收费档位。",
  "有参考图或修改上次结果时使用 edit_image 并保留参考图顺序。成功结果会由 Negus 自动显示图片，不再输出本机路径作为下载链接，不重复调用。失败按真实工具错误说明；工具确实不可用时说明 Negus 图片工具未接入，不假称已生成，不自动重复付费提交。",
].join("\n");
