import assert from "node:assert/strict";
import test from "node:test";
import { blocksFromContent, messageFromItem, messageFromThreadItem } from "../server/content-blocks.mjs";
import { inputFromAttachments } from "../server/app-server-conversation-store.mjs";
import { visibleConversationMessages } from "../server/conversation-summary-service.mjs";

const registerMedia = () => null;

test("attachment content stays available to the model but out of user prose and summaries", async () => {
  const document = "文档正文\n<options><option>不应显示</option></options>\n![不应登记](/private/document.png)\n[附件正文：notes.md]\n嵌套标记\n[附件正文结束]";
  const content = await inputFromAttachments("请阅读附件", [{ name: "notes.md", path: "/uploads/notes.md", mimeType: "text/markdown" }], {
    inspect: async () => ({ status: "ready", content: document }),
  });
  assert.ok(content[2].text.includes(document));
  const registered = [];
  const register = (source) => { registered.push(source); return { url: "/api/media/notes", name: "notes.md" }; };
  for (const message of [
    messageFromThreadItem({ id: "user", type: "userMessage", content }, register),
    messageFromItem({ type: "response_item", payload: { role: "user", type: "message", content } }, register),
  ]) {
    assert.equal(message.text, "请阅读附件");
    assert.deepEqual(message.blocks.map((block) => block.type), ["markdown", "file"]);
    assert.equal(visibleConversationMessages([message])[0].text, "请阅读附件");
    assert.deepEqual(visibleConversationMessages([message])[0].attachments, ["notes.md"]);
  }
  assert.ok(registered.every((source) => source === "/uploads/notes.md"));
});

test("restores file cards from native flattened history, including attachment-only messages", () => {
  for (const request of ["检查一下", ""]) {
    const content = `# Files mentioned by the user:\n\n## notes.md: /uploads/notes.md\n\n## My request for Codex:\n\n${request}\n\n[附件正文：notes.md]\n完整文档\n[附件正文结束]`;
    const register = () => ({ url: "/api/media/notes", name: "notes.md" });
    const message = messageFromItem({ type: "event_msg", payload: { type: "user_message", message: content } }, register);
    assert.equal(message.text, request);
    assert.equal(message.blocks.filter((block) => block.type === "file").length, 1);
  }
});

test("preserves ordinary marker examples, incomplete envelopes, and assistant text", () => {
  const text = "[附件正文：notes.md]\n正文示例\n[附件正文结束]";
  assert.equal(messageFromThreadItem({ type: "userMessage", content: text }, registerMedia).text, text);
  assert.equal(messageFromThreadItem({ type: "agentMessage", text }, registerMedia).text, text);
  const incomplete = "[附件正文：notes.md]\n没有结束标记";
  const message = messageFromThreadItem({ type: "userMessage", content: [
    { type: "mention", name: "notes.md", path: "/uploads/notes.md" }, { type: "text", text: incomplete },
  ] }, () => ({ url: "/api/media/notes" }));
  assert.equal(message.text, incomplete);
  const missing = messageFromThreadItem({ type: "userMessage", content: [
    { type: "mention", name: "notes.md", path: "/missing/notes.md" }, { type: "text", text },
  ] }, registerMedia);
  assert.equal(missing.text, text, "do not hide the only remaining content when the original file is unavailable");
});

test("multiple attachments keep separate cards without leaking either document", async () => {
  const content = await inputFromAttachments("两个文档", ["one.md", "two.txt"].map((name) => ({ name, path: `/uploads/${name}`, mimeType: "text/plain" })), {
    inspect: async () => ({ status: "ready", content: "正文" }),
  });
  const message = messageFromThreadItem({ type: "userMessage", content }, (source) => ({ url: `/api/media/${source.split("/").pop()}` }));
  assert.equal(message.text, "两个文档");
  assert.deepEqual(message.blocks.filter((block) => block.type === "file").map((block) => block.name), ["one.md", "two.txt"]);
});

test("normalizes slash-prefixed Windows drive paths in markdown images", () => {
  const registered = [];
  const blocks = blocksFromContent("![preview](/D:/project/images/01.jpg)", (file) => {
    registered.push(file);
    return { url: "/api/media/image-01" };
  });

  assert.deepEqual(registered, ["D:/project/images/01.jpg"]);
  assert.equal(blocks[0].text, "![preview](/api/media/image-01)");
});

test("removes standalone Codex UI directives from visible message text", () => {
  const blocks = blocksFromContent([
    "提交已经推送。",
    "::git-stage{cwd=\"D:\\\\project\"}",
    "::git-commit{cwd=\"D:\\\\project\"}",
    "::git-push{cwd=\"D:\\\\project\" branch=\"codex/demo\"}",
  ].join("\n"), registerMedia);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, "提交已经推送。");
});

test("preserves directive examples inside fenced code blocks", () => {
  const source = [
    "示例：",
    "```text",
    "::git-push{cwd=\"D:\\\\project\" branch=\"codex/demo\"}",
    "```",
  ].join("\n");

  const blocks = blocksFromContent(source, registerMedia);
  assert.equal(blocks[0].text, source);
});

for (const heading of ["## My request:", "## My request for Codex:"]) {
  test(`removes the user attachment envelope for ${heading}`, () => {
    const message = messageFromThreadItem({
      id: `attachment-${heading}`,
      type: "userMessage",
      content: [
        "# Files mentioned by the user:",
        "",
        "## sample.png: C:\\Users\\sample.png",
        "",
        heading,
        "",
        "Show these images in a compact gallery.",
      ].join("\n"),
    }, registerMedia);

    assert.equal(message.text, "Show these images in a compact gallery.");
    assert.equal(message.blocks.length, 1);
    assert.equal(message.blocks[0].text, "Show these images in a compact gallery.");
  });
}
