import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
const require=createRequire(realpathSync(new URL('../node_modules/vite/package.json',import.meta.url)));
const {build}=require('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
test('cold-open blocked employee goal: close sends correct binding before any goal event or edit',async t=>{
 const js=await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{useThreadGoal}from'./shared/features/goals/hooks/useThreadGoal';import{GoalControl}from'./shared/features/goals/components/GoalControl';
 let goal={threadId:'emp',status:'blocked',objective:'工作目标',updatedAt:100,timeUsedSeconds:0,tokensUsed:0};
 const store={get:()=>({goal}),update:(_,v)=>{goal=v.goal},committed:new Map(),synced:new Set(),dismissedGoals:new Map()};
 function Panel(){const s=useThreadGoal('emp',store);return s.goal?<GoalControl {...s} onClear={()=>s.clear()}/>:<span>普通对话</span>}
 createRoot(document.body.appendChild(document.createElement('main'))).render(<Panel/>);`},bundle:true,jsx:'automatic',write:false,loader:{'.module.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());
 const page=await browser.newPage();let received;
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.pathname==='/api/session/goal'){received=r.request().postDataJSON();return r.fulfill({status:received.conversationId==='agent-1'?200:409,contentType:'application/json',body:'{"goal":null}'});}
 return r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});});
 await page.goto('http://localhost/?thread=emp&conversation=agent-1');await page.addScriptTag({content:js.outputFiles[0].text});
 await page.getByRole('button',{name:'清除目标'}).click();await page.getByText('普通对话').waitFor({timeout:3000});
 assert.deepEqual(received,{threadId:'emp',conversationId:'agent-1'});
});
