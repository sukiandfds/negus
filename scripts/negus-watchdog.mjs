import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { root, runtime, config, http, alive, identity, readJson, writeJson, withLock, report } from "./negus-service-common.mjs";
import { checkBackend, backendAction } from "./negus-backend.mjs";
const exec = promisify(execFile);
const stateFile = path.join(runtime, "negus-watchdog-state.json");

export const recoveryDecision = ({ health, retryAfter = 0, now = Date.now() }) =>
  health !== "absent" ? "observe" : now < retryAfter ? "cooldown" : "recover";

const recoverTunnel = async (cfg, repair) => {
  const file = path.join(runtime, "negus-tunnel.json");
  const state = await readJson(file);
  if (!state?.hostname || !state?.tunnelId) return { state: "not-configured" };
  if (!/^[a-z0-9.-]+$/iu.test(state.hostname)) throw new Error("Invalid tunnel hostname.");
  if (alive(state.pid)) {
    await identity(state.pid, "cloudflared", path.join(runtime, "negus-tunnel.yml"));
  } else if (repair) {
    const binary = process.env.NEGUS_CLOUDFLARED || path.join(runtime, "bin", "cloudflared");
    await fs.access(binary);
    // Reuse configured Named Tunnel and credentials. Captured output can contain
    // legacy share URLs; never relay it to logs or the caller.
    try {
      await exec(process.execPath, [path.join(root, "scripts/negus-tunnel.mjs"), "start"], {
        cwd: root, timeout: 65000, maxBuffer: 1024 * 1024,
        env: { ...process.env, NEGUS_TOKEN: cfg.token, NEGUS_PORT: String(cfg.port), NEGUS_CLOUDFLARED: binary },
      });
    } catch { throw new Error("Configured tunnel start failed; inspect local tunnel logs. Credentials were not changed."); }
  } else return { state: "absent" };
  const response = await http(cfg, "/api/project", { origin: "https://" + state.hostname, timeout: 8000 });
  return { state: response.status === 200 && response.body?.root === root ? "healthy" : "public-unavailable",
    httpStatus: response.status };
};
export const main = async (args = process.argv.slice(2)) => {
  const repair = args[0] === "recover";
  if (!["check", "recover"].includes(args[0] || "check")) throw new Error("Use check|recover.");
  const work = async () => {
    const cfg = await config();
    const previous = await readJson(stateFile, { failures: 0, retryAfter: 0 });
    let backend = await checkBackend(cfg);
    const decision = recoveryDecision({ health: backend.state, retryAfter: previous.retryAfter });
    if (repair && decision === "recover") backend = await backendAction("recover");
    const localReady = ["healthy", "started"].includes(backend.state);
    const tunnel = localReady ? await recoverTunnel(cfg, repair && Date.now() >= previous.retryAfter) : { state: "not-checked" };
    const healthy = localReady && backend.frontend !== "unavailable" && ["healthy", "not-configured"].includes(tunnel.state);
    if (repair) {
      const failures = healthy ? 0 : Math.min((previous.failures || 0) + 1, 10);
      await writeJson(stateFile, { failures, retryAfter: healthy ? 0 : Date.now() + Math.min(900000, 60000 * 2 ** (failures - 1)) });
      await report("negus-watchdog", { state: healthy ? "healthy" : "attention", backend, tunnel, decision });
    } else console.log(JSON.stringify({ state: healthy ? "healthy" : "attention", backend, tunnel, decision }));
    if (!healthy) process.exitCode = 1;
  };
  if (repair) {
    try { await withLock("negus-watchdog", work); }
    catch (error) {
      // Bound retries on launch failure as well as completed health checks.
      const previous = await readJson(stateFile, { failures: 0 }).catch(() => ({ failures: 0 }));
      const failures = Math.min((previous.failures || 0) + 1, 10);
      await writeJson(stateFile, { failures, retryAfter: Date.now() + Math.min(900000, 60000 * 2 ** (failures - 1)) });
      await report("negus-watchdog", { state: "failed", message: error.message });
      process.exitCode = 1;
    }
  } else await work();
};
if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
