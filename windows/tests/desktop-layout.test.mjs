import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "../../web-ui/node_modules/typescript/lib/typescript.js";
const source = await fs.readFile(new URL("../../web-ui/src/features/desktop/desktopLayout.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { clampRect, placeTile, overlaps, rectFromPoints, validTiles, replyForTile, defaultTiles, migrateDesktopTiles } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
test("selection maps to same logical cells on phone and large screen, including reverse drag", () => {
  assert.deepEqual(rectFromPoints({ x: 180, y: 320 }, { x: 360, y: 448 }, 360), rectFromPoints({ x: 1080, y: 448 }, { x: 540, y: 320 }, 1080));
});
test("moving and resizing clamp to content bounds", () => {
  assert.deepEqual(clampRect({ x: -9, y: -5, w: 40, h: 0 }), { x: 0, y: 0, w: 12, h: 2 });
  assert.deepEqual(clampRect({ x: 9, y: 2, w: 6, h: 8 }), { x: 6, y: 2, w: 6, h: 8 });
  assert.equal(placeTile(defaultTiles, { ...defaultTiles[0], h: 4 })[0].h, 8, "task card keeps room for three rows");
});

test("small drawn regions keep their size and survive persisted layout validation", () => {
  const rect = rectFromPoints({ x: 240, y: 320 }, { x: 300, y: 384 }, 360);
  assert.deepEqual(rect, { x: 8, y: 10, w: 2, h: 2 });
  assert.ok(validTiles([{ ...rect, id: "small", kind: "content", title: "小区域" }]));
});
test("collision pushes neighbors without changing their data or mutating old layout", () => {
  const before = [...defaultTiles, { id: "note", kind: "content", title: "笔记", x: 6, y: 0, w: 6, h: 8 }];
  const next = placeTile(before, { ...before[1], w: 12 });
  assert.equal(next.find((item) => item.id === "current-tasks").y, 8);
  assert.equal(before[0].y, 0);
  assert.ok(!overlaps(next[0], next[1]));
});
test("corrupt cached coordinates, duplicate IDs and malformed requests are rejected", () => {
  assert.ok(validTiles(defaultTiles));
  assert.ok(!validTiles([{ ...defaultTiles[0], x: 9 }]));
  assert.ok(!validTiles([...defaultTiles, ...defaultTiles]));
  assert.ok(!validTiles([{ ...defaultTiles[0], request: {} }]));
});
const tile = { ...defaultTiles[0], request: { threadId: "thread", text: "request", after: ["old"], state: "waiting" } };
const messages = [{ id: "old", role: "user", text: "request" }, { id: "a0", role: "assistant", text: "old answer" }, { id: "new", role: "user", text: "request" }, { id: "a1", role: "assistant", text: "new answer" }];
test("region binds only its exact request and thread, never an old matching prompt", () => {
  assert.equal(replyForTile(tile, "thread", messages).id, "a1");
  assert.equal(replyForTile(tile, "other", messages), null);
  assert.equal(replyForTile(tile, "thread", messages.slice(0, 2)), null);
});
test("later user turns and superseded assistant responses cannot replace region result", () => {
  assert.equal(replyForTile(tile, "thread", [...messages, { id: "u2", role: "user", text: "other" }, { id: "a2", role: "assistant", text: "other answer" }]).id, "a1");
  assert.equal(replyForTile(tile, "thread", messages.map((message) => message.id === "a1" ? { ...message, superseded: true } : message)), null);
});

test("pinned tiles keep geometry even when a neighboring tile moves into them", () => {
  const pinned = { ...defaultTiles[0], pinned: true };
  const other = { id: "other", kind: "automations", title: "自动化任务", x: 6, y: 0, w: 6, h: 8 };
  assert.deepEqual(placeTile([pinned, other], { ...other, x: 0 }), [pinned, other]);
  assert.deepEqual(placeTile([pinned, other], { ...pinned, y: 8 }), [pinned, other]);
  assert.equal(placeTile([pinned, other], { ...pinned, pinned: false })[0].pinned, false);
});

test("only the requested legacy automation region is upgraded, unrelated content is preserved", () => {
  const region = { id: "region", kind: "content", title: "选区 1", x: 6, y: 0, w: 6, h: 8, preview: { role: "assistant", text: "自动化说明" } };
  assert.equal(migrateDesktopTiles([region])[0].kind, "automations");
  assert.equal(migrateDesktopTiles([{ ...region, preview: { role: "assistant", text: "图片" } }])[0].kind, "content");
  assert.equal(migrateDesktopTiles([{ ...region, x: 0 }])[0].kind, "content");
});
