import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { root, config, maintenanceKey, withLock } from "./negus-service-common.mjs";
const exec = promisify(execFile);
const label = "local.negus.watchdog";
export const intervalSeconds = 10800;
const xml = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// Dependencies can target an isolated home and launchctl fixture in tests.
export const createMacWatchdog = ({
  home = os.homedir(), projectRoot = root, node = process.execPath,
  uid = process.getuid?.(), execute = exec,
} = {}) => {
  const file = path.join(home, "Library", "LaunchAgents", label + ".plist");
  const domain = "gui/" + uid;
  const script = path.join(projectRoot, "scripts/negus-watchdog.mjs");
  const runtime = path.join(projectRoot, "runtime");
  const loaded = async () => {
    try { await execute("/bin/launchctl", ["print", domain + "/" + label]); return true; } catch { return false; }
  };
  const read = () => fs.readFile(file, "utf8").catch((e) => { if (e.code === "ENOENT") return null; throw e; });
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + '<plist version="1.0"><dict><key>Label</key><string>' + label + '</string>'
    + '<key>ProgramArguments</key><array><string>' + xml(node) + '</string><string>'
    + xml(script) + '</string><string>recover</string></array>'
    + '<key>WorkingDirectory</key><string>' + xml(projectRoot) + '</string><key>StartInterval</key><integer>' + intervalSeconds + '</integer>'
    + '<key>RunAtLoad</key><true/><key>ProcessType</key><string>Background</string>'
    + '<key>StandardOutPath</key><string>' + xml(path.join(runtime, "negus-watchdog.log")) + '</string>'
    + '<key>StandardErrorPath</key><string>' + xml(path.join(runtime, "negus-watchdog.log")) + '</string></dict></plist>\n';
  const assertOwner = (existing) => {
    if (existing && !existing.includes("<string>" + xml(script) + "</string>")) {
      throw new Error("Watchdog belongs to another deployment or has an unknown format; existing task was not changed.");
    }
  };
  return {
    async status() {
      const existing = await read();
      return { label, installed: existing !== null, loaded: await loaded(),
        intervalSeconds: existing ? Number(existing.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/u)?.[1]) || null : null };
    },
    async install() {
      const existing = await read();
      assertOwner(existing);
      const active = await loaded();
      if (active && !existing) throw new Error("Loaded watchdog has no configuration file; inspect launchd before replacing it.");
      if (existing === body && active) return { state: "already-installed", intervalSeconds };
      // Validate before unloading an existing task.
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + "." + process.pid + ".tmp";
      try {
        await fs.writeFile(tmp, body, { flag: "wx", mode: 0o600 });
        await execute("/usr/bin/plutil", ["-lint", tmp]);
        if (active) await execute("/bin/launchctl", ["bootout", domain + "/" + label]);
        await fs.rename(tmp, file);
        await execute("/bin/launchctl", ["bootstrap", domain, file]);
      } finally { await fs.rm(tmp, { force: true }); }
      return { state: existing ? "updated" : "installed", intervalSeconds };
    },
    async uninstall() {
      assertOwner(await read());
      if (await loaded()) await execute("/bin/launchctl", ["bootout", domain + "/" + label]);
      await fs.rm(file, { force: true });
      return { state: "uninstalled" };
    },
  };
};
export const ensureWatchdog = async () => {
  if (process.platform !== "darwin") throw new Error("This installer is macOS only.");
  await config();
  await maintenanceKey();
  return withLock("negus-watchdog-install", () => createMacWatchdog().install());
};
export const main = async (args = process.argv.slice(2)) => {
  if (process.platform !== "darwin") throw new Error("This installer is macOS only.");
  const action = args[0] || "status";
  if (action === "install") console.log(JSON.stringify(await ensureWatchdog()));
  else if (action === "status") console.log(JSON.stringify(await createMacWatchdog().status()));
  else if (action === "uninstall") console.log(JSON.stringify(await withLock("negus-watchdog-install", () => createMacWatchdog().uninstall())));
  else throw new Error("Use install|status|uninstall.");
};
if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
