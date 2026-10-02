import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root, runtime, config, http, alive, identity, maintenanceKey, portOpen,
  readJson, writeJson, delay, withLock, detached, report } from "./negus-service-common.mjs";

const stateFile = path.join(runtime, "negus-web-demo.json");
const script = path.join(root, "windows", "scripts", "remote-room-demo.mjs");
export const checkBackend = async (cfg) => {
  const response = await http(cfg, "/api/project");
  if (response.status === 200 && response.body?.root === root && response.body?.mode === "interactive") {
    const ui = await http(cfg, "/");
    return { state: "healthy", frontend: ui.status === 200 && ui.type.includes("text/html") ? "healthy" : "unavailable" };
  }
  if (response.status === 401 || response.status === 403) return { state: "auth-error" };
  if (response.status !== 0) return { state: "unhealthy-or-foreign" };
  const occupied = await portOpen(cfg.port);
  if (occupied !== false) return { state: occupied ? "unhealthy-or-foreign" : "unknown" };
  if (alive(cfg.state?.pid)) return { state: "process-alive-not-ready" };
  return { state: "absent" };
};
export const startBackend = async (cfg, entryScript) => {
  const health = await checkBackend(cfg);
  if (health.state === "healthy") return health;
  if (health.state !== "absent") throw new Error("Refusing start: " + health.state);
  await fs.access(path.join(cfg.webRoot, "index.html"));
  const active = await readJson(path.join(runtime, "negus-release-state.json"));
  const entry = entryScript || active?.active?.entryScript || script;
  await fs.access(entry);
  if (!entryScript && active?.active) {
    const { verifyRelease } = await import("./negus-releases.mjs");
    await verifyRelease(active.active);
    // Normal recovery preserves the independently published frontend.
    // Version deployment and rollback publish their matching UI in the supervisor.
  }
  const pid = await detached(entry, ["--port", String(cfg.port), "--observer-port", "9350",
    "--project", "negus", "--project-root", root, "--web-root", cfg.webRoot,
    "--token", cfg.token, "--device-name", cfg.deviceName], "negus-web-demo.log", { NEGUS_INSTALL_ROOT: root });
  const owner = await identity(pid, entry);
  const state = { pid, entryScript: entry, port: cfg.port, startedAt: new Date().toISOString(), processStarted: owner?.started,
    webRoot: cfg.webRoot, deviceName: cfg.deviceName };
  await writeJson(stateFile, state);
  cfg.state = state;
  for (let i = 0; i < 30; i++) {
    if ((await checkBackend(cfg)).state === "healthy") return { state: "started", pid };
    if (!alive(pid)) throw new Error("New backend exited; inspect negus-web-demo.log locally.");
    await delay(1000);
  }
  throw new Error("Backend did not become ready; not killing or spawning another process.");
};
export const stopOwnedBackend = async (cfg) => {
  const pid = cfg.state?.pid;
  if (alive(pid)) {
    const entry = cfg.state.entryScript || script;
    const owner = await identity(pid, entry);
    if (!owner || (cfg.state.processStarted && cfg.state.processStarted !== owner.started)) throw new Error("Process identity changed; refusing stop.");
    process.kill(pid, "SIGTERM");
  }
  for (let i = 0; i < 30; i++) {
    if (!alive(pid) && (await portOpen(cfg.port)) === false) {
      const latest = await readJson(stateFile);
      if (latest?.pid === pid) await fs.rm(stateFile, { force: true });
      cfg.state = null;
      return;
    }
    await delay(1000);
  }
  throw new Error("Graceful exit timed out; no SIGKILL or competing service was started.");
};
export const stopWhenIdle = async (cfg, { handoff = false } = {}) => {
  const current = await checkBackend(cfg);
  if (current.state === "absent") return;
  if (current.state !== "healthy") throw new Error("Cannot prove safe shutdown: " + current.state);
  const key = await maintenanceKey();
  const initial = await http(cfg, "/api/maintenance", { key });
  const supported = initial.body?.protocol === 1 && initial.body?.root === root;
  if (!supported) {
    if (!handoff || initial.status !== 404) throw new Error("Old backend requires an explicitly authorized --handoff and a verified fallback release.");
    await stopOwnedBackend(cfg);
    return;
  }
  if (initial.body.pid !== cfg.state?.pid) throw new Error("Service PID differs from recorded PID; refusing shutdown.");
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const prepared = await http(cfg, "/api/maintenance" + (handoff ? "?interrupt=1" : ""), { method: "POST", key });
    if (prepared.status === 409 && !handoff) { await delay(2000); continue; }
    if (prepared.status !== 200 || !prepared.body?.draining || prepared.body.pid !== cfg.state.pid) throw new Error("Cannot acquire maintenance lease; backend left running.");
    try {
      if (!handoff) {
        await delay(1000);
        const confirm = await http(cfg, "/api/maintenance", { key });
        if (confirm.status !== 200 || confirm.body?.busy || !confirm.body?.draining || confirm.body.pid !== cfg.state.pid) throw new Error("Activity changed while draining; backend left running.");
      }
      await stopOwnedBackend(cfg);
      return;
    } finally {
      if (alive(cfg.state?.pid)) await http(cfg, "/api/maintenance", { method: "DELETE", key });
    }
  }
  throw new Error("Waited 30 minutes for work; restart cancelled.");
};
export const backendAction = async (action) => withLock("negus-service-operation", async () => {
  const cfg = await config();
  if (action === "recover" || action === "start") {
    const health = await checkBackend(cfg);
    if (health.state !== "absent") return health;
    return startBackend(cfg);
  }
  if (action === "restart" || action === "stop") {
    await stopWhenIdle(cfg);
    return action === "stop" ? { state: "stopped" } : startBackend(cfg);
  }
  throw new Error("Unknown backend action.");
});
export const main = async (args = process.argv.slice(2)) => {
  const action = args[0] || "check";
  if (action === "check") {
    const result = await checkBackend(await config());
    console.log(JSON.stringify(result));
    if (result.state !== "healthy" || result.frontend !== "healthy") process.exitCode = 1;
    return;
  }
  if (!["start", "recover", "restart", "stop"].includes(action)) throw new Error("Use check|start|recover|restart|stop.");
  if (action === "restart" && !args.includes("--worker")) return (await import("./negus-supervisor.mjs")).main(["restart", ...args.slice(1)]);
  if (action === "stop" && !args.includes("--worker")) {
    const workerPid = await detached(fileURLToPath(import.meta.url), [action, "--worker"], "negus-backend-worker.log");
    console.log(JSON.stringify({ state: "scheduled", action, workerPid, result: "runtime/negus-backend-result.json" }));
    return;
  }
  try {
    if (args.includes("--worker")) await delay(3000);
    const result = await backendAction(action);
    await report("negus-backend", { action, ...result });
    if (!["healthy", "started", "stopped"].includes(result.state)) process.exitCode = 1;
  } catch (error) {
    await report("negus-backend", { action, state: "failed", message: error.message });
    process.exitCode = 1;
  }
};
if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
