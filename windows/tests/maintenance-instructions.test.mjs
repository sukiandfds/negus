import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadUserProfilePrompt } from "../server/user-profile-prompt.mjs";
import { employeeTurnInstructions } from "../server/employee-definitions.mjs";
import { maintenanceInstructions } from "../server/maintenance-instructions.mjs";
test("maintenance instructions reach new deployments without a user profile and survive profile truncation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-prompt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const missing = await loadUserProfilePrompt(root);
  assert.match(missing, /negus_service_maintenance/);
  assert.ok(!missing.includes(JSON.stringify(root)), "user project is not the Negus installation");
  await fs.writeFile(path.join(root, "USER_PROFILE.md"), "用户偏好" + "x".repeat(13000));
  const full = await loadUserProfilePrompt(root);
  assert.match(full, /用户偏好/);
  assert.match(full, /runtime\/negus-backend-result.json/);
  assert.equal(full.split("<negus_service_maintenance>").length, 2);
});
test("employee and group instruction builder preserves role and context and includes maintenance rules", () => {
  const prompt = employeeTurnInstructions("角色职责", "本轮上下文");
  assert.match(prompt, /角色职责/);
  assert.match(prompt, /本轮上下文/);
  assert.match(prompt, /negus_service_maintenance/);
  assert.match(prompt, /scheduled 仅代表已安排/);
});
test("maintenance instructions identify host platform and keep unsupported recovery explicit", () => {
  const mac = maintenanceInstructions({ platform: "darwin", root: "/apps/Negus" });
  assert.match(mac, /node scripts\/negus.mjs rebuild/);
  assert.match(mac, /连续失败3次后恢复/);
  const windows = maintenanceInstructions({ platform: "win32" });
  assert.match(windows, /restart-web-demo.ps1/);
  assert.doesNotMatch(windows, /node scripts\/negus-supervisor.mjs restart/);
  assert.match(maintenanceInstructions({ platform: "linux" }), /系统自动恢复未适配/);
});
