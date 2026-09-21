import assert from "node:assert/strict";
import test from "node:test";
import { authorized, rememberAuthorizedDevice } from "../server/http/access-control.mjs";

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
