import test from "node:test";
import assert from "node:assert/strict";
import { conversationPrompt } from "../server/conversation-prompt.mjs";
import { readFileSync } from "node:fs";
const manual = readFileSync(new URL("../server/tool-guides/maintenance/SKILL.md", import.meta.url), "utf8");
test("the shared prefix lists maintenance without preloading its commands", () => {
  const prompt = conversationPrompt("角色职责", "本轮上下文");
  assert.match(prompt, /maintenance\/SKILL.md/);
  assert.match(prompt, /角色职责/);
  assert.match(prompt, /本轮上下文/);
  assert.doesNotMatch(prompt, /gh api user\/repos|scheduled 仅代表已安排/);
  assert.match(prompt, /::file\{path="文件的服务器绝对路径"\}/);
});
test("employee replies use the unconditional prohibited-wording ban and answer the latest question first", () => {
  const prompt = conversationPrompt("角色职责");
  assert.match(prompt, /任何最终回复都严禁使用.*本条不设例外/u);
  assert.match(prompt, /第一句必须直接回答用户最后一条问题/u);
  assert.match(prompt, /原始任务停在技术修复，质量复核后继续发布/u);
});
test("maintenance instructions identify host platform and keep unsupported recovery explicit", () => {
  assert.match(manual, /macOS：.*node scripts\/negus.mjs rebuild/);
  assert.match(manual, /连续失败3次后恢复/);
  assert.match(manual, /Windows：.*restart-web-demo.ps1/);
  assert.match(manual, /系统自动恢复未适配/);
});
