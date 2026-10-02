import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { root, runtime, readJson, writeJson, http, delay, run } from "./negus-service-common.mjs";
import { validateBuild } from "./negus-frontend.mjs";
const exec = promisify(execFile);
export const releaseStateFile = path.join(runtime, "negus-release-state.json");
export const releasesRoot = path.join(runtime, "releases");
const codeDirectories = ["windows/server", "windows/scripts", "scripts"];
const digestTree = async (directory) => {
  const hash = createHash("sha256");
  const walk = async (relative = "") => {
    for (const name of (await fs.readdir(path.join(directory, relative))).sort()) {
      if (!relative && name === "release.json") continue;
      const key = path.join(relative, name), file = path.join(directory, key), stat = await fs.lstat(file);
      hash.update(key + "\0");
      if (stat.isSymbolicLink()) {
        const link = await fs.readlink(file);
        const resolved = path.resolve(path.dirname(file), link);
        if (!resolved.startsWith(directory + path.sep)) throw new Error("Release has an external symlink: " + key);
        hash.update("link:" + link);
      } else if (stat.isDirectory()) await walk(key);
      else hash.update(await fs.readFile(file));
    }
  };
  await walk();
  return hash.digest("hex");
};
export const verifyRelease = async (release) => {
  if (!release?.directory || !path.resolve(release.directory).startsWith(releasesRoot + path.sep)) throw new Error("Invalid release directory.");
  const manifest = await readJson(path.join(release.directory, "release.json"));
  if (!manifest?.verifiedAt || manifest.digest !== await digestTree(release.directory)) throw new Error("Release missing verification or changed since verification.");
  if (release.entryScript !== path.join(release.directory, "windows/scripts/remote-room-demo.mjs")) throw new Error("Invalid release entry.");
  await validateBuild(path.join(release.directory, "web-ui/dist"));
  return manifest;
};
const freePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
export const smokeRelease = async (release) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-release-check-"));
  let child, exited = false;
  const logPath = path.join(runtime, "release-check-" + release.id + ".log");
  const log = await fs.open(logPath, "a", 0o600);
  try {
    await fs.cp(path.join(root, "employees"), path.join(directory, "employees"), {
      recursive: true, filter: async (file) => (await fs.stat(file)).isDirectory() || path.basename(file) === "employee.json",
    });
    await fs.mkdir(path.join(directory, "runtime"), { recursive: true });
    await fs.mkdir(path.join(directory, "codex"), { recursive: true });
    await fs.mkdir(path.join(directory, "sessions"), { recursive: true });
    const port = await freePort(), token = randomBytes(24).toString("hex");
    child = spawn(process.execPath, [release.entryScript, "--project-root", directory, "--port", String(port),
      "--web-root", path.join(release.directory, "web-ui/dist"), "--token", token], {
      cwd: directory, stdio: ["ignore", log.fd, log.fd],
      env: { ...process.env, NEGUS_INSTALL_ROOT: root, CODEX_HOME: path.join(directory, "codex"), CODEX_SESSION_DIR: path.join(directory, "sessions") },
    });
    child.once("exit", () => { exited = true; });
    child.once("error", () => { exited = true; });
    const cfg = { port, token };
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      if (exited) throw new Error("Release preflight process exited; inspect " + path.basename(logPath));
      const api = await http(cfg, "/api/project", { timeout: 1000 });
      const ui = await http(cfg, "/", { timeout: 1000 });
      const version = await http(cfg, "/api/version", { timeout: 1000 });
      const expected = await validateBuild(path.join(release.directory, "web-ui/dist"));
      if (api.status === 200 && api.body?.root === directory && ui.status === 200 && version.body?.buildId === expected.buildId) { healthy = true; break; }
      await delay(250);
    }
    if (!healthy) throw new Error("Release preflight did not become healthy; production was not stopped.");
  } finally {
    if (child && !exited) {
      child.kill("SIGTERM");
      for (let i = 0; i < 40 && !exited; i++) await delay(250);
      // This is only the isolated preflight child, never a production PID.
      if (!exited) { child.kill("SIGKILL"); for (let i = 0; i < 20 && !exited; i++) await delay(100); }
    }
    await log.close();
    if (!child || exited) await fs.rm(directory, { recursive: true, force: true });
    if (child && !exited) throw new Error("Cannot confirm isolated preflight exit.");
  }
};
export const snapshotRelease = async ({ revision, build = false } = {}) => {
  await fs.mkdir(releasesRoot, { recursive: true });
  const id = Date.now() + "-" + randomUUID().slice(0, 8);
  const directory = path.join(releasesRoot, id);
  await fs.mkdir(directory);
  if (revision) {
    const git = process.env.NEGUS_GIT_BIN || "git";
    const { stdout } = await exec(git, ["rev-parse", "--verify", revision + "^{commit}"], { cwd: root });
    const sha = stdout.trim();
    if (!/^[a-f0-9]{40,64}$/u.test(sha)) throw new Error("Invalid baseline revision.");
    // This fallback is validated against installed dependencies; no dependency changes during restart.
    const archive = path.join(directory, "source.tar");
    await exec(git, ["archive", "--format=tar", "--output=" + archive, sha, "windows/server", "windows/scripts", "package.json"], { cwd: root });
    await exec("/usr/bin/tar", ["-xf", archive, "-C", directory]);
    await fs.rm(archive);
    revision = sha;
  } else {
    for (const relative of codeDirectories) await fs.cp(path.join(root, relative), path.join(directory, relative), { recursive: true, verbatimSymlinks: true });
    await fs.copyFile(path.join(root, "package.json"), path.join(directory, "package.json"));
  }
  await fs.cp(path.join(root, "node_modules"), path.join(directory, "node_modules"), { recursive: true, verbatimSymlinks: true });
  const webRoot = path.join(directory, "web-ui/dist");
  if (build) {
    await run(process.execPath, [path.join(root, "web-ui/node_modules/typescript/bin/tsc"), "-b"], { cwd: path.join(root, "web-ui") });
    await run(process.execPath, [path.join(root, "web-ui/node_modules/vite/bin/vite.js"), "build", "--config", "vite.config.ts", "--outDir", webRoot, "--emptyOutDir"], { cwd: path.join(root, "web-ui") });
  } else {
    await fs.cp(path.join(root, "web-ui/dist"), webRoot, { recursive: true, verbatimSymlinks: true });
  }
  await validateBuild(webRoot);
  const release = { id, directory, entryScript: path.join(directory, "windows/scripts/remote-room-demo.mjs") };
  await smokeRelease(release);
  await writeJson(path.join(directory, "release.json"), { ...release, revision: revision || "working-copy", verifiedAt: new Date().toISOString(), digest: await digestTree(directory) });
  return release;
};
