import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root, runtime, config, http, delay, readJson, writeJson, withLock, detached, report, alive } from "./negus-service-common.mjs";
import { checkBackend, startBackend, stopOwnedBackend, stopWhenIdle } from "./negus-backend.mjs";
import { publishBuild, validateBuild } from "./negus-frontend.mjs";
import { snapshotRelease, verifyRelease, releaseStateFile } from "./negus-releases.mjs";
const preparedFile = path.join(runtime, "negus-release-prepared.json");
const jobFile = path.join(runtime, "negus-restart-job.json");

// Export the state machine for failure-injection tests. No retry can launch a
// second process until the failed attempt has been confirmed stopped.
export const restartWithRecovery = async ({ stop, launch, cleanFailed, publish, saveActive, record, candidate, fallback }) => {
  await stop();
  const failures = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    await record({ phase: "starting", attempt, releaseId: candidate.id });
    try {
      await publish(candidate);
      const result = await launch(candidate);
      await saveActive(candidate, fallback);
      return { state: "started", attempts: attempt, releaseId: candidate.id, ...result };
    } catch {
      failures.push({ attempt, message: "Candidate did not complete startup/health validation." });
      // If ownership or graceful shutdown cannot be proven, abort rather than
      // spawn another backend on the same data/port.
      await cleanFailed();
    }
  }
  await record({ phase: "rolling-back", attempts: 3, failures, releaseId: fallback.id });
  await publish(fallback);
  const result = await launch(fallback);
  await saveActive(fallback, null);
  return { state: "rolled-back", attempts: 3, releaseId: fallback.id, failures, ...result };
};
const prepare = async (revision) => withLock("negus-service-operation", async () => {
  const state = await readJson(releaseStateFile, {});
  let fallback = state.active;
  if (fallback) await verifyRelease(fallback);
  else {
    if (!revision) throw new Error("First upgrade requires prepare --fallback-revision <commit>; an old in-memory process is not a recoverable release.");
    const previous = await readJson(preparedFile);
    const previousManifest = previous?.fallback && await readJson(path.join(previous.fallback.directory, "release.json"));
    if (previousManifest?.revision === revision) { fallback = previous.fallback; await verifyRelease(fallback); }
    else fallback = await snapshotRelease({ revision });
  }
  const candidate = await snapshotRelease({ build: true });
  const prepared = { candidate, fallback, at: new Date().toISOString() };
  await writeJson(preparedFile, prepared);
  return { state: "prepared", candidate: candidate.id, fallback: fallback.id };
});
export const initializeManagedRelease = async () => {
  const state = await readJson(releaseStateFile, {});
  if (state.active) { await verifyRelease(state.active); return; }
  // New deployments have no old process to recover. Capture and preflight the
  // installed build before starting it, so later upgrades have a real fallback.
  const active = await snapshotRelease();
  await writeJson(releaseStateFile, { active, previous: null, at: new Date().toISOString() });
};
const runJob = async (job) => withLock("negus-service-operation", async () => {
  const cfg = await config();
  if ((cfg.state?.pid || null) !== job.expectedPid) throw new Error("Backend PID changed after scheduling; restart cancelled.");
  await verifyRelease(job.candidate);
  await verifyRelease(job.fallback);
  const health = await checkBackend(cfg);
  if (health.state !== "healthy" && health.state !== "absent") throw new Error("Backend health/ownership uncertain; production was not stopped.");
  // Durable fallback pointer is written BEFORE stopping the old service. If
  // this worker dies, watchdog/start recovers the verified fallback, not source.
  await writeJson(releaseStateFile, { active: job.fallback, previous: null, at: new Date().toISOString() });
  const record = async (change) => {
    Object.assign(job, change, { updatedAt: new Date().toISOString() });
    await writeJson(jobFile, job);
  };
  await record({ phase: "stopping" });
  const result = await restartWithRecovery({
    candidate: job.candidate, fallback: job.fallback,
    stop: () => stopWhenIdle(cfg, { handoff: job.handoff }),
    cleanFailed: () => stopOwnedBackend(cfg),
    publish: (release) => publishBuild(path.join(release.directory, "web-ui/dist"), cfg.webRoot),
    launch: async (release) => {
      const started = await startBackend(cfg, release.entryScript);
      const version = await validateBuild(path.join(release.directory, "web-ui/dist"));
      // Require stable health and the expected frontend, not just one HTTP 200.
      for (let i = 0; i < 5; i++) {
        const status = await checkBackend(cfg);
        const liveVersion = await http(cfg, "/api/version");
        if (status.state !== "healthy" || status.frontend !== "healthy" || liveVersion.body?.buildId !== version.buildId) throw new Error("Release health validation failed.");
        await delay(1000);
      }
      return { pid: started.pid || cfg.state?.pid };
    },
    saveActive: (active, previous) => writeJson(releaseStateFile, { active, previous, at: new Date().toISOString() }),
    record,
  });
  await record({ phase: "completed", outcome: result.state, pid: result.pid });
  await report("negus-backend", { action: "restart", jobId: job.id, ...result });
  return result;
});
export const main = async (args = process.argv.slice(2)) => {
  if (process.platform !== "darwin") throw new Error("Managed restart currently supports macOS only.");
  const action = args[0] || "status";
  if (action === "status") {
    const job = await readJson(jobFile);
    console.log(JSON.stringify({ job: job && { id: job.id, phase: job.phase, outcome: job.outcome, workerPid: job.workerPid, workerAlive: alive(job.workerPid), updatedAt: job.updatedAt },
      result: await readJson(path.join(runtime, "negus-backend-result.json")),
      releases: await readJson(releaseStateFile) }));
    return;
  }
  if (action === "prepare") {
    const at = args.indexOf("--fallback-revision");
    console.log(JSON.stringify(await prepare(at >= 0 ? args[at + 1] : undefined)));
    return;
  }
  if (action === "restart") return withLock("negus-restart-schedule", async () => {
    const existing = await readJson(jobFile);
    if (existing && !["completed", "failed"].includes(existing.phase) && alive(existing.workerPid)) throw new Error("A restart worker is already running.");
    let prepared = await readJson(preparedFile);
    if (!prepared) { await prepare(); prepared = await readJson(preparedFile); }
    await verifyRelease(prepared.candidate); await verifyRelease(prepared.fallback);
    const cfg = await config();
    const job = { ...prepared, id: Date.now() + "-" + process.pid, expectedPid: cfg.state?.pid || null,
      handoff: args.includes("--handoff"), phase: "scheduled", scheduledAt: new Date().toISOString() };
    await writeJson(jobFile, job);
    // The worker itself runs from the candidate snapshot, so edits to working
    // source after handoff cannot remove its recovery implementation.
    const worker = path.join(prepared.candidate.directory, "scripts/negus-supervisor.mjs");
    const workerPid = await detached(worker, ["worker", job.id], "negus-backend-worker.log", { NEGUS_INSTALL_ROOT: root });
    job.workerPid = workerPid;
    await writeJson(jobFile, job);
    await fs.rm(preparedFile, { force: true });
    console.log(JSON.stringify({ state: "scheduled", action: "restart", jobId: job.id, workerPid, graceSeconds: 15,
      result: "runtime/negus-backend-result.json" }));
    return;
  });
  if (action === "worker") {
    await delay(15000);
    const job = await readJson(jobFile);
    if (!job || job.id !== args[1]) throw new Error("Restart job changed before handoff.");
    try { await runJob(job); }
    catch (error) {
      await writeJson(jobFile, { ...job, phase: "failed", message: error.message, updatedAt: new Date().toISOString() });
      await report("negus-backend", { action: "restart", state: "failed", jobId: job.id, message: error.message });
      process.exitCode = 1;
    }
    return;
  }
  throw new Error("Use prepare [--fallback-revision SHA]|restart [--handoff]|status.");
};
if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
