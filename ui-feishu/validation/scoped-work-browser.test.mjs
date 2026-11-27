import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync,existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {scopedDispatch} from '../../windows/server/external-assistant/dispatch.mjs';
const rootDir=fileURLToPath(new URL('../../',import.meta.url));
test('来源会话展开已完成的实际离线任务，仅显示文本并保留来源和调用编号',{skip:!existsSync(path.join(rootDir,'runtime/scoped-text-runtime/qwen.gguf'))},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'negus-work-visible-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project={projectId:'check',name:'隔离验收',kind:'employee',employeeId:'editor',conversations:[{threadId:'source'}]};
  const service=scopedDispatch({projectRoot:root,engineRoot:rootDir,directory:{list:async()=>({projects:[project]})}});
  const receipt=await service.createTask({project,threadId:'source',actor:'验收客户端',credentialId:'isolated',requestId:'one',callId:'验收调用',
    brief:'翻译 apple 为中文。',acceptance:'只回复中文译文。',checkGrant:async()=>{}});
  assert.ok(receipt.startup.confirmed);
  while(service.hasPendingWork())await new Promise(r=>setTimeout(r,30));
  const rows=await service.forView('source');assert.match(rows[0].result,/苹果/);
  const require=createRequire(realpathSync(new URL('../node_modules/vite/package.json',import.meta.url)));
  const {build}=require('esbuild'),{chromium}=require(process.env.PLAYWRIGHT_PATH||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const bundle=await build({stdin:{contents:"import{createRoot}from'react-dom/client';import{ThreadExternalWork}from'./shared/features/conversations/components/ExternalWorkResult';createRoot(document.querySelector('main')).render(<ThreadExternalWork rows={window.rows}/>);",loader:'tsx',resolveDir:path.join(rootDir,'ui-feishu')},bundle:true,jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'}});
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();await page.setContent('<main></main>');await page.evaluate(rows=>window.rows=rows,rows);await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByText('本会话的外部派活（1）').click();const visible=await page.locator('article').innerText();
  for(const text of ['验收客户端','隔离验收','已完成','苹果',receipt.task.id,'验收调用'])assert.ok(visible.includes(text),text);
});
