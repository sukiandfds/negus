import fs from "node:fs/promises";
import path from "node:path";

const defaultBaseUrl = "https://api.happyevering.xyz/v1";
const defaultModel = "gpt-image-2.5-flare";

const providerError = (status, body) => {
  const code = body?.error?.code || body?.code || "";
  const message = body?.error?.message || body?.message || `HTTP ${status}`;
  return new Error(`Fast image request failed (${status}${code ? `, ${code}` : ""}): ${message}`);
};

const jsonResponse = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(response.status, body);
  return body;
};

const outputFromBody = (body) => [...new Map((Array.isArray(body?.data) ? body.data : [])
  .map((item) => [item?.url, item])
  .filter(([url]) => typeof url === "string" && /^https?:\/\//u.test(url)))
  .values()];

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
        if (payload?.url || payload?.type === "image_generation.completed") final = payload;
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

  const finish = (body, startedAt, responseAt) => {
    const outputs = body?.url ? [body] : outputFromBody(body);
    if (!outputs.length) throw new Error(body?.error?.message || body?.message || "Provider returned no image URL");
    return {
      model: body.model || model,
      outputs: outputs.map(({ url, width, height }) => ({ url, width, height })),
      usage: body.usage || null,
      timings: { provider_response_ms: responseAt - startedAt },
    };
  };

  const generate = async ({ prompt, size, n = 1, quality, stream = false, model: selectedModel } = {}) => {
    const startedAt = Date.now();
    const body = await call("/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel || model, prompt, size, n, quality, response_format: "url", ...(stream ? { stream: true } : {}) }),
    });
    return finish(body, startedAt, Date.now());
  };

  const edit = async ({ prompt, imagePaths, size, n = 1, quality, stream = false, model: selectedModel } = {}) => {
    const startedAt = Date.now();
    const form = new FormData();
    for (const [key, value] of Object.entries({ model: selectedModel || model, prompt, size, n, quality, response_format: "url", ...(stream ? { stream: true } : {}) })) {
      if (value !== undefined && value !== "") form.append(key, String(value));
    }
    for (const imagePath of imagePaths || []) form.append("image", new Blob([await fs.readFile(imagePath)]), path.basename(imagePath));
    const body = await call("/images/edits", { method: "POST", body: form });
    return finish(body, startedAt, Date.now());
  };

  const materialize = async (url, outputPath) => {
    const startedAt = Date.now();
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Fast image download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes, { flag: "wx" });
    return { path: outputPath, bytes: bytes.length, materialize_ms: Date.now() - startedAt };
  };

  return { generate, edit, materialize };
};
