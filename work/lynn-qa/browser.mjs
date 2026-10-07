import { chromium } from '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='/Users/hans/myproject/negus', app='/Users/hans/myproject/lynn-photo-workbench';
const {token,origin}=JSON.parse(await fs.readFile(root+'/work/lynn-qa/access.json','utf8'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
await context.addCookies([{name:'codex_demo_token',value:token,url:origin}]);
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir(root+'/work/lynn-qa/screenshots',{recursive:true});
try {
 await page.goto(origin+'/?view=desktop');
 await page.getByRole('link',{name:'仿拍生图'}).click();
 await page.getByRole('heading',{name:'把灵感，拍成你。'}).waitFor();
 assert.equal(await page.locator('input[type=file]').count(),2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:root+'/work/lynn-qa/screenshots/mobile-empty.png',fullPage:true});
 const persona=app+'/charactertest/夏沐人设图/persona-01-夏日校园.png';
 const reference=app+'/charactertest/2026-07-06-韩系街头白裙/ref-01-35fb6bf08282c6da05404ce7.jpg';
 await page.getByLabel('上传人设图',{exact:true}).setInputFiles(persona);
 await page.getByRole('img',{name:'人设预览'}).waitFor();
 await page.getByLabel('上传仿拍参考图',{exact:true}).setInputFiles(reference);
 await page.getByRole('img',{name:'仿拍参考预览'}).waitFor();
 await page.locator('summary').click();
 await page.getByLabel('成片目标描述',{exact:true}).fill('保持自然街拍质感');
 await page.getByLabel('补充要求 / 禁止项',{exact:true}).fill('不要水印');
 await page.getByLabel('分辨率',{exact:true}).selectOption('2K');
 let job=null, submits=0, requestBody;
 const resultBytes=await fs.readFile(persona);
 await page.route('https://image-test.invalid/result.png',r=>r.fulfill({contentType:'image/png',body:resultBytes}));
 await page.route('**/api/apps/lynn/api/jobs**',async route=>{
  if(route.request().method()==='POST') {submits++;requestBody=route.request().postDataJSON();job={id:requestBody.id,state:'generating',createdAt:new Date().toISOString()};}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(job)});
 });
 await page.getByRole('button',{name:'生成仿拍',exact:true}).click();
 await page.getByRole('heading',{name:'正在生成你的照片'}).waitFor();
 await page.waitForFunction(()=>Boolean(JSON.parse(localStorage.getItem('lynn.mobile.draft.v1') || '{}').jobId));
 await page.reload();await page.getByRole('heading',{name:'正在生成你的照片'}).waitFor();
 job={...job,state:'ready',url:'https://image-test.invalid/result.png',saveState:'saving'};
 await page.getByText('成片已展示',{exact:false}).waitFor();
 assert.equal(submits,1);assert.equal(requestBody.resolution,'2K');assert.ok(requestBody.prompt.includes('保持自然街拍质感'));assert.ok(requestBody.prompt.includes('不要水印'));
 assert.ok(!requestBody.prompt.includes('Image 3'));
 await page.screenshot({path:root+'/work/lynn-qa/screenshots/mobile-result.png',fullPage:true});
 for (const width of [320, 768, 1440]) { await page.setViewportSize({width,height:1000}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow at ${width}`); }
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:root+'/work/lynn-qa/screenshots/desktop-result.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('link',{name:'Negus',exact:true}).click();
 await page.getByRole('link',{name:'仿拍生图'}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('view'),'desktop');
 const unauthorized=await fetch(origin+'/api/apps/lynn/');assert.equal(unauthorized.status,401);
 const assetUnauthorized=await fetch(origin+'/api/apps/lynn/api/assets/test.png');assert.equal(assetUnauthorized.status,401);
 console.log(JSON.stringify({result:'passed',viewports:[320,390,768,1440],uploads:2,submits,promptPreserved:true,reloadResumes:true,urlVisibleBeforeSave:true,desktopRoundTrip:true,unauthenticatedStatus:401,browserErrors:errors},null,2));
} catch(e) {console.log(await page.locator('body').innerText()); console.log('errors',errors); throw e;} finally {await browser.close();}
