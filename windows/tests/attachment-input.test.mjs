import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { inputFromAttachments } from "../server/app-server-conversation-store.mjs";
import { createMediaService } from "../server/media-service.mjs";

const pngHeader = (width, height) => {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  Buffer.from("IHDR").copy(buffer, 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

test("maps uploaded files to Codex native input types", async () => {
  const input = await inputFromAttachments("检查附件", [
    { name: "screen.png", mimeType: "image/png", path: "C:\\uploads\\screen.png" },
    { name: "voice.m4a", mimeType: "audio/mp4", path: "C:\\uploads\\voice.m4a" },
    { name: "notes.pdf", mimeType: "application/pdf", path: "C:\\uploads\\notes.pdf" },
  ]);

  assert.deepEqual(input.map((item) => item.type), ["text", "localImage", "localAudio"]);
  assert.match(input[0].text, /^# Files mentioned by the user:/u);
  assert.match(input[0].text, /## notes\.pdf: C:\\uploads\\notes\.pdf/u);
  assert.match(input[0].text, /## My request for Codex:\n\n检查附件$/u);
});

test("passes text attachments as local files without injecting their content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-readable-attachment-"));
  try {
    const file = path.join(root, "notes.md");
    await fs.writeFile(file, "可读取的附件正文", "utf8");
    const input = await inputFromAttachments("检查附件", [
      { name: "notes.md", mimeType: "text/markdown", path: file },
    ]);

    assert.deepEqual(input.map((item) => item.type), ["text"]);
    assert.match(input[0].text, new RegExp(`## notes\\.md: ${file.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
    assert.doesNotMatch(input[0].text, /可读取的附件正文/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("stores uploads inside the configured runtime directory and restores them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-upload-"));
  try {
    const media = createMediaService({ uploadRoot: root });
    const uploaded = await media.upload(Readable.from([Buffer.from("hello")]), { name: "notes.txt", mimeType: "text/plain" });
    const [entry] = media.resolveMany([uploaded.id]);
    assert.equal(entry.name, "notes.txt");
    assert.equal(await fs.readFile(entry.path, "utf8"), "hello");

    const restored = createMediaService({ uploadRoot: root });
    await restored.restoreUploads();
    assert.equal(restored.resolveMany([uploaded.id])[0].name, "notes.txt");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reuses the same stored upload for identical retry content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-upload-"));
  try {
    const media = createMediaService({ uploadRoot: root });
    const first = await media.upload(Readable.from([Buffer.from("same content")]), { name: "notes.txt", mimeType: "text/plain" });
    const retried = await media.upload(Readable.from([Buffer.from("same content")]), { name: "notes.txt", mimeType: "text/plain" });
    const files = await fs.readdir(root);

    assert.equal(retried.id, first.id);
    assert.equal(files.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("returns stable dimensions for uploaded and restored images", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-image-size-"));
  try {
    const media = createMediaService({ uploadRoot: root });
    const uploaded = await media.upload(Readable.from([pngHeader(1200, 800)]), { name: "photo.png", mimeType: "image/png" });

    assert.equal(uploaded.width, 1200);
    assert.equal(uploaded.height, 800);
    assert.match(uploaded.url, /\?w=1200&h=800$/u);

    const restored = createMediaService({ uploadRoot: root });
    await restored.restoreUploads();
    const restoredImage = restored.resolveMany([uploaded.id])[0];
    assert.equal(restoredImage.width, 1200);
    assert.equal(restoredImage.height, 800);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("drops a media entry after its uploaded file is removed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-upload-"));
  try {
    const media = createMediaService({ uploadRoot: root });
    const uploaded = await media.upload(Readable.from([Buffer.from("temporary")]), { name: "temp.txt", mimeType: "text/plain" });
    const [entry] = media.resolveMany([uploaded.id]);
    await fs.rm(entry.path, { force: true });

    assert.deepEqual(media.resolveMany([uploaded.id]), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
