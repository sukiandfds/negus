import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
export const root = process.env.NEGUS_INSTALL_ROOT ? path.resolve(process.env.NEGUS_INSTALL_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const runtime = path.join(root, "runtime");
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const alive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
};
export const readJson = async (file, fallback = null) => {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw new Error("Invalid or unreadable state: " + path.basename(file)); }
};
export const writeJson = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, file);
};
export const config = async () => {
  const state = await readJson(path.join(runtime, "negus-web-demo.json"));
  const saved = await fs.readFile(path.join(runtime, "access-token"), "utf8").catch((e) => {
    if (e.code === "ENOENT") return ""; throw e;
  });
  const token = (process.env.NEGUS_TOKEN || saved).trim();
  if (!token || /[\r\n]/u.test(token)) throw new Error("Missing valid runtime/access-token; refusing demo-token fallback.");
  const port = Number(process.env.NEGUS_PORT || state?.port || 9360);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid service port.");
  return { port, token, state, webRoot: state?.webRoot || path.join(root, "web-ui", "dist"),
    deviceName: state?.deviceName || process.env.NEGUS_DEVICE_NAME || (await import("node:os")).hostname() };
};
export const http = async (cfg, pathname, { method = "GET", key = "", origin, timeout = 5000 } = {}) => {
  try {
    const response = await fetch((origin || "http://127.0.0.1:" + cfg.port) + pathname, {
      method, redirect: "error", signal: AbortSignal.timeout(timeout),
      headers: { Cookie: "codex_demo_token=" + encodeURIComponent(cfg.token),
        ...(key ? { "X-Negus-Maintenance-Key": key } : {}) },
    });
    const type = response.headers.get("content-type") || "";
    let body = null;
    if (type.includes("application/json")) body = await response.json();
    else await response.body?.cancel();
    return { status: response.status, type, body };
  } catch (error) { return { status: 0, error: error.cause?.code || error.name }; }
};
export const portOpen = (port) => new Promise((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port });
  let done = false;
  const finish = (value) => { if (done) return; done = true; socket.destroy(); resolve(value); };
  socket.setTimeout(1500, () => finish(null));
  socket.once("connect", () => finish(true));
  socket.once("error", (e) => finish(e.code === "ECONNREFUSED" ? false : null));
});
export const identity = async (pid, needle, directory = root) => {
  if (!alive(pid)) return null;
  if (process.platform !== "darwin") throw new Error("Process ownership checks currently support macOS only.");
  const { stdout: args } = await exec("/bin/ps", ["-p", String(pid), "-o", "command="], { timeout: 5000 });
  const { stdout: started } = await exec("/bin/ps", ["-p", String(pid), "-o", "lstart="], { timeout: 5000 });
  if (!args.includes(needle) || !args.includes(directory)) throw new Error("PID ownership mismatch; no signal sent.");
  return { pid, started: started.trim() };
};
export const maintenanceKey = async () => {
  const file = path.join(runtime, "maintenance-key");
  await fs.mkdir(runtime, { recursive: true });
  try { await fs.writeFile(file, randomUUID() + randomUUID(), { flag: "wx", mode: 0o600 }); }
  catch (e) { if (e.code !== "EEXIST") throw e; }
  const key = (await fs.readFile(file, "utf8")).trim();
  if (key.length < 32) throw new Error("Invalid maintenance key.");
  return key;
};
export const withLock = async (name, task) => {
  const file = path.join(runtime, name + ".lock");
  await fs.mkdir(runtime, { recursive: true });
  const id = randomUUID();
  const open = () => fs.open(file, "wx", 0o600);
  let handle;
  try { handle = await open(); }
  catch (e) {
    if (e.code !== "EEXIST") throw e;
    // Serialize stale-lock removal. Never auto-reclaim this guard: recursively
    // reclaiming it would reintroduce the same check/unlink race after a crash.
    const recoveryFile = file + ".recovery";
    let recovery;
    try { recovery = await fs.open(recoveryFile, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw new Error(name + " lock recovery is running or interrupted; inspect " + path.basename(recoveryFile));
    }
    try {
      const previous = await readJson(file); // Re-read under the guard; partial locks fail closed.
      if (previous && (!Number.isSafeInteger(previous.pid) || previous.pid < 2 || alive(previous.pid))) {
        throw new Error(name + " is already running (or lock needs inspection).");
      }
      // A normal owner may have released the lock before we acquired the guard.
      if (previous) await fs.unlink(file);
      handle = await open();
    } finally {
      await recovery.close();
      await fs.unlink(recoveryFile);
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, id, createdAt: new Date().toISOString() }));
    await handle.close();
    return await task();
  } finally {
    await handle.close().catch(() => {});
    if ((await readJson(file))?.id === id) await fs.unlink(file);
  }
};
export const run = (program, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { cwd: root, stdio: "inherit", ...options });
  child.once("error", reject);
  child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error("Command failed: " + path.basename(program) + " (" + (signal || code) + ")")));
});
export const detached = async (script, args, logName, env = {}) => {
  await fs.mkdir(runtime, { recursive: true });
  const log = await fs.open(path.join(runtime, logName), "a", 0o600);
  try {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root, detached: true, stdio: ["ignore", log.fd, log.fd], env: { ...process.env, ...env },
    });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    return child.pid;
  } finally { await log.close(); }
};
export const report = async (name, data) => {
  const record = { ...data, at: new Date().toISOString() };
  await writeJson(path.join(runtime, name + "-result.json"), record);
  console.log(JSON.stringify(record));
};
