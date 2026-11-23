import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('moving the installation moves every guide, independently of the chat working directory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-guide-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = new URL('../server/', import.meta.url);
  const first = path.join(root, '安装 A');
  const second = path.join(root, '迁移 B');
  await fs.mkdir(first);
  for (const name of ['negus-tool-prompt.mjs', 'tool-guides']) {
    await fs.cp(new URL(name, source), path.join(first, name), { recursive: true });
  }
  for (const dir of [first, second]) {
    if (dir === second) await fs.rename(first, second);
    const { negusToolPrompt } = await import(pathToFileURL(path.join(dir, 'negus-tool-prompt.mjs')));
    const prompt = negusToolPrompt();
    const base = prompt.split('\n').find(line => line.startsWith('说明文件相对于：')).split('：')[1];
    const entries = JSON.parse(await fs.readFile(path.join(base, 'catalog.json'), 'utf8'));
    assert.equal(new Set(entries.map(x => x.command)).size, entries.length);
    for (const entry of entries) {
      assert.match(entry.path, /^[a-z-]+\/SKILL\.md$/);
      assert.ok(prompt.includes(entry.command + ' | ') && prompt.includes(' | ' + entry.path));
      const guide = await fs.readFile(path.join(base, entry.path), 'utf8');
      assert.ok(guide.startsWith('# ' + entry.label) || (guide.startsWith('---\n') && guide.split('\n---\n')[0].split('\n').includes('name: ' + entry.id)));
      assert.ok(!prompt.includes(guide.trim()));
      for (const drive of ['C:', 'D:']) {
        const winBase = drive + '\\我的 Negus\\tool-guides';
        assert.equal(path.win32.relative(winBase, path.win32.resolve(winBase, entry.path)), entry.path.replace('/', '\\'));
      }
    }
  }
});
