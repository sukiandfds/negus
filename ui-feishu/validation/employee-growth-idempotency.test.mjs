import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root,
  configFile: false,
  esbuild: { jsx: "automatic" },
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await vite.listen();
const address = vite.httpServer.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });

const proposal = status => ({ id: "rule-1", kind: "rule", text: "调研必须标注一手来源", status, createdAt: "2026-11-09T00:00:00.000Z" });
const openPanel = async ({ onDisable }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let status = "approved";
  const requestIds = [];
  let reads = 0;
  let servedStaleRead = false;
  await page.addInitScript(() => {
    window.EventSource = class { close() {} };
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    if (pathname === "/api/employee-growth") {
      reads += 1;
      const stale = status === "disabled" && !servedStaleRead;
      servedStaleRead ||= stale;
      return route.fulfill({ json: { employeeId: "developer", facts: [], proposals: [proposal(stale ? "approved" : status)] } });
    }
    if (pathname === "/api/employee-growth/disable-rule") {
      const body = request.postDataJSON();
      requestIds.push(body.requestId);
      const action = await onDisable({ body, apply: () => { status = "disabled"; } });
      if (action === "abort") return route.abort("failed");
      return route.fulfill({ status: 202, json: proposal(status) });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.goto(`${base}/validation/employee-growth.html`);
  await page.getByText("已生效", { exact: true }).waitFor();
  return { page, requestIds, reads: () => reads };
};

try {
  const successful = await openPanel({ onDisable: async ({ apply }) => { apply(); return "response"; } });
  await successful.page.getByRole("button", { name: "停用", exact: true }).click();
  await successful.page.getByText("已停用", { exact: true }).waitFor();
  assert.equal(successful.requestIds.length, 1);
  assert.ok(successful.requestIds[0]);
  assert.ok(successful.reads() >= 2);
  await successful.page.close();

  const lostResponse = await openPanel({ onDisable: async ({ apply }) => { apply(); return "abort"; } });
  await lostResponse.page.getByRole("button", { name: "停用", exact: true }).click();
  await lostResponse.page.getByText("已停用", { exact: true }).waitFor();
  assert.equal(await lostResponse.page.getByText("发送失败", { exact: false }).count(), 0);
  assert.ok(lostResponse.reads() >= 3);
  await lostResponse.page.close();

  let attempts = 0;
  const retried = await openPanel({ onDisable: async ({ apply }) => {
    attempts += 1;
    if (attempts === 1) return "abort";
    apply();
    return "response";
  } });
  await retried.page.getByRole("button", { name: "停用", exact: true }).click();
  await retried.page.getByText("已生效", { exact: true }).waitFor();
  assert.equal(retried.requestIds.length, 1);
  await retried.page.getByRole("button", { name: "停用", exact: true }).click();
  await retried.page.getByText("已停用", { exact: true }).waitFor();
  assert.equal(retried.requestIds.length, 2);
  assert.equal(retried.requestIds[0], retried.requestIds[1]);
  await retried.page.close();
} finally {
  await browser.close();
  await vite.close();
}
