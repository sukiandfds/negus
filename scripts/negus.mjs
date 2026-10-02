import { initializeCredentials, startManaged } from "./negus-deployment.mjs";
import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAppServerClient } from "../windows/server/app-server-client.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const runtimeRoot = path.join(projectRoot, "runtime");
const stateFile = path.join(runtimeRoot, "negus-web-demo.json");
const serverScript = path.join(projectRoot, "windows", "scripts", "remote-room-demo.mjs");
const webRoot = path.join(projectRoot, "web-ui", "dist");
const port = Number(process.env.NEGUS_PORT || "9360");
const token = process.env.NEGUS_TOKEN || (await fs.readFile(path.join(runtimeRoot, "access-token"), "utf8").catch(() => "")).trim();
const deviceName = process.env.NEGUS_DEVICE_NAME || os.hostname();
const command = process.argv[2] || "status";
const runtimeDirectories = ["uploads", "group-rooms", "employee-conversations", "agent-artifacts"];

const fail = (message) => {
  console.error(`[ERROR] ${message}`);
  process.exitCode = 1;
};

const readState = async () => {
  try { return JSON.parse(await fs.readFile(stateFile, "utf8")); } catch { return null; }
};

const processIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const localResponse = (pathname, timeoutMs = 1500) => new Promise((resolve, reject) => {
  const probe = http.get({ hostname: "127.0.0.1", port, path: pathname, timeout: timeoutMs }, (response) => {
    response.resume();
    resolve({
      statusCode: response.statusCode || 0,
      contentType: String(response.headers["content-type"] || ""),
    });
  });
  probe.once("timeout", () => probe.destroy(new Error(`Timed out after ${timeoutMs}ms`)));
  probe.once("error", reject);
});

const request = async () => {
  try {
    const response = await localResponse(`/api/project?token=${encodeURIComponent(token)}`);
    return response.statusCode === 200 && response.contentType.startsWith("application/json");
  } catch {
    return false;
  }
};

const pnpmCommand = () => process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const initialize = async () => {
  const required = [serverScript, path.join(projectRoot, "web-ui", "package.json"), path.join(projectRoot, "employees")];
  const missing = [];
  for (const entry of required) {
    if (!await fs.stat(entry).then(() => true).catch(() => false)) missing.push(path.relative(projectRoot, entry));
  }
  if (missing.length) throw new Error(`Required project files are missing: ${missing.join(", ")}. Use a complete repository checkout.`);
  await fs.mkdir(runtimeRoot, { recursive: true });
  await Promise.all(runtimeDirectories.map((entry) => fs.mkdir(path.join(runtimeRoot, entry), { recursive: true })));
  await initializeCredentials();
  console.log(`[OK] Runtime initialized: ${runtimeRoot}`);
};

const diagnosticCheck = async (component, check) => {
  try {
    return { component, status: "OK", detail: await check() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { component, status: "FAIL", detail: detail.replace(/\s+/gu, " ").slice(0, 320) };
  }
};

const checkRuntimeStorage = async () => {
  const entries = ["runtime", ...runtimeDirectories.map((entry) => `runtime/${entry}`)];
  for (const entry of entries) {
    const target = entry === "runtime" ? runtimeRoot : path.join(projectRoot, entry);
    const stats = await fs.stat(target).catch(() => null);
    if (!stats?.isDirectory()) throw new Error(`Missing runtime directory: ${entry}`);
    await fs.access(target, fsConstants.W_OK);
  }
  const marker = path.join(runtimeRoot, `.negus-diagnose-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(marker, "diagnostic\n", { flag: "wx" });
  } finally {
    await fs.rm(marker, { force: true });
  }
  return "required directories are writable";
};

const checkServer = async () => {
  const api = await localResponse(`/api/project?token=${encodeURIComponent(token)}`);
  if (api.statusCode !== 200 || !api.contentType.startsWith("application/json")) {
    throw new Error(`/api/project returned HTTP ${api.statusCode} (${api.contentType || "no content type"})`);
  }
  const page = await localResponse(`/?token=${encodeURIComponent(token)}`);
  if (page.statusCode !== 200 || !page.contentType.startsWith("text/html")) {
    throw new Error(`/ returned HTTP ${page.statusCode} (${page.contentType || "no content type"})`);
  }
  return "API and UI route are responding";
};

const checkAppServer = async () => {
  const client = createAppServerClient({ label: "diagnose", requestTimeoutMs: 7000, workingDirectory: projectRoot });
  try {
    await client.request("thread/list", {}, { timeoutMs: 7000 });
    return "Codex app-server accepted thread/list";
  } finally {
    client.close();
  }
};

const diagnose = async () => {
  const results = await Promise.all([
    diagnosticCheck("Frontend build", async () => {
      const file = path.join(webRoot, "index.html");
      const stats = await fs.stat(file);
      if (!stats.isFile()) throw new Error("web-ui/dist/index.html is not a file");
      return `index.html present (${stats.size} bytes)`;
    }),
    diagnosticCheck("Node service", checkServer),
    diagnosticCheck("Codex app-server", checkAppServer),
    diagnosticCheck("Runtime storage", checkRuntimeStorage),
  ]);
  for (const result of results) console.log(`[${result.status}] ${result.component}: ${result.detail}`);
  if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
};

const build = () => {
  const result = spawnSync(pnpmCommand(), ["--dir", path.join(projectRoot, "web-ui"), "build"], { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw new Error(`pnpm is required to build the UI: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);
};

const status = async () => {
  const state = await readState();
  const ready = await request();
  if (ready) console.log(`[OK] Web demo is ready on port ${port}.`);
  else if (state && processIsAlive(state.pid)) console.log(`[WARN] Web demo PID ${state.pid} is running but not ready.`);
  else console.log("[INFO] Web demo is not running.");
};


try {
  if (command === "build") build();
  else if (command === "rebuild") await (await import("./negus-frontend.mjs")).main(["restart"]);
  else if (command === "init") await initialize();
  else if (command === "start") console.log(JSON.stringify(await startManaged({ initialize })));
  else if (command === "stop") await (await import("./negus-backend.mjs")).main(["stop"]);
  else if (command === "restart") await (await import("./negus-supervisor.mjs")).main(["restart", ...process.argv.slice(3)]);
  else if (command === "status") await status();
  else if (command === "diagnose") await diagnose();
  else fail(`Unknown command: ${command}`);
} catch (error) {
  fail(error.message || String(error));
}
