import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonStateWriter, readJsonState, readJsonStateSync } from "../server/state/json-state-file.mjs";

const withDirectory = async (run) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-json-state-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

test("treats missing and corrupt state files as no saved state", async () => {
  await withDirectory(async (root) => {
    const file = path.join(root, "state.json");
    assert.deepEqual(await readJsonState(file, { fallback: true }), { fallback: true });
    await fs.writeFile(file, "{ truncated", "utf8");
    assert.deepEqual(await readJsonState(file, { fallback: true }), { fallback: true });
    assert.deepEqual(readJsonStateSync(file, { fallback: true }), { fallback: true });
    await fs.writeFile(file, "null", "utf8");
    assert.deepEqual(await readJsonState(file), {});
  });
});

test("writes in call order, atomically, and leaves no temporary files", async () => {
  await withDirectory(async (root) => {
    const file = path.join(root, "nested", "state.json");
    const writer = createJsonStateWriter(file);
    const writes = Array.from({ length: 25 }, (_, index) => writer.write({ index }));
    await Promise.all(writes);
    await writer.flush();

    assert.deepEqual(await readJsonState(file), { index: 24 });
    assert.deepEqual(await fs.readdir(path.dirname(file)), ["state.json"]);
  });
});

test("keeps accepting writes after one of them fails", async () => {
  await withDirectory(async (root) => {
    const blocker = path.join(root, "blocked");
    await fs.writeFile(blocker, "a file where a directory is needed", "utf8");
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(message);
    try {
      const broken = createJsonStateWriter(path.join(blocker, "state.json"), { label: "test-state" });
      await assert.rejects(broken.write({ value: 1 }));
      await broken.flush();
      await assert.rejects(broken.write({ value: 2 }));
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /\[test-state\] state persistence failed/u);
  });
});
