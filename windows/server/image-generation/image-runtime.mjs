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
