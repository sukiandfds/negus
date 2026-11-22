import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {conversationContext} from '../server/conversation-context.mjs';
import {conversationPrompt, modelContext} from '../server/conversation-prompt.mjs';

test('unchanged turns, two chats, profile edits, failed delivery, clearing and compaction', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'negus-profile-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const session = conversationContext(root);
  const file = path.join(root,'USER_PROFILE.md');
  const send = (id, fail=false) => session.send('turn/start',{
    threadId:id, developerInstructions:conversationPrompt(),
    additionalContext:{...modelContext('model'), other:{kind:'application',value:'keep'}}
  }, async (_, p) => { if (fail) throw Error('refused'); return p.additionalContext; });
  await fs.writeFile(file,'第一版');
  for(const id of ['front','employee']) {
    assert.match((await send(id))['negus.profile'].value,/第一版/);
    for(let i=0;i<2;i++) assert.deepEqual(Object.keys(await send(id)),['other']);
  }
  await fs.writeFile(file,'第二版');
  await assert.rejects(send('front',true),/refused/);
  for(const id of ['front','employee']) {
    assert.match((await send(id))['negus.profile'].value,/第二版/);
    assert.deepEqual(Object.keys(await send(id)),['other']);
  }
  session.reset('employee');
  assert.match((await send('employee'))['negus.profile'].value,/第二版/);
  await fs.unlink(file);
  assert.match((await send('front'))['negus.profile'].value,/清空/);
  assert.deepEqual(Object.keys(await send('front')),['other']);
});
