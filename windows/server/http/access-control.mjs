import { timingSafeEqual } from "node:crypto";

const cookieName = "codex_demo_token";

const sameSecret = (candidate, token) => {
  const left = Buffer.from(String(candidate ?? ""), "utf8");
  const right = Buffer.from(String(token), "utf8");
  // timingSafeEqual needs equal lengths; comparing the token with itself keeps
  // the amount of work independent of how close a guess is.
  return left.length === right.length ? timingSafeEqual(left, right) : !timingSafeEqual(right, right);
};

const cookieToken = (request) => {
  for (const cookie of String(request.headers?.cookie || "").split(";")) {
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

const queryToken = (request) => {
  try {
    return new URL(request.url || "/", "http://localhost").searchParams.get("token");
  } catch {
    return null;
  }
};

// Tunnels and reverse proxies connect from loopback, so the real client is
// only visible in the forwarding headers they add.
const clientAddress = (request) => String(
  request.headers?.["cf-connecting-ip"]
  || String(request.headers?.["x-forwarded-for"] || "").split(",")[0]
  || request.socket?.remoteAddress
  || "unknown",
).trim();

export const authorized = (request, token) => sameSecret(queryToken(request), token)
  || sameSecret(cookieToken(request), token);

export const rememberAuthorizedDevice = (request, response, url, token) => {
  if (!sameSecret(url.searchParams.get("token"), token)) return;
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  const secure = forwardedProto === "https" || Boolean(request.socket?.encrypted);
  const attributes = [`${cookieName}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=2592000"];
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
  const check = (request) => {
    const address = clientAddress(request);
    let record = failures.get(address);
    if (record && now() - record.startedAt >= windowMs) {
      failures.delete(address);
      record = undefined;
    }
    if (record && record.count >= maxFailures) {
      return { allowed: false, status: 429, retryAfterSeconds: Math.ceil((record.startedAt + windowMs - now()) / 1000) };
    }
    if (authorized(request, token)) return { allowed: true };
    if (queryToken(request) !== null || cookieToken(request)) {
      if (record) record.count += 1;
      else failures.set(address, { count: 1, startedAt: now() });
      while (failures.size > maxTrackedClients) failures.delete(failures.keys().next().value);
    }
    return { allowed: false, status: 401 };
  };

  return { check };
};
