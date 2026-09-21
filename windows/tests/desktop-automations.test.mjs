import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readDesktopAutomations } from '../server/desktop-automations.mjs';

test('scheduler database is read-only, file-only tasks are included, secret prompts excluded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'negus-automation-test-'));
  try {
    await mkdir(path.join(root, 'sqlite'));
    await mkdir(path.join(root, 'automations', 'file-only'), { recursive: true });
    await writeFile(path.join(root, 'automations', 'file-only', 'automation.toml'), 'id="file-only"\nname="配置任务"\nstatus="PAUSED"\nrrule="FREQ=DAILY"\nprompt="SECRET"');
    const db = new DatabaseSync(path.join(root, 'sqlite', 'codex-dev.db'));
    db.exec("CREATE TABLE automations(id TEXT,name TEXT,status TEXT,rrule TEXT,next_run_at INTEGER,last_run_at INTEGER,kind TEXT,target_thread_id TEXT,notification_policy TEXT); CREATE TABLE automation_runs(thread_id TEXT,automation_id TEXT,status TEXT,created_at INTEGER,updated_at INTEGER); INSERT INTO automations VALUES('task','真实任务','ACTIVE','FREQ=DAILY',1000,500,'cron','thread','failed_runs_only'); INSERT INTO automation_runs VALUES('run','task','FAILED',100,200);");
    const data = await readDesktopAutomations({ codexHome: root });
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].nextRunAt, 1000);
    assert.equal(data.items[0].runs[0].status, 'FAILED');
    assert.deepEqual(data.warnings, []);
    assert.ok(!JSON.stringify(data).includes('SECRET'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM automations').get().n, 1);
    db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unreadable data is not represented as a verified empty task list', async () => {
  const result = await readDesktopAutomations({ codexHome: path.join(os.tmpdir(), 'negus-no-such-automation-source') });
  assert.deepEqual(result.items, []);
  assert.ok(result.warnings.length > 0);
});
