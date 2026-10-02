import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root, runtime, config, http, readJson, writeJson, run, withLock, detached, report } from "./negus-service-common.mjs";

const required = ["index.html", "group.html", "progress.html", "project-management.html", "version.json"];
export const validateBuild = async (directory) => {
  for (const name of required) await fs.access(path.join(directory, name));
  const version = await readJson(path.join(directory, "version.json"));
  if (!version?.buildId || !Number.isFinite(Date.parse(version.builtAt))) throw new Error("Invalid frontend version.");
  for (const name of required.filter((name) => name.endsWith(".html"))) {
    const html = await fs.readFile(path.join(directory, name), "utf8");
    const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"'?#]+)(?:[?#][^"']*)?["']/gu)];
    if (!assets.some((match) => match[1].endsWith(".js"))) throw new Error("Missing JavaScript entry: " + name);
    for (const [, url] of assets) {
      const asset = path.resolve(directory, "." + url);
      if (!asset.startsWith(path.resolve(directory) + path.sep)) throw new Error("Unsafe asset reference.");
      await fs.access(asset);
    }
  }
  return version;
};
const listFiles = async (directory, prefix = "") => {
  const entries = await fs.readdir(path.join(directory, prefix), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.isSymbolicLink()) throw new Error("Symlinks not allowed in frontend build.");
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(directory, relative) : [relative];
  }));
  return nested.flat();
};
// Copy assets first and atomically replace each entry page last. Old hashed
// assets remain available to already-open browsers; never empty live dist.
export const publishBuild = async (source, destination) => {
  await validateBuild(source);
  const files = await listFiles(source);
  const rank = (name) => name === "version.json" ? 2 : name.endsWith(".html") ? 1 : 0;
  files.sort((a, b) => rank(a) - rank(b));
  for (const relative of files) {
    const target = path.join(destination, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = target + ".publish-" + process.pid;
    await fs.copyFile(path.join(source, relative), tmp);
    await fs.rename(tmp, target);
  }
};
export const main = async (args = process.argv.slice(2)) => {
  const action = args[0] || "restart";
  if (!["restart", "rollback", "check"].includes(action)) throw new Error("Use restart|rollback|check.");
  const cfg = await config();
  if (action === "check") { console.log(JSON.stringify(await validateBuild(cfg.webRoot))); return; }
  if (!args.includes("--worker")) {
    const workerPid = await detached(fileURLToPath(import.meta.url), [action, "--worker"], "negus-frontend-worker.log");
    console.log(JSON.stringify({ state: "scheduled", action, workerPid, result: "runtime/negus-frontend-result.json" }));
    return;
  }
  await withLock("negus-service-operation", async () => {
    const history = path.join(runtime, "frontend-release.json");
    let previous;
    try {
      if (action === "rollback") {
        previous = (await readJson(history))?.previous;
        if (!previous || !path.resolve(previous).startsWith(path.join(runtime, "frontend-backups") + path.sep)) {
          throw new Error("No valid previous frontend release.");
        }
        await publishBuild(previous, cfg.webRoot);
        await report("negus-frontend", { state: "rolled-back", version: await validateBuild(cfg.webRoot) });
        return;
      }
      const stage = path.join(runtime, "frontend-build-" + Date.now());
      await run(process.execPath, [path.join(root, "web-ui/node_modules/typescript/bin/tsc"), "-b"],
        { cwd: path.join(root, "web-ui") });
      await run(process.execPath, [path.join(root, "web-ui/node_modules/vite/bin/vite.js"),
        "build", "--config", "vite.config.ts", "--outDir", stage, "--emptyOutDir"],
        { cwd: path.join(root, "web-ui") });
      const version = await validateBuild(stage);
      await validateBuild(cfg.webRoot); // Preserve a known complete recovery copy.
      previous = path.join(runtime, "frontend-backups", String(Date.now()));
      await fs.mkdir(path.dirname(previous), { recursive: true });
      await fs.cp(cfg.webRoot, previous, { recursive: true });
      await writeJson(history, { previous, candidate: stage, state: "publishing", version });
      try {
        await publishBuild(stage, cfg.webRoot);
        const probe = await http(cfg, "/api/version");
        if (probe.status !== 200 || probe.body?.buildId !== version.buildId) {
          throw new Error("Live backend did not confirm published frontend version.");
        }
      } catch (error) {
        await publishBuild(previous, cfg.webRoot);
        await writeJson(history, { previous, candidate: stage, state: "rolled-back", reason: error.message });
        throw error;
      }
      await writeJson(history, { previous, candidate: stage, state: "published", version });
      await report("negus-frontend", { state: "published", version, backendRestarted: false, browserReloaded: false });
    } catch (error) {
      await report("negus-frontend", { state: "failed", message: error.message });
      process.exitCode = 1;
    }
  });
};
if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
