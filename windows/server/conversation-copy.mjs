// Convert a read-only transcript to native history. The same destination is used for
// a room, an employee, and a desktop thread; no source runtime is resumed.
import fs from 'node:fs/promises';
import { openRollout } from './rollout-file.mjs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function withCopyHistory(session, cwd, create) {
  if (!session) throw Object.assign(Error('找不到要复制的对话'), { statusCode: 404 });
  const id = randomUUID(), timestamp = new Date().toISOString();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-copy-'));
  const file = path.join(dir, 'rollout-' + timestamp.slice(0,19).replaceAll(':','-') + '-' + id + '.jsonl');
  try {
    const lines = [JSON.stringify({ timestamp, type: 'session_meta', payload: { id, timestamp, cwd,
      originator: 'negus', cli_version: '0.1.0', source: 'cli' } })];
    // Freeze the length on open: ignore an unfinished trailing record from a live writer.
    for (const file of session.paths || (session.path ? [session.path] : [])) {
      const handle = await openRollout(file);
      try {
        const { size } = await handle.stat();
        const buf = Buffer.alloc(size);
        let pos = 0;
        while (pos < size) {
          const { bytesRead } = await handle.read(buf, pos, size - pos, pos);
          if (!bytesRead) break;
          pos += bytesRead;
        }
        const first = buf.indexOf(10), end = buf.lastIndexOf(10, pos - 1);
        if (first < 0 || JSON.parse(buf.subarray(0, first).toString()).type !== 'session_meta')
          throw Error('原对话缺少历史文件头，未创建副本');
        if (end > first) lines.push(buf.subarray(first + 1, end).toString('utf8'));
      } finally { await handle.close(); }
    }
    for (const msg of session.messages || []) {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      const references = (msg.blocks || []).filter(b => b.type !== 'markdown' && (b.file?.path || b.source))
        .map(b => b.file?.path || b.source);
      const content = [msg.authorName && (msg.authorName + '：'), msg.text, ...references].filter(Boolean).join('\n');
      lines.push(JSON.stringify({ timestamp: msg.createdAt || timestamp, type: 'response_item',
        payload: { type: 'message', role, id: randomUUID(),
          content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: content }],
          ...(role === 'assistant' ? { phase: msg.phase || 'final_answer' } : {}) },
        negusCopy: { text: msg.text, blocks: msg.blocks, authorName: msg.authorName, modelSwitch: msg.modelSwitch } }));
    }
    await fs.writeFile(file, lines.join('\n') + '\n', { mode: 0o600 });
    return await create(id, { path: file, cwd, summary: { title: session.title } });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

export function roomTranscript(room) {
  let page = room.getMessagePage(), pages = [page.messages];
  while (page.hasOlder) {
    page = room.getMessagePage({ beforeSequence: page.oldestSequence });
    pages.push(page.messages);
  }
  return { title: room.snapshot().room.name, messages: pages.reverse().flat().map(m => ({
    role: m.type === 'human' ? 'user' : 'assistant', text: m.text, authorName: m.authorName, createdAt: m.createdAt,
    blocks: [...(m.text ? [{ id: m.id + '-text', type: 'markdown', text: m.text }] : []),
      ...(m.attachments || []).map(file => ({ id: file.id, name: file.name, file, source: file.url,
        type: /^(image|audio|video)\//.exec(file.mimeType)?.[1] || 'file' }))],
  })) };
}
