import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require('/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 for(const width of [1000,390]) {
  const page=await browser.newPage({viewport:{width,height:800}});
  await page.goto('http://127.0.0.1:5198/validation/mermaid.html');
  await page.getByLabel('图表代码').fill('flowchart LR\n A[第一步输入] --> B[第二步检查] --> C[第三步处理] --> D[第四步生成] --> E[第五步查看] --> F[第六步完成]');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Mermaid 流程图"]')?.textContent.includes('第六步完成'));
  const opener=page.getByRole('button',{name:'放大查看',exact:true}),dialog=page.getByRole('dialog',{name:'流程图放大预览'});
  for(const close of ['button','backdrop','escape']) {
   await opener.click();await dialog.waitFor();
   await page.waitForFunction(()=>{const svg=document.querySelector('dialog svg'),canvas=document.querySelector('dialog .react-transform-wrapper');if(!svg||!canvas)return false;const a=svg.getBoundingClientRect(),b=canvas.getBoundingClientRect();return a.width<=b.width && a.left>=b.left-1 && a.right<=b.right+1;});
   if(close==='button') await page.getByLabel('关闭图表预览').click();else if(close==='backdrop')await page.mouse.click(2,2);else await page.keyboard.press('Escape');
   await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent==='放大查看');
   assert(await opener.evaluate(e=>document.activeElement===e));
  }
  console.log(`PASS ${width}px initial fit; button/backdrop/Esc return focus`);await page.close();
 }
} finally {await browser.close();}
