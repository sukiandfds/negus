import fs from "node:fs/promises";
import path from "node:path";
import { normalizeImageModelSize } from "./image-contract.mjs";

const defaultBaseUrl = "https://api.happyevering.xyz/v1";
const defaultModel = "gpt-image-2.5-flare";

const dimensionsFromDataUrl = (url) => {
  if (!url.startsWith("data:image/png")) return {};
  try {
    const comma = url.indexOf(",");
    const bytes = Buffer.from(url.slice(comma + 1), "base64");
    if (bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } catch {}
  return {};
};

const providerError = (status, body) => {
  const code = body?.error?.code || body?.code || "";
  const message = body?.error?.message || body?.message || `HTTP ${status}`;
  return new Error(`Fast image request failed (${status}${code ? `, ${code}` : ""}): ${message}`);
};

const normalizeRequestSize = (value, model) => {
  const text = String(value || "").trim();
  const resolutionRatio = /^(1K|2K|4K):(.+)$/iu.exec(text);
  if (!resolutionRatio || !/^gpt-image-2\.5-(?:sunburst|flare)$/u.test(model || "")) return value;
  return normalizeImageModelSize(resolutionRatio[2], resolutionRatio[1].toUpperCase(), model);
};

const jsonResponse = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(response.status, body);
  return body;
};

const outputFromBody = (body) => {
  const found = new Map();
  const add = (url, value = {}, parent = {}) => {
    if (typeof url !== "string") return;
    const normalized = url.startsWith("data:image/") || /^https?:\/\//u.test(url) ? url : `data:image/png;base64,${url}`;
    found.set(normalized, {
      url: normalized,
      mimeType: value.mimeType || parent.mimeType || (normalized.startsWith("data:image/") ? normalized.slice(5, normalized.indexOf(";")) : "image/png"),
      width: value.width || parent.width || dimensionsFromDataUrl(normalized).width,
      height: value.height || parent.height || dimensionsFromDataUrl(normalized).height,
    });
  };
  const visit = (value, parent = {}) => {
    if (Array.isArray(value)) { value.forEach((item) => visit(item, parent)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === "url" || key === "image_url" || key === "imageUrl") && typeof child === "string") {
        add(child, value, parent);
      } else if (key === "b64_json" && typeof child === "string") {
        add(child, value, parent);
      } else if (child && typeof child === "object") visit(child, value);
    }
  };
  visit(body);
  return [...found.values()];
};

const readSse = async (response) => {
  if (!response.body) throw new Error("Fast image stream returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const data = frame.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data);
        if (payload?.error) throw new Error(payload.error.message || "Fast image stream failed");
        // The provider has returned both a top-level URL event and OpenAI-shaped
        // completion events with the final URL nested under data[].
        if (payload?.url || outputFromBody(payload).length || payload?.type === "image_generation.completed") final = payload;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!final) throw new Error("Fast image stream ended without a final URL");
  return final;
};

export const createFastImageClient = ({
  apiKey = process.env.NEGUS_IMAGE_API_KEY || process.env.LYNN_IMAGE_API_KEY || "",
  baseUrl = process.env.NEGUS_IMAGE_BASE_URL || process.env.LYNN_IMAGE_BASE_URL || defaultBaseUrl,
  model = process.env.NEGUS_FAST_IMAGE_MODEL || defaultModel,
  timeoutMs = Number(process.env.NEGUS_FAST_IMAGE_TIMEOUT_MS || 300_000),
  outputDirectory = process.env.NEGUS_IMAGE_OUTPUT_DIR || "",
  fetchImpl = fetch,
} = {}) => {
  const root = baseUrl.replace(/\/+$/u, "");
  const call = async (endpoint, init) => {
    if (!apiKey.trim()) throw new Error("NEGUS_IMAGE_API_KEY is not configured");
    const response = await fetchImpl(`${root}${endpoint}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")
      ? readSse(response)
      : jsonResponse(response);
  };

  const finish = async (body, startedAt, responseAt, prefix = "generated") => {
    const outputs = body?.url ? [body] : outputFromBody(body);
    if (!outputs.length) throw new Error(body?.error?.message || body?.message || "Provider returned no image URL");
    const outputsWithPaths = outputs.map(({ url, mimeType, width, height }, index) => ({
      url,
      mimeType,
      ...(outputDirectory ? { path: path.join(outputDirectory, `${prefix}-${Date.now()}${outputs.length > 1 ? `-${index + 1}` : ""}.png`) } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    }));
    for (const output of outputsWithPaths) {
      if (!output.path) continue;
      if (output.url.startsWith("data:")) {
        await materializeWithRetry(output.url, output.path).catch((error) => {
          process.stderr.write(`[negus-image] background_save_failed path=${output.path} error=${error.message}\n`);
        });
      } else void materializeWithRetry(output.url, output.path).catch((error) => {
        process.stderr.write(`[negus-image] background_save_failed path=${output.path} error=${error.message}\n`);
      });
    }
    return {
      model: body.model || model,
      outputs: outputsWithPaths,
      usage: body.usage || null,
      timings: { provider_response_ms: responseAt - startedAt },
    };
  };

  const generate = async ({ prompt, size, n = 1, quality, targetSize, stream = false, model: selectedModel } = {}) => {
    const startedAt = Date.now();
    const requestModel = selectedModel || model;
    const body = await call("/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: requestModel, prompt, size: normalizeRequestSize(size, requestModel), target_size: targetSize, n, quality, response_format: "url", ...(stream ? { stream: true } : {}) }),
    });
    return finish(body, startedAt, Date.now(), "generated");
  };

  const edit = async ({ prompt, imagePaths, size, n = 1, quality, targetSize, maskPath, stream = false, model: selectedModel } = {}) => {
    const startedAt = Date.now();
    const requestModel = selectedModel || model;
    const form = new FormData();
    for (const [key, value] of Object.entries({ model: requestModel, prompt, size: normalizeRequestSize(size, requestModel), target_size: targetSize, n, quality, response_format: "url", ...(stream ? { stream: true } : {}) })) {
      if (value !== undefined && value !== "") form.append(key, String(value));
    }
    for (const imagePath of imagePaths || []) form.append("image", new Blob([await fs.readFile(imagePath)]), path.basename(imagePath));
    if (maskPath) form.append("mask", new Blob([await fs.readFile(maskPath)], { type: "image/png" }), path.basename(maskPath));
    const body = await call("/images/edits", { method: "POST", body: form });
    return finish(body, startedAt, Date.now(), "edited");
  };

  const materialize = async (url, outputPath) => {
    const startedAt = Date.now();
    let bytes;
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      if (comma < 0) throw new Error("Fast image data URL is invalid");
      bytes = Buffer.from(url.slice(comma + 1), url.slice(0, comma).endsWith(";base64") ? "base64" : "utf8");
    } else {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Fast image download failed: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes, { flag: "wx" });
    return { path: outputPath, bytes: bytes.length, materialize_ms: Date.now() - startedAt };
  };

  const materializeWithRetry = async (url, outputPath) => {
    const attempts = Math.max(1, Number(process.env.NEGUS_IMAGE_SAVE_RETRIES || 3));
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try { return await materialize(url, outputPath); } catch (error) {
        lastError = error;
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 150 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  };

  return { generate, edit, materialize };
};
