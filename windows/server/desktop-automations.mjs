import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';

// Read scheduler records only; never schedule or execute work.
export async function readDesktopAutomations({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex') } = {}) {
  const warnings = [];
  const entries = new Map();
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(path.join(codexHome, 'sqlite', 'codex-dev.db'), { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;');
    for (const row of db.prepare('SELECT id, name, status, rrule, next_run_at, last_run_at, kind, target_thread_id, notification_policy FROM automations').all()) {
      entries.set(row.id, { id: row.id, name: row.name, status: row.status, schedule: row.rrule, kind: row.kind,
        nextRunAt: row.next_run_at, lastRunAt: row.last_run_at, threadId: row.target_thread_id,
        notificationPolicy: row.notification_policy, source: 'Codex 自动化', runs: [] });
    }
    try {
      const query = db.prepare('SELECT thread_id, status, created_at, updated_at FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT 5');
      for (const item of entries.values()) item.runs = query.all(item.id).map((run) => ({ threadId: run.thread_id, status: run.status, createdAt: run.created_at, updatedAt: run.updated_at }));
    } catch { warnings.push('执行记录读取失败，配置列表仍可查看。'); }
  } catch { warnings.push('调度数据库暂不可读；下次执行时间和执行记录可能缺失。'); }
  finally { db?.close(); }
  try {
    const directories = await fs.readdir(path.join(codexHome, 'automations'), { withFileTypes: true });
    for (const directory of directories.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())) {
      try {
        const row = TOML.parse(await fs.readFile(path.join(codexHome, 'automations', directory.name, 'automation.toml'), 'utf8'));
        const id = String(row.id || directory.name);
        const existing = entries.get(id);
        if (!existing) entries.set(id, { id, name: row.name || id, status: row.status || 'UNKNOWN', schedule: row.rrule || '', kind: row.kind || 'cron',
          threadId: row.target_thread_id || null, notificationPolicy: row.notification_policy || null,
          nextRunAt: null, lastRunAt: null, source: 'Codex 自动化配置', runs: [] });
        else if (existing.status !== row.status || existing.schedule !== row.rrule) existing.warning = '调度记录与配置不一致，请在 Codex 中核对。';
      } catch { warnings.push(`一项自动化配置读取失败（${directory.name}）。`); }
    }
  } catch (error) { if (error.code !== 'ENOENT') warnings.push('自动化配置目录读取失败。'); }
  return { items: [...entries.values()].sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || a.name.localeCompare(b.name)),
    checkedAt: Date.now(), warnings, coverage: '本机 Codex 自动化；不含系统计划任务、其他设备或外部服务。' };
}

export function createDesktopAutomationReader(options) {
  let pending;
  let cached;
  return async () => {
    if (cached && Date.now() - cached.checkedAt < 5000) return cached;
    if (!pending) pending = readDesktopAutomations(options).then((result) => (cached = result)).finally(() => { pending = null; });
    return pending;
  };
}
