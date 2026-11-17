import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const failure = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode });
const requiredColumns = ["id", "app_type", "name", "settings_config", "meta", "is_current", "cost_multiplier", "created_at", "sort_index"];
// CC Switch v3.20.4 providers schema, including migration-added columns.
// Leave user_version at 0: CC Switch owns its complete schema and migrations.
// https://github.com/farion1231/cc-switch/blob/v3.20.4/src-tauri/src/database/schema.rs
const bootstrap = `CREATE TABLE providers (
 id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, settings_config TEXT NOT NULL,
 website_url TEXT, category TEXT, created_at INTEGER, sort_index INTEGER, notes TEXT,
 icon TEXT, icon_color TEXT, meta TEXT NOT NULL DEFAULT '{}',
 is_current BOOLEAN NOT NULL DEFAULT 0, in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
 cost_multiplier TEXT NOT NULL DEFAULT '1.0', limit_daily_usd TEXT, limit_monthly_usd TEXT,
 provider_type TEXT, PRIMARY KEY(id, app_type)
);`;
const sqlite = async () => {
  try { return await import("node:sqlite"); }
  catch { throw failure("当前 Node 版本不支持内置 SQLite，请使用 Negus 支持的 Node 22.16+（无需安装 Python）。"); }
};
const schemaCheck = (db) => {
  const columns = new Set(db.prepare("PRAGMA table_info(providers)").all().map(row => row.name));
  if (!requiredColumns.every(name => columns.has(name))) throw failure("共享配置数据库结构不兼容，原文件未修改。");
};
const exists = async (file) => {
  try { await fs.stat(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; }
};
const initialize = async (database, DatabaseSync) => {
  // Do not mask a legacy JSON migration by creating a database over it.
  if (await exists(path.join(path.dirname(database), "config.json"))) {
    throw failure("发现旧版 CC Switch 配置，需要先完成旧配置迁移；原文件未修改。", 409);
  }
  await fs.mkdir(path.dirname(database), { recursive: true, mode: 0o700 });
  const temporary = database + "." + randomUUID() + ".tmp";
  let db;
  try {
    const file = await fs.open(temporary, "wx", 0o600); await file.close();
    db = new DatabaseSync(temporary);
    db.exec(bootstrap);
    db.close(); db = null;
    // Publish a complete database without overwriting a concurrent creator.
    try { await fs.link(temporary, database); } catch (e) { if (e.code !== "EEXIST") throw e; }
  } finally { db?.close(); await fs.rm(temporary, { force: true }); }
};
export const operateSharedDatabase = async (database, request) => {
  const file = path.resolve(database);
  const { DatabaseSync, backup } = await sqlite();
  if (!await exists(file)) {
    if (request.action === "list") return [];
    if (request.action !== "save" || request.expectedConfig !== null) throw failure("配置已不存在，请刷新。", 409);
    await initialize(file, DatabaseSync);
  }
  let db;
  try {
    // Opening an existing file never bootstraps or migrates its schema.
    db = new DatabaseSync(file, { readOnly: request.action === "list" });
    db.exec("PRAGMA busy_timeout = 5000");
    schemaCheck(db);
    if (request.action === "list") return db.prepare("SELECT * FROM providers WHERE app_type='codex' ORDER BY sort_index,created_at").all();
    if (!["save", "delete"].includes(request.action)) throw failure("无效配置操作。", 400);
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > 19) throw failure("共享数据库来自更新版本的 CC Switch，暂不写入，请更新 Negus。", 409);
    // Other CC Switch tables can reference a provider with ON DELETE CASCADE.
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT * FROM providers WHERE app_type='codex' AND id=?").get(request.id);
    if ((row?.settings_config ?? null) !== request.expectedConfig
      || (request.expectedRow && JSON.stringify(row) !== request.expectedRow)) {
      throw failure("配置已被其他程序修改，请刷新后再保存。", 409);
    }
    if (row?.is_current) throw failure("当前启用配置暂不支持编辑或删除，以免影响正在使用的 Codex。", 409);
    if (request.action === "delete" && !row) throw failure("配置已不存在，请刷新。", 409);
    const backupDir = path.join(path.dirname(file), "backups");
    await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backupFile = path.join(backupDir, "negus-" + Date.now() + "-" + randomUUID() + ".db");
    const handle = await fs.open(backupFile, "wx", 0o600); await handle.close();
    const source = new DatabaseSync(file, { readOnly: true });
    try { await backup(source, backupFile); } finally { source.close(); }
    if (request.action === "delete") {
      db.prepare("DELETE FROM providers WHERE app_type='codex' AND id=?").run(request.id);
    } else if (row) {
      db.prepare("UPDATE providers SET name=?,settings_config=?,cost_multiplier=? WHERE app_type='codex' AND id=?")
        .run(request.name, request.config, request.multiplier, request.id);
    } else {
      db.prepare("INSERT INTO providers(id,app_type,name,settings_config,meta,is_current,cost_multiplier,created_at) VALUES(?,'codex',?,?,'{}',0,?,?)")
        .run(request.id, request.name, request.config, request.multiplier, Date.now());
    }
    db.exec("COMMIT");
    return { [request.action === "save" ? "saved" : "deleted"]: true };
  } catch (error) {
    try { db?.exec("ROLLBACK"); } catch {}
    if (error.statusCode) throw error;
    // SQLite errors must not relay user configuration or SQL values.
    throw failure("共享配置数据库操作失败，请检查文件权限或稍后重试。");
  } finally { db?.close(); }
};
