import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const sha = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
const mac = (algorithm, key, value) => createHmac(algorithm, key).update(value).digest("hex");
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export function loadCosAttachments() {
  let config;
  try {
    config = JSON.parse(readFileSync(process.env.NEGUS_COS_CONFIG || path.join(os.homedir(), ".config/negus/cos-uploads.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return createCosAttachments(config);
}

export function createCosAttachments({ bucket, region, origin, secretId, secretKey }) {
  if (!/^[a-z0-9-]+-\d+$/.test(bucket) || !/^ap-[a-z0-9-]+$/.test(region) ||
      !secretId || !secretKey || new URL(origin).origin !== origin) throw Error("COS 附件配置无效");
  const host = bucket + ".cos." + region + ".myqcloud.com";
  const jobs = new Map();
  function signed(method, key, size) {
    const now = Math.floor(Date.now() / 1000);
    const span = (now - 60) + ";" + (now + 900);
    const headers = size ? "content-length;host" : "host";
    const values = (size ? "content-length=" + size + "&" : "") + "host=" + host;
    const pathname = "/negus/drafts/" + key;
    const request = [method.toLowerCase(), pathname, "", values, ""].join("\n");
    const sig = mac("sha1", mac("sha1", secretKey, span), ["sha1", span, sha("sha1", request), ""].join("\n"));
    return "https://" + host + pathname + "?" + new URLSearchParams({
      "q-sign-algorithm": "sha1", "q-ak": secretId, "q-sign-time": span, "q-key-time": span,
      "q-header-list": headers, "q-url-param-list": "", "q-signature": sig,
    });
  }
  function plan({ name, mimeType, size, digest }) {
    if (!Number.isSafeInteger(size) || size < 1 || size > 20 * 1024 * 1024 ||
        typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) ||
        typeof name !== "string" || !name || name.length > 255 || typeof mimeType !== "string" || mimeType.length > 200)
      throw fail("附件信息无效或大小超过 20 MB");
    const key = randomUUID();
    const data = Buffer.from(JSON.stringify({ name, mimeType, size, digest, key, issued: Date.now() })).toString("base64url");
    const id = "cos." + data + "." + mac("sha256", secretKey, data);
    return { putUrl: signed("PUT", key, size), file: { name, mimeType, id, url: "/api/media/" + id } };
  }
  async function receive(id, media) {
    const [, data, signature, extra] = id.split(".");
    if (extra !== undefined || !data || !/^[a-f0-9]{64}$/.test(signature || "") ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(mac("sha256", secretKey, data)))) throw fail("附件编号无效");
    const meta = JSON.parse(Buffer.from(data, "base64url").toString());
    const local = media.findUpload(meta);
    const cleanup = () => { void fetch(signed("DELETE", meta.key), { method: "DELETE", signal: AbortSignal.timeout(10000) }).catch(() => {}); };
    if (local) {
      cleanup();
      return local;
    }
    if (Date.now() - meta.issued > 86400000) throw fail("附件已过期，请重新选择文件", 410);
    const result = await fetch(signed("GET", meta.key), { redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!result.ok || Number(result.headers.get("content-length")) !== meta.size) {
      await result.body?.cancel();
      throw fail("电脑取回附件失败，请重试发送", 502);
    }
    const file = await media.upload(result.body, meta);
    // The bucket lifecycle also expires abandoned uploads and retries cleanup after network failures.
    cleanup();
    return media.resolveMany([file.id])[0];
  }
  function resolve(id, media) {
    if (!jobs.has(id)) jobs.set(id, receive(id, media).finally(() => jobs.delete(id)));
    return jobs.get(id);
  }
  return { origin, plan, resolve };
}

export async function resolveIncoming(media, ids) {
  const keys = [...new Set(Array.isArray(ids) ? ids : [])].slice(0, 6);
  if (!keys.some(id => typeof id === "string" && id.startsWith("cos."))) return media.resolveMany(keys);
  return (await Promise.all(keys.map(id => {
    if (typeof id !== "string" || !id.startsWith("cos.")) return media.resolveMany([id])[0];
    if (!media.cos) throw fail("电脑未配置云附件接收服务", 503);
    return media.cos.resolve(id, media);
  }))).filter(Boolean);
}
