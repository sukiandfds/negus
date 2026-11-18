import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1000,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('http://127.0.0.1:5198/validation/mermaid.html');
 await page.getByLabel('Mermaid 流程图').locator('svg').waitFor();
 await page.getByRole('button',{name:'放大查看',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'流程图放大预览'});await dialog.waitFor();
 const transform=()=>dialog.locator('.react-transform-component').evaluate(e=>getComputedStyle(e).transform);
 await page.waitForTimeout(150);const before=await transform();
 await page.getByLabel('放大图表',{exact:true}).click();await page.waitForTimeout(400);assert.notEqual(await transform(),before);
 await page.getByRole('button',{name:'原始大小',exact:true}).click();await page.waitForTimeout(400);
 const beforeDrag=await transform();await page.mouse.move(450,400);await page.mouse.down();await page.mouse.move(550,450,{steps:10});await page.mouse.up();await page.waitForTimeout(400);assert.notEqual(await transform(),beforeDrag);
 const beforeWheel=await transform();await page.mouse.wheel(0,-200);await page.waitForTimeout(400);assert.notEqual(await transform(),beforeWheel);
 await page.getByRole('button',{name:'适应窗口',exact:true}).click();
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.getByLabel('Mermaid 流程图').focus();await page.keyboard.press('Enter');await dialog.waitFor();
 await page.getByLabel('关闭图表预览').click();await dialog.waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:800});await page.getByRole('button',{name:'放大查看',exact:true}).click();await dialog.waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'work/mermaid-20261116/viewer-mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS open, zoom buttons, drag, wheel, fit, Esc, keyboard, close, mobile');
} finally {await browser.close();}
