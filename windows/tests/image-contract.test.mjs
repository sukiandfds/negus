import assert from "node:assert/strict";
import test from "node:test";
import {
  modelForImageResolution,
  normalizeProviderImageSize,
  providerImageRequestFromArgs,
} from "../server/image-generation/image-contract.mjs";

test("normalizes decimal ratios and fullwidth colons into provider pixel sizes", () => {
  assert.equal(normalizeProviderImageSize("2.35：1", "4K"), "3840x1632");
  assert.equal(normalizeProviderImageSize("2.35:1", "2K"), "2560x1088");
  assert.equal(normalizeProviderImageSize("1：2.35", "1K"), "816x1920");
});

test("preserves provider aspect aliases and valid explicit pixel sizes", () => {
  assert.equal(normalizeProviderImageSize("16：9", "4K"), "16:9");
  assert.equal(normalizeProviderImageSize("3840×1632", "4K"), "3840x1632");
  assert.equal(normalizeProviderImageSize("", "4K"), undefined);
});

test("selects the matching provider model and infers resolution from model overrides", () => {
  assert.equal(modelForImageResolution("4K"), "gpt-image-2-4k");
  assert.deepEqual(providerImageRequestFromArgs({
    prompt: "cinematic landscape",
    resolution: "4K",
    size: "2.35：1",
    n: 1,
  }), {
    prompt: "cinematic landscape",
    model: "gpt-image-2-4k",
    size: "3840x1632",
    n: 1,
    quality: undefined,
    targetSize: undefined,
    aspectSourceImageIndex: undefined,
    outputDirectory: undefined,
    outputName: undefined,
  });
  assert.equal(providerImageRequestFromArgs({
    prompt: "cinematic landscape",
    model: "gpt-image-2-4k",
    size: "2.35:1",
  }).size, "3840x1632");
  assert.equal(providerImageRequestFromArgs({
    prompt: "preserve the third image ratio",
    aspect_source_image_index: 3,
  }).aspectSourceImageIndex, 3);
});

test("selects the image model from an explicit pixel size when resolution is omitted", () => {
  assert.equal(providerImageRequestFromArgs({ size: "3840x2160" }).model, "gpt-image-2-4k");
  assert.equal(providerImageRequestFromArgs({ size: "2160×3840" }).model, "gpt-image-2-4k");
  assert.equal(providerImageRequestFromArgs({ size: "2560x1440" }).model, "gpt-image-2-2k");
  assert.equal(providerImageRequestFromArgs({ size: "1920x1080" }).model, "gpt-image-2");
});

test("rejects malformed or out-of-range image sizes", () => {
  assert.throws(() => normalizeProviderImageSize("2.35", "4K"), /Unsupported image size/u);
  assert.throws(() => normalizeProviderImageSize("8192x1024", "4K"), /between 64 and 4096/u);
});


test("Sunburst preserves resolution on standard ratios and validates explicit dimensions", () => {
  const args = { model: "gpt-image-2.5-sunburst", resolution: "4K" };
  assert.equal(providerImageRequestFromArgs({ ...args, size: "16:9" }).size, "4K:16:9");
  assert.equal(providerImageRequestFromArgs({ ...args, size: "1.90:1" }).size, "3840x2016");
  const size = providerImageRequestFromArgs({ ...args, size: "1.43:1" }).size;
  const [w, h] = size.split("x").map(Number);
  assert.ok(w * h <= 8294400);
  assert.ok(Math.abs(w / h - 1.43) < .01);
  assert.equal(w % 16, 0);
  assert.throws(() => providerImageRequestFromArgs({ ...args, size: "3840x2688" }), /GPT Image 2.5/);
  assert.equal(providerImageRequestFromArgs({ ...args, quality: "max" }).quality, "max");
  assert.throws(() => providerImageRequestFromArgs({ model: "gpt-image-2", quality: "max" }), /质量档位/);
});
