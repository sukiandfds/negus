import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { sendJson } from "./request-utils.mjs";

// Synchronous busy-check + lease acquisition prevents a new HTTP task entering
// between the idle decision and admission closure. No persistent lifecycle state.
export const createMaintenanceGate = ({ projectRoot, isBusy, pid = process.pid, now = Date.now }) => {
  const pending = new Set();
  let expiresAt = 0;
  const keyFile = path.join(projectRoot, "runtime", "maintenance-key");
  const localAuthorized = (request) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket?.remoteAddress)) return false;
    try {
      const expected = Buffer.from(fs.readFileSync(keyFile, "utf8").trim());
      const received = Buffer.from(String(request.headers["x-negus-maintenance-key"] || ""));
      return expected.length >= 32 && expected.length === received.length && timingSafeEqual(expected, received);
    } catch { return false; }
  };
  const busy = () => { try { return pending.size > 0 || isBusy(); } catch { return true; } };
  const handle = (request, response, url) => {
    if (url.pathname === "/api/maintenance") {
      if (!localAuthorized(request)) { sendJson(response, { error: "Local maintenance authorization required." }, 403); return true; }
      const isDraining = expiresAt > now();
      if (request.method === "DELETE") expiresAt = 0;
      else if (request.method === "POST") {
        if (url.searchParams.get("interrupt") !== "1" && busy()) { sendJson(response, { protocol: 1, pid, busy: true, draining: isDraining }, 409); return true; }
        expiresAt = now() + 60000;
      } else if (request.method !== "GET") {
        sendJson(response, { error: "Method not allowed" }, 405); return true;
      }
      sendJson(response, { protocol: 1, pid, root: projectRoot, busy: busy(), draining: expiresAt > now() });
      return true;
    }
    if (expiresAt > now() && url.pathname.startsWith("/api/")) {
      response.setHeader("Retry-After", "5");
      sendJson(response, { error: "服务正在安全重启，请稍后重试。" }, 503);
      return true;
    }
    // Track both async reads (some resolve/create runtime bindings) and writes.
    // The long-lived event stream does not start work and must not block draining.
    if (url.pathname.startsWith("/api/")) {
      pending.add(request);
    }
    return false;
  };
  handle.release = (request) => pending.delete(request);
  return handle;
};
