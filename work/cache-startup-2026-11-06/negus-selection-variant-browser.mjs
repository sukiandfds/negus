import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const stamp = '2026-10-30T00:00:00Z';
const summaries = Array.from({ length: 25 }, (_, i) => ({ threadId: `t${i}`, sourceRevision: 'r1', source: 'codex', title: `对话${i}`, updatedAt: new Date(Date.parse(stamp) - i * 1000).toISOString(), messageCount: 2, latestMessage: `摘要${i}`, latestUser: '', latestAssistant: '' }));
const detail = id => ({ ...summaries[Number(id.slice(1))], historyFormatVersion: 3, hasMore: true, nextBefore: 1, messages: [{ id: `old-${id}`, role: 'user', text: `历史${id}`, createdAt: stamp }, { id: `m-${id}`, role: 'assistant', text: `正文${id}${summaries[Number(id.slice(1))].sourceRevision === 'r2' ? '-更新' : ''}`, createdAt: stamp }] });
const calls = [], errors = [];
let active = 0, peak = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()} ${request.failure()?.errorText}`));
await page.addInitScript(({ summaries, details, stamp }) => {
  localStorage.setItem('negus-conversation-snapshot-v1', JSON.stringify({ version: 1, savedAt: stamp, selectedId: 't0', sessions: summaries, session: details[0], recentSessions: details.slice(1).map(session => ({ savedAt: stamp, session })) }));
  const sources = []; window.EventSource = class { constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); } close() {} };
  window.emitFixture = event => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(event) }));
}, { summaries, details: summaries.map(s => detail(s.threadId)), stamp });
await page.route('**/api/**', async route => {
  const u = new URL(route.request().url()), p = u.pathname, id = u.searchParams.get('threadId') || 't0';
  if (!p.startsWith('/api/')) return route.continue();
  let data = {};
  if (p === '/api/project') data = { name: '项目', root: '/fixture', mode: 'interactive' };
  else if (p === '/api/project-directory') data = { projects: [] };
  else if (p === '/api/sessions') data = summaries;
  else if (p === '/api/session') {
    calls.push({ id, revision: u.searchParams.get('sourceRevision') });
    peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 30)); --active;
    const index = Number(id.slice(1));
    data = { session: u.searchParams.get('sourceRevision') === summaries[index].sourceRevision ? null : detail(id), sourceRevision: summaries[index].sourceRevision, historyFormatVersion: 3,
      context: { type: 'context_status', threadId: id, model: '', reasoningEffort: '', phase: 'idle' }, status: { type: 'execution_status', threadId: id, phase: 'idle', active: false, activities: [] }, goal: null, queue: [], input: null };
  } else if (p === '/api/models') data = [];
  else if (p === '/api/model-channels') data = { channels: [] };
  else if (p === '/api/group/rooms') data = { rooms: [] };
  await route.fulfill({ json: data });
});

const results=[];const check=async(name,fn)=>{try{await fn();results.push({name,pass:true});console.log('PASS '+name)}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL '+name+' '+e.message)}};
const count=id=>calls.filter(c=>c.id===id).length;
const click=id=>page.getByRole('button',{name:`打开对话${id}`,exact:true}).click();
try {
 await page.goto(`http://127.0.0.1:${process.env.TEST_PORT||5205}/?thread=t0`);
 await page.waitForFunction(()=>document.querySelector('button[aria-label="刷新会话"]')?.getAttribute('aria-busy')==='false');
 await page.waitForTimeout(250);
 await check('首轮仍只更新最近20个且最多4路',async()=>{assert.deepEqual([...new Set(calls.map(c=>c.id))].sort(),summaries.slice(0,20).map(s=>s.threadId).sort());assert.ok(peak<=4)});
 await check('已同步无变化的t1/t0切换零详情GET',async()=>{const before=calls.length;await click(1);await click(0);await page.waitForTimeout(300);assert.equal(calls.length-before,0)});
 await check('从未打开过20外t22首次打开仍读取',async()=>{await click(22);await page.getByText('正文t22',{exact:true}).waitFor();await page.waitForTimeout(200);assert.equal(count('t22'),1)});
 await click(0);await page.waitForTimeout(200);
 summaries[22].sourceRevision='r2';summaries[22].latestMessage='目录新摘要t22';
 await page.evaluate(()=>window.emitFixture({type:'sessions_changed'}));
 await page.getByText('目录新摘要t22',{exact:false}).first().waitFor();await page.waitForTimeout(300);
 await check('20外已看过对话仅目录更新不后台读取',async()=>{assert.equal(count('t22'),1)});
 await check('20外已看过且目录版本变更，再打开读取新正文',async()=>{await click(22);await page.getByText('正文t22-更新',{exact:true}).waitFor({timeout:2500});assert.equal(count('t22'),2)});
 await check('20外读取后再无变化切换零详情GET',async()=>{await click(0);await page.waitForTimeout(250);const before=calls.length;await click(22);await page.waitForTimeout(300);assert.equal(calls.length-before,0)});
 await check('未打开过t24仍读取',async()=>{await click(24);await page.getByText('正文t24',{exact:true}).waitFor();assert.equal(count('t24'),1)});
 await check('运行中的t2真实变化仍读取',async()=>{const before=count('t2');summaries[2].sourceRevision='r2';summaries[2].latestMessage='运行新摘要t2';await page.evaluate(()=>{window.emitFixture({type:'execution_status',threadId:'t2',phase:'working',active:true,activities:[],turnId:'running'});window.emitFixture({type:'sessions_changed',threadId:'t2'})});await page.waitForTimeout(600);assert.ok(count('t2')>before)});
 await check('手动刷新仍重新读取',async()=>{const before=calls.length;await page.getByRole('button',{name:'刷新会话',exact:true}).click();await page.waitForTimeout(600);assert.ok(calls.length>before)});
 console.log(JSON.stringify({port:process.env.TEST_PORT,results,peak,calls}));
}finally{await browser.close()}
