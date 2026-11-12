import assert from "node:assert/strict";
import test from "node:test";
import { authorized, createAccessGuard, rememberAuthorizedDevice } from "../server/http/access-control.mjs";

test("query token is exchanged for an HttpOnly cookie without changing the token value", () => {
  const request = { url: "/?token=beta-secret", headers: { host: "example.test", "x-forwarded-proto": "https" }, socket: {} };
  const headers = new Map();
  const response = { setHeader(name, value) { headers.set(name, value); } };
  rememberAuthorizedDevice(request, response, new URL("https://example.test/?token=beta-secret"), "beta-secret");
  const cookie = headers.get("Set-Cookie");
  assert.equal(cookie, "codex_demo_token=beta-secret; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure");
  assert.equal(authorized({ url: "/", headers: { host: "example.test", cookie } }, "beta-secret"), true);
});

test("missing or wrong cookie remains unauthorized", () => {
  assert.equal(authorized({ url: "/", headers: { host: "example.test" } }, "beta-secret"), false);
  assert.equal(authorized({ url: "/", headers: { host: "example.test", cookie: "codex_demo_token=other" } }, "beta-secret"), false);
});

test("access link endpoint never needs to log the token", () => {
  const request = { url: "/?token=beta-secret", headers: { host: "example.test" }, socket: {} };
  const headers = new Map();
  const response = { setHeader(name, value) { headers.set(name, value); } };
  rememberAuthorizedDevice(request, response, new URL("https://example.test/?token=beta-secret"), "beta-secret");
  const serializedHeaders = JSON.stringify(Object.fromEntries(headers));
  assert.match(serializedHeaders, /codex_demo_token/u);
  assert.doesNotMatch(serializedHeaders, /console|log/u);
});

test("tokens are compared exactly, from the query string or the cookie", () => {
  const token = "s3cret token/with+symbols";
  const at = (target, cookie) => ({ url: target, headers: { host: "example.test", ...(cookie ? { cookie } : {}) } });
  assert.equal(authorized(at(`/api/x?token=${encodeURIComponent(token)}`), token), true);
  assert.equal(authorized(at("/api/x", `other=1; codex_demo_token=${encodeURIComponent(token)}`), token), true);
  for (const wrong of ["", "s3cret", `${token}x`, token.toUpperCase()]) {
    assert.equal(authorized(at(`/api/x?token=${encodeURIComponent(wrong)}`, `codex_demo_token=${encodeURIComponent(wrong)}`), token), false);
  }
  assert.equal(authorized(at("/api/x", "codex_demo_token=%E0%A4%A"), token), false);
});

test("wrong guesses are throttled per client address and recover after the window", () => {
  let time = 0;
  const guard = createAccessGuard({ token: "right", maxFailures: 3, windowMs: 1000, now: () => time });
  const attempt = (tokenValue, address) => guard.check({
    url: tokenValue === null ? "/api/x" : `/api/x?token=${tokenValue}`,
    headers: { "cf-connecting-ip": address },
  });

  for (let index = 0; index < 3; index += 1) assert.equal(attempt("wrong", "1.1.1.1").status, 401);
  assert.equal(attempt("right", "1.1.1.1").status, 429, "a locked address is refused even with the right token");
  assert.equal(attempt("right", "2.2.2.2").allowed, true, "other addresses are unaffected");
  for (let index = 0; index < 10; index += 1) assert.equal(attempt(null, "3.3.3.3").status, 401);
  assert.equal(attempt("right", "3.3.3.3").allowed, true, "missing credentials are never counted");

  time = 1000;
  assert.equal(attempt("right", "1.1.1.1").allowed, true);
});
