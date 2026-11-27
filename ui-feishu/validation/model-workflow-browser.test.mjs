import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {migrationTargets, modelWorkflow, vip} from '../../windows/tests/model-workflow.fixture.mjs';

const require=createRequire(realpathSync(new URL('../node_modules/vite/package.json',import.meta.url)));
const {build}=require('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

test('real external activity page keeps the caller, original conversation and switch state after reload',async t=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
import{SettingsPage}from'./shared/features/settings/SettingsPage';
import{Message}from'./shared/features/conversations/components/ConversationView';
const query=new URLSearchParams(location.search);
const root=createRoot(document.querySelector('main'));
if(query.has('settings'))root.render(<SettingsPage onClose={()=>{}}/>);
else fetch('/api/session?threadId='+query.get('thread')+'&conversationId='+query.get('conversation'))
  .then(r=>r.json()).then(session=>root.render(session.messages.map(message=><Message key={message.id} message={message}/>)));`,
    loader:'tsx',resolveDir:new URL('..',import.meta.url).pathname},bundle:true,jsx:'automatic',write:false,
    loader:{'.css':'empty','.module.css':'empty'},define:{'process.env.NODE_ENV':'"production"',__APP_BUILD_ID__:'"test"'}});
  const f=await modelWorkflow(t,(_req,res,u)=>{
    if(u.pathname==='/app.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(bundle.outputFiles[0].contents);return true;}
    if(u.pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<meta charset=utf-8><main></main><script src="/app.js"></script>');return true;}
    return false;
  });
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  t.after(()=>browser.close());
  const context=await browser.newContext();
  await context.route('**/*',r=>r.request().url().startsWith(f.origin+'/')?r.continue():r.abort());
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(f.origin+'/?settings=external');
  await page.getByLabel('账号邮箱').fill('fixture@example.invalid');
  await page.getByLabel('邮箱验证码').fill('123456');
  await page.getByRole('button',{name:'验证本人账号'}).click();
  await page.getByLabel('查看范围').selectOption('worker-1');
  const thread=f.ids['fixture-1'];
  const profile=f.registry.require('fixture-1');
  f.controls.failStart=Object.assign(Error('upstream response: test-private'),{httpStatus:402,statusCode:502});
  assert.equal((await f.api('/api/session/message',{threadId:thread,conversationId:profile.conversationId,submissionId:'browser-failed',text:'这里是失败的原消息'})).status,502);
  f.controls.failStart=null;
  const {model,effort}=migrationTargets[1];
  assert.equal((await f.call('conversation_model_set',{project:'worker-1',thread,model,effort,modelProviderId:vip})).state,'pending_application');
  const pending=page.getByRole('listitem').filter({hasText:'切换对话模型 · 待生效'});
  await pending.getByText(/Muse · 00/).waitFor();
  await pending.getByText(new RegExp('原配置：current / fixture-a → 所选配置：'+vip+' / '+model+' / '+effort)).waitFor();
  const href=await pending.getByRole('link',{name:'风控质量主对话'}).getAttribute('href');
  assert.equal(href,'/?thread='+thread);
  assert.equal((await f.api('/api/session/message',{threadId:thread,conversationId:profile.conversationId,submissionId:'browser-fixture-send',text:'原对话续聊'})).status,202);
  await page.getByText(/Muse · 00 · 切换对话模型 · 已生效/).waitFor();
  await page.reload();
  await page.getByLabel('查看范围').selectOption('worker-1');
  await page.getByText(/Muse · 00 · 切换对话模型 · 已生效/).waitFor();
  await page.getByText(/对话编号/).filter({hasText:thread}).first().waitFor();
  await page.goto(f.origin+href+'&conversation='+profile.conversationId);
  await page.reload();
  const bubble=page.locator('article').filter({hasText:'这里是失败的原消息'});
  await bubble.getByText(/余额不足（402）/).waitFor();
  await page.getByText('原历史 风控质量').waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(),/test-private/);
});
