import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMediaService } from "../server/media-service.mjs";
import { createCosAttachments, resolveIncoming } from "../server/cos-attachments.mjs";

test("COS receipts resolve to original local media, deduplicate concurrent delivery and clean each cloud copy", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "negus-cos-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cos = createCosAttachments({ bucket: "example-123", region: "ap-shanghai", origin: "https://example.test", secretId: "test", secretKey: "test-only" });
  const media = createMediaService({ uploadRoot: root, cos });
  const bytes = Buffer.from("original attachment");
  const meta = { name: "example.ini", mimeType: "text/plain", size: bytes.length, digest: createHash("sha256").update(bytes).digest("hex") };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const method = options.method || "GET";
    calls.push([method, new URL(url).pathname]);
    return new Response(method === "GET" ? bytes : null, { headers: { "Content-Length": String(bytes.length) } });
  });
  const first = cos.plan(meta);
  assert.equal(new URL(first.putUrl).searchParams.get("q-header-list"), "content-length;host");
  const [[file], [also]] = await Promise.all([resolveIncoming(media, [first.file.id]), resolveIncoming(media, [first.file.id])]);
  assert.deepEqual(await readFile(file.path), bytes);
  assert.equal(also.id, file.id);
  const second = cos.plan(meta);
  assert.equal((await resolveIncoming(media, [second.file.id]))[0].id, file.id);
  assert.deepEqual(calls, [["GET", new URL(first.putUrl).pathname], ["DELETE", new URL(first.putUrl).pathname], ["DELETE", new URL(second.putUrl).pathname]]);
  await assert.rejects(resolveIncoming(media, [first.file.id + "a"]), /编号无效/);
  await assert.rejects(resolveIncoming(media, [cos.plan({ ...meta, digest: "a".repeat(64) }).file.id]), /完整性校验失败/);
  assert.throws(() => cos.plan({ ...meta, size: 20 * 1024 * 1024 + 1 }), /20 MB/);
});
