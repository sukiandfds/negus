import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { runtime } from "./negus-service-common.mjs";

// A deployed watchdog must read the same persistent credentials as the service.
export const initializeCredentials = async (directory = runtime, supplied = process.env.NEGUS_TOKEN) => {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, "access-token");
  const requested = (supplied || "").trim();
  if (/[\r\n]/u.test(requested)) throw new Error("Invalid NEGUS_TOKEN.");
  const candidate = requested || randomBytes(32).toString("hex");
  try { await fs.writeFile(file, candidate + "\n", { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const saved = (await fs.readFile(file, "utf8")).trim();
  if (!saved || /[\r\n]/u.test(saved)) throw new Error("Invalid runtime/access-token.");
  if (requested && requested !== saved) throw new Error("NEGUS_TOKEN differs from runtime/access-token; refusing inconsistent service/watchdog credentials.");
};

export const startManaged = async ({
  platform = process.platform,
  initialize,
  start = async () => {
    const { config, withLock } = await import("./negus-service-common.mjs");
    const { checkBackend, startBackend } = await import("./negus-backend.mjs");
    return withLock("negus-service-operation", async () => {
      const cfg = await config(), health = await checkBackend(cfg);
      if (health.state !== "absent") return health;
      await (await import("./negus-supervisor.mjs")).initializeManagedRelease();
      return startBackend(cfg);
    });
  },
  install = async () => (await import("./negus-watchdog-macos.mjs")).ensureWatchdog(),
} = {}) => {
  if (platform !== "darwin") throw new Error("Managed deployment currently supports macOS only. Windows: use start:demo; automatic recovery is not yet supported there.");
  await initialize();
  const backend = await start();
  if (!["healthy", "started"].includes(backend.state) || backend.frontend === "unavailable") {
    throw new Error("Deployment not ready: " + backend.state + "; watchdog was not installed.");
  }
  try {
    const watchdog = await install();
    return { state: "ready", backend, watchdog };
  } catch (error) {
    throw new Error("Backend is running, but automatic recovery setup failed: " + error.message + " Retry negus:start after correcting the issue.");
  }
};
