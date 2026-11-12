import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const cookieName = "codex_demo_token";
const cookieMaxAgeSeconds = 30 * 24 * 60 * 60;
export const minimumStrongTokenLength = 16;

const sameSecret = (candidate, token) => {
  const left = Buffer.from(String(candidate ?? ""), "utf8");
  const right = Buffer.from(token, "utf8");
  // timingSafeEqual needs equal lengths; comparing the token with itself keeps
  // the amount of work independent of how close a guess is.
  return left.length === right.length ? timingSafeEqual(left, right) : !timingSafeEqual(right, right);
};

const cookieToken = (request) => {
  for (const cookie of String(request.headers.cookie || "").split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== cookieName) continue;
    const value = cookie.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
};

// Tunnels and reverse proxies connect from loopback, so the real client is
// only visible in the forwarding headers they add.
const clientAddress = (request) => String(
  request.headers["cf-connecting-ip"]
  || String(request.headers["x-forwarded-for"] || "").split(",")[0]
  || request.socket?.remoteAddress
  || "unknown",
).trim();

export const authorized = (request, url, token) => sameSecret(url.searchParams.get("token"), token)
  || sameSecret(cookieToken(request), token);

export const rememberAuthorizedDevice = (request, response, url, token) => {
  if (!sameSecret(url.searchParams.get("token"), token)) return;
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  const secure = forwardedProto === "https" || Boolean(request.socket?.encrypted);
  const attributes = [
    `${cookieName}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${cookieMaxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  response.setHeader("Set-Cookie", attributes.join("; "));
};

// Slows down token guessing. Only requests that present a wrong credential
// count; a request with no credential at all is simply unauthorised. The
// window is short so someone whose saved link went stale after a token change
// is not locked out for long once they open the new link.
export const createAccessGuard = ({
  token, maxFailures = 10, windowMs = 60 * 1000, maxTrackedClients = 2000, now = () => Date.now(),
}) => {
  const failures = new Map();

  // Returns { allowed } and, when refused, the HTTP status to answer with.
  const check = (request, url) => {
    const address = clientAddress(request);
    let record = failures.get(address);
    if (record && now() - record.startedAt >= windowMs) {
      failures.delete(address);
      record = undefined;
    }
    if (record && record.count >= maxFailures) {
      return { allowed: false, status: 429, retryAfterSeconds: Math.ceil((record.startedAt + windowMs - now()) / 1000) };
    }
    if (authorized(request, url, token)) return { allowed: true };
    if (url.searchParams.has("token") || cookieToken(request)) {
      if (record) record.count += 1;
      else failures.set(address, { count: 1, startedAt: now() });
      while (failures.size > maxTrackedClients) failures.delete(failures.keys().next().value);
    }
    return { allowed: false, status: 401 };
  };

  return { check };
};

// The access link must stay valid across restarts (it is saved on phones and
// installed PWAs), so a generated token is stored next to the other runtime
// state instead of being re-rolled on every start.
export const resolveAccessToken = ({ explicitToken = "", tokenFile = "" } = {}) => {
  const explicit = String(explicitToken || "").trim();
  if (explicit) return { token: explicit, source: "argument" };
  if (tokenFile) {
    try {
      const stored = fs.readFileSync(tokenFile, "utf8").trim();
      if (stored.length >= minimumStrongTokenLength) return { token: stored, source: "file" };
    } catch {}
  }
  const token = randomBytes(24).toString("base64url");
  if (tokenFile) {
    try {
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
      fs.writeFileSync(tokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.warn(`[access-control] access token could not be saved: ${error.message}`);
    }
  }
  return { token, source: "generated" };
};
