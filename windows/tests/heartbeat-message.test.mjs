import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import ts from "../../ui-feishu/node_modules/typescript/lib/typescript.js";

const source = await fs.readFile(new URL("../../ui-feishu/shared/features/conversations/rendering/heartbeatMessage.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseHeartbeatUser, heartbeatAssistantText, QUIET_HEARTBEAT_TEXT } = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));

const instructions = "\u53ea\u6267\u884c\u56fa\u5b9a\u5de1\u68c0\u811a\u672c\u3002";
const userText = `<heartbeat>\r\n  <automation_id>negus</automation_id>\r\n  <current_time_iso>2026-09-22T09:02:05.816Z</current_time_iso>\r\n  <instructions>\r\n${instructions}\r\n  </instructions>\r\n</heartbeat>\r\n`;

test("renders a scheduled-task trigger as its instructions", () => {
  const parsed = parseHeartbeatUser(userText);
  assert.equal(parsed?.automationId, "negus");
  assert.equal(parsed?.currentTimeIso, "2026-09-22T09:02:05.816Z");
  assert.equal(parsed?.instructions, instructions);
  assert.equal(parseHeartbeatUser("please <heartbeat><instructions>x</instructions></heartbeat>"), null);
});

test("renders an assistant heartbeat as the visible result", () => {
  const status = "\u670d\u52a1\u548c\u516c\u7f51\u94fe\u63a5\u6b63\u5e38\uff0c\u65e0\u9700\u64cd\u4f5c\u3002";
  const quiet = `<heartbeat><automation_id>negus</automation_id><decision>DONT_NOTIFY</decision><message>${status}</message></heartbeat>`;
  assert.equal(heartbeatAssistantText(quiet), status);
  assert.equal(heartbeatAssistantText("<heartbeat><decision>DONT_NOTIFY</decision><message></message></heartbeat>"), QUIET_HEARTBEAT_TEXT);
  assert.equal(heartbeatAssistantText("\u9700\u8981\u5904\u7406\u3002\n\n```xml\n<heartbeat><decision>NOTIFY</decision><message>hidden</message></heartbeat>\n```"), "\u9700\u8981\u5904\u7406\u3002");
  assert.equal(heartbeatAssistantText("<heartbeat><decision>NOTIFY</decision><message><![CDATA[\u8bf7\u67e5\u770b\u670d\u52a1]]></message></heartbeat>"), "\u8bf7\u67e5\u770b\u670d\u52a1");
  assert.equal(heartbeatAssistantText("<heartbeat><decision>DONT_NOTIFY</decision><message>\u68c0\u67e5\u4e2d</message>"), "\u68c0\u67e5\u4e2d");
  assert.equal(heartbeatAssistantText("<heartbeat><decision>DONT_NOTIFY</decision><message>\u68c0\u67e5\u4e2d"), "");
  assert.equal(heartbeatAssistantText("<heartbeat><decision>DONT_NOTIFY</decision>"), "");
  assert.equal(heartbeatAssistantText("ordinary reply"), null);
});
