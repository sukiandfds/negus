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
