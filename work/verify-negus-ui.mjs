import {chromium} from '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import {config} from '../scripts/negus-service-common.mjs';
const cfg=await config();const {threadId}=JSON.parse(await fs.readFile('work/production-demo-thread.json','utf8'));
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
const context=await b.newContext({viewport:{width:1360,height:1000}});await context.addCookies([{name:'codex_demo_token',value:cfg.token,url:`http://127.0.0.1:${cfg.port}`}]);
const p=await context.newPage();await p.goto(`http://127.0.0.1:${cfg.port}/?view=conversation&thread=${threadId}`,{waitUntil:'networkidle',timeout:30000});
console.log('TITLE',await p.title());console.log('BODY',(await p.locator('body').innerText()).slice(-4500));await p.screenshot({path:'work/negus-production-conversation.png'});
}finally{await b.close();}
