import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.setDefaultTimeout(7000);
const stamp = '2026-11-01T00:00:00Z', errors = [], calls = [], sends = [];
const summaries = ['a', 'b'].map(id => ({ threadId: id, source: 'codex', sourceRevision: 'r0', title: `对话${id}`, updatedAt: stamp,
  messageCount: 1, latestUser: '', latestAssistant: '', latestMessage: `历史${id}`, model: 'model-a' }));
const messages = new Map(summaries.map(s => [s.threadId, [{ id: `history-${s.threadId}`, role: 'assistant', text: `历史${s.threadId}`, createdAt: stamp }]]));
const queues = new Map(), statuses = new Map(), settings = new Map(), goals = new Map(), inputs = new Map();
const idle = id => ({ type: 'execution_status', threadId: id, phase: 'idle', active: false, turnId: '', activities: [], startedAt: null, updatedAt: stamp, label: '', detail: '', commentary: '' });
const context = id => ({ type: 'context_status', threadId: id, model: 'model-a', reasoningEffort: 'high', phase: 'idle', percentage: 10, usedTokens: 10, contextWindow: 100, autoCompactThreshold: 80, updatedAt: stamp, message: '', ...settings.get(id) });
const detail = id => ({ ...summaries.find(s => s.threadId === id), messages: messages.get(id) || [] });
const photo = { id: 'photo', name: 'photo.png', mimeType: 'image/png', url: '/api/media/photo', size: 68 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let sendMode = 'accepted', holdSend = false, releaseSend, releaseCreate, holdCreate = false, pageRequest;
let holdRead = false, releaseRead, heldId = '', readGate, failRead = false, failedReads = 0;
const receipt = new Map();
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(({ summaries, details, stamp }) => {
  if (!localStorage.getItem('negus-conversation-snapshot-v1')) localStorage.setItem('negus-conversation-snapshot-v1', JSON.stringify({ version: 1, savedAt: stamp,
    selectedId: 'a', sessions: summaries, session: details[0], recentSessions: [{ savedAt: stamp, isPartial: true,
      session: { ...details[1], sourceSignature: JSON.stringify(summaries[1]), messages: [{ ...details[1].messages[0], text: '缓存截断b' }] } }] }));
  const sources = []; window.sources = sources;
  window.EventSource = class { constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); } close() {} };
  window.emit = event => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(event) }));
}, { summaries, details: summaries.map(s => detail(s.threadId)), stamp });
const acceptedMessage = body => ({ id: `native-${body.submissionId}`, submissionId: body.submissionId, role: 'user', text: body.text,
  turnId: `turn-${body.submissionId}`, createdAt: new Date().toISOString(), blocks: body.attachmentIds?.length ? [{ id: `text-${body.submissionId}`, type: 'markdown', text: body.text }, { id: `image-${body.submissionId}`, type: 'image', source: photo.url, file: photo }] : undefined });
const record = body => {
  const list = messages.get(body.threadId) || [];
  if (!list.some(message => message.submissionId === body.submissionId)) list.push(acceptedMessage(body));
  messages.set(body.threadId, list);
  const summary = summaries.find(s => s.threadId === body.threadId);
  summary.sourceRevision = `r${list.length}`;
};
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
  if (!path.startsWith('/api/')) return route.continue();
  const body = ['POST', 'DELETE'].includes(method) && path !== '/api/uploads' ? request.postDataJSON() : {};
  const id = url.searchParams.get('threadId') || body?.threadId || 'a';
  calls.push({ path, method, id, view: url.searchParams.get('view'), sourceRevision: url.searchParams.get('sourceRevision'), body });
  let data = {};
  if (path === '/api/project') data = { name: '项目', root: '/fixture', mode: 'interactive' };
  else if (path === '/api/project-directory') data = { projects: [] };
  else if (path === '/api/sessions') data = summaries;
  else if (path === '/api/models') data = [{ id: 'model-a', model: 'model-a', displayName: '模型A', available: true, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }, { id: 'model-b', model: 'model-b', displayName: '模型B', available: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }];
  else if (path === '/api/model-defaults') data = { providerId: 'current', model: 'model-a', effort: 'high', archivedProviderIds: [] };
  else if (path === '/api/model-channels') data = { channels: [] };
  else if (path === '/api/group/rooms') data = { rooms: [] };
  else if (path === '/api/uploads') data = photo;
  else if (path === '/api/media/photo') return route.fulfill({ contentType: 'image/png', body: png });
  else if (path === '/api/session/model') { data = { threadId: id, model: body.model, reasoningEffort: body.reasoningEffort || 'high' }; settings.set(id, data); }
  else if (path === '/api/session/reasoning-effort') data = { threadId: id, model: settings.get(id)?.model || 'model-a', reasoningEffort: body.reasoningEffort };
  else if (path === '/api/session/interrupt') { statuses.set(id, idle(id)); data = { threadId: id, status: 'interrupted' }; await page.evaluate(event => window.emit(event), idle(id)); }
  else if (path === '/api/session/goal' && method === 'POST') { const goal = { ...goals.get(id), ...body, updatedAt: Date.now() / 1000 }; goals.set(id, goal); data = { goal }; }
  else if (path === '/api/session/goal' && method === 'DELETE') { goals.delete(id); data = { goal: null }; }
  else if (path === '/api/session/user-input' && method === 'POST') { inputs.delete(id); data = { threadId: id, status: 'answered' }; }
  else if (path === '/api/session/submission') data = receipt.get(url.searchParams.get('submissionId')) || { threadId: id, status: 'unknown' };
  else if (path === '/api/session/message') {
    sends.push(body);
    const mode = sendMode;
    if (holdSend) await new Promise(resolve => releaseSend = resolve);
    if (mode !== 'accepted') {
      const error = mode === 'occupied' ? 'already has an active writer' : '模拟图片发送失败';
      receipt.set(body.submissionId, { threadId: id, submissionId: body.submissionId, status: 'failed', error });
      return route.fulfill({ status: 503, json: { error } });
    }
    record(body);
    receipt.set(body.submissionId, { threadId: id, submissionId: body.submissionId, status: 'accepted', turnId: `turn-${body.submissionId}` });
    data = { threadId: id, turnId: `turn-${body.submissionId}`, status: 'accepted' };
  } else if (path === '/api/session/queue' && method === 'POST') {
    const items = queues.get(id) || [];
    if (body.action === 'remove') queues.set(id, items.filter(item => item.id !== body.itemId));
    else if (body.action === 'sendNow') {
      const item = items.find(entry => entry.id === body.itemId);
      record({ ...item, threadId: id });
      queues.set(id, items.filter(entry => entry.id !== body.itemId));
      await page.evaluate(event => window.emit(event), { type: 'user_message_accepted', threadId: id, submissionId: item.submissionId, turnId: `turn-${item.submissionId}` });
    }
    else { items.push({ id: body.submissionId, ...body, attachments: [], state: 'pending', createdAt: new Date().toISOString() }); queues.set(id, items); }
    data = { items: queues.get(id) };
  } else if (path === '/api/session' && method === 'POST') {
    if (holdCreate) await new Promise(resolve => releaseCreate = resolve);
    data = { ...summaries[0], threadId: 'created', title: '新建的对话', sourceRevision: 'r0', messageCount: 0, model: body.model };
    summaries.push(data); messages.set('created', []);
  } else if (path === '/api/session') {
    if (holdRead && id === heldId) await readGate;
    if (failRead && id === heldId) { failedReads++; return route.fulfill({ status: 503, json: { error: 'fixture read failure' } }); }
    if (url.searchParams.has('cursor')) {
      pageRequest = id;
      data = { ...detail(id), hasMore: false, messages: [{ id: 'older-page', role: 'assistant', text: '翻页读取的更早历史', createdAt: '2026-10-01T00:00:00Z' }] };
    } else {
      const session = { ...detail(id), hasMore: id === 'a', nextCursor: id === 'a' ? 'older' : null };
      data = url.searchParams.get('view') === '1' ? { session: url.searchParams.get('sourceRevision') === session.sourceRevision ? null : session,
        sourceRevision: session.sourceRevision, context: context(id), status: statuses.get(id) || idle(id), goal: goals.get(id) || null, queue: queues.get(id) || [], input: inputs.get(id) || null } : session;
    }
  }
  await route.fulfill({ json: data });
});
const composer = () => page.locator('.chat-composer > div:visible textarea');
const send = async text => { await composer().fill(text); await composer().press('Enter'); };
const open = id => page.getByRole('button', { name: `打开对话${id}`, exact: true }).click();
const bubble = text => page.locator('.chat-messages').getByText(text, { exact: true });
const wait = async predicate => { const deadline = Date.now() + 6500; while (!predicate()) { if (Date.now() > deadline) throw Error('fixture condition timed out'); await page.waitForTimeout(25); } };
const readCache = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('negus-conversations', 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction(['threads', 'metadata'], 'readonly');
    const threads = tx.objectStore('threads').getAll(), metadata = tx.objectStore('metadata').get('snapshot');
    tx.oncomplete = () => { db.close(); resolve({ threads: threads.result, metadata: metadata.result }); };
    tx.onerror = tx.onabort = () => reject(tx.error);
  };
}));

try {
 await page.goto('http://127.0.0.1:5201/?thread=a');await bubble('历史a').waitFor();
 await page.waitForFunction(()=>document.querySelector('button[aria-label="刷新会话"]')?.getAttribute('aria-busy')==='false');
 let index=0;
 for(const switchAway of [false,true])for(const mode of ['failed','occupied']){
  sendMode=mode;const text=`真实失败图-${mode}-${index++}`;
  await page.locator('.chat-composer > div:visible input[type=file]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
  await send(text);
  const reason=mode==='failed'?'模拟图片发送失败':'already has an active writer';
  const shownReason=mode==='occupied'?'Codex 占用中，未发送':reason;
  await page.getByText(shownReason,{exact:true}).last().waitFor();
  if(switchAway)await open('b');
  await page.reload();
  if(switchAway){await bubble('历史b').waitFor();await open('a')}
  await bubble(text).waitFor();await page.getByText(shownReason,{exact:true}).last().waitFor();
  const saved=await readCache(),record=saved.threads.find(r=>r.threadId==='a').entry.session.messages.find(m=>m.text===text);
  assert.ok(record);assert.equal(record.deliveryState,mode);assert.equal(record.deliveryError,reason);assert.equal(record.blocks.find(b=>b.type==='image').file.id,'photo');
  assert.ok(await page.locator('.chat-messages img[src*="/api/media/photo"]').count());
  console.log(`PASS 实际${mode}图片发送后${switchAway?'切B刷新再切A':'留在A直接刷新'}：文字/图片/状态/原因均在UI及磁盘保留`);
 }
 assert.deepEqual(errors,[]);console.log('PASS targeted 4/4');
}finally{await browser.close()}
