import test from "node:test";
import assert from "node:assert/strict";
import TOML from "@iarna/toml";
import path from "node:path";
import { imageMcpArguments, imageInstructions } from "../server/image-generation/image-runtime.mjs";
import { employeeTurnInstructions } from "../server/employee-definitions.mjs";
import { loadUserProfilePrompt } from "../server/user-profile-prompt.mjs";

test("MCP overrides use absolute paths and contain no credentials", () => {
  const args = imageMcpArguments();
  const config = TOML.parse(args.filter((_, index) => index % 2).join("\n")).mcp_servers.negus_image;
  assert.ok(path.isAbsolute(config.command));
  assert.ok(path.isAbsolute(config.args[0]));
  assert.ok(path.isAbsolute(config.cwd));
  assert.deepEqual(config.enabled_tools, ["generate_image", "edit_image"]);
  assert.deepEqual(Object.keys(config.env).sort(), ["NEGUS_FAST_IMAGE_MODEL", "NEGUS_IMAGE_OUTPUT_DIR", "NEGUS_IMAGE_PROVIDER_MODE", "NEGUS_INSTALL_ROOT"]);
  assert.equal(config.env.NEGUS_IMAGE_PROVIDER_MODE, process.env.NEGUS_IMAGE_PROVIDER_MODE || "flare");
  assert.equal(config.env.NEGUS_FAST_IMAGE_MODEL, process.env.NEGUS_FAST_IMAGE_MODEL || "gpt-image-2.5-flare");
});
test("ordinary and employee instructions share the same image policy", async () => {
  assert.ok((await loadUserProfilePrompt("/nonexistent-negus-test-root")).includes(imageInstructions()));
  assert.ok(employeeTurnInstructions("employee").includes(imageInstructions()));
});
