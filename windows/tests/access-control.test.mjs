import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  authorized, createAccessGuard, rememberAuthorizedDevice, resolveAccessToken,
} from "../server/http/access-control.mjs";

const requestFor = (target, headers = {}) => ({
  request: { headers, socket: { remoteAddress: "10.0.0.1" } },
  url: new URL(target, "http://localhost"),
});

test("accepts the token from the query string or the cookie, and nothing else", () => {
  const token = "s3cret token/with+symbols";
  const query = requestFor(`/api/project?token=${encodeURIComponent(token)}`);
  assert.equal(authorized(query.request, query.url, token), true);

  const cookie = requestFor("/api/project", { cookie: `other=1; codex_demo_token=${encodeURIComponent(token)}` });
  assert.equal(authorized(cookie.request, cookie.url, token), true);

  for (const wrong of ["", "s3cret", `${token}x`, "S3CRET TOKEN/WITH+SYMBOLS"]) {
    const attempt = requestFor(`/api/project?token=${encodeURIComponent(wrong)}`, { cookie: `codex_demo_token=${encodeURIComponent(wrong)}` });
    assert.equal(authorized(attempt.request, attempt.url, token), false, `"${wrong}" must be refused`);
  }
  const malformed = requestFor("/api/project", { cookie: "codex_demo_token=%E0%A4%A" });
  assert.equal(authorized(malformed.request, malformed.url, token), false);
});

test("remembers a device only after a valid token, with Secure behind HTTPS", () => {
  const headersFor = (target, headers) => {
    const { request, url } = requestFor(target, headers);
    const sent = {};
    rememberAuthorizedDevice(request, { setHeader: (name, value) => { sent[name] = value; } }, url, "token-value");
    return sent;
  };
  assert.deepEqual(headersFor("/?token=wrong"), {});
  assert.match(headersFor("/?token=token-value")["Set-Cookie"], /^codex_demo_token=token-value; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/u);
  assert.match(headersFor("/?token=token-value", { "x-forwarded-proto": "https" })["Set-Cookie"], /; Secure$/u);
});

test("throttles wrong guesses per client address and recovers after the window", () => {
  let time = 0;
  const guard = createAccessGuard({ token: "right", maxFailures: 3, windowMs: 1000, now: () => time });
  const attempt = (tokenValue, address) => {
    const { request, url } = requestFor(tokenValue === null ? "/api/x" : `/api/x?token=${tokenValue}`, { "cf-connecting-ip": address });
    return guard.check(request, url);
  };

  for (let index = 0; index < 3; index += 1) assert.equal(attempt("wrong", "1.1.1.1").status, 401);
  assert.equal(attempt("right", "1.1.1.1").status, 429, "a locked address is refused even with the right token");
  assert.equal(attempt("right", "2.2.2.2").allowed, true, "other addresses are unaffected");
  for (let index = 0; index < 10; index += 1) assert.equal(attempt(null, "3.3.3.3").status, 401);
  assert.equal(attempt("right", "3.3.3.3").allowed, true, "missing credentials are never counted");

  time = 1000;
  assert.equal(attempt("right", "1.1.1.1").allowed, true);
});

test("keeps one generated access token across restarts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-access-token-"));
  try {
    const tokenFile = path.join(root, "runtime", "access-token");
    const first = resolveAccessToken({ tokenFile });
    assert.equal(first.source, "generated");
    assert.ok(first.token.length >= 32);
    assert.deepEqual(resolveAccessToken({ tokenFile }), { token: first.token, source: "file" });
    assert.deepEqual(resolveAccessToken({ explicitToken: " chosen ", tokenFile }), { token: "chosen", source: "argument" });

    await fs.writeFile(tokenFile, "short\n", "utf8");
    const replaced = resolveAccessToken({ tokenFile });
    assert.equal(replaced.source, "generated");
    assert.notEqual(replaced.token, "short");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
