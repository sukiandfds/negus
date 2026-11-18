import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url); const {chromium}=require('/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:390,height:800},permissions:['clipboard-read','clipboard-write']}); const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const input=page.getByLabel('图表代码'); const chart=page.getByLabel('Mermaid 流程图');
async function fill(t, expected){await input.fill(t); await page.waitForFunction(s=>document.querySelector('[aria-label="Mermaid 流程图"]')?.textContent.includes(s),expected,{timeout:15000});}
try {
 await page.goto('http://127.0.0.1:5198/validation/mermaid.html'); await chart.locator('svg').waitFor();
 const source='flowchart LR\n A[输入代码] --> B[显示流程图]'; await page.getByText('Mermaid 源码').click(); await page.getByRole('button',{name:'复制'}).first().click(); assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),source+"\n"); console.log('PASS source expand/copy');
 await input.fill('flowchart LR\n A['); await page.getByText('图表代码未完整或语法有误，请查看源码').waitFor(); assert.equal(await page.locator('details').first().evaluate(e=>e.open),true); assert.match(await page.locator('details').first().innerText(),/A\[/); await fill('sequenceDiagram\n Alice->>Bob: hello','hello'); console.log('PASS incomplete fallback and sequence recovery');
 for(let i=0;i<15;i++) await input.fill(`flowchart LR\n A[旧${i}] --> B[旧结果${i}]`); await fill('flowchart LR\n A[最终输入] --> B[最终结果]','最终结果'); await page.waitForTimeout(1200); assert.match(await chart.innerText(),/最终结果/); assert.doesNotMatch(await chart.innerText(),/旧结果/); console.log('PASS rapid update');
 await fill('%%{init: {"securityLevel":"loose", "htmlLabels":true, "themeCSS":"svg {display:none}"}}%%\nflowchart LR\n A["<img src=x onerror=alert(1)>"] --> B[安全]\n click B "javascript:alert(1)"','安全'); assert.equal(await chart.locator('script,img,image,foreignObject,[onerror],[onclick],a').count(),0); assert.equal(await chart.locator('svg').isVisible(),true); console.log('PASS unsafe HTML/link/config');
 await fill('flowchart LR\n A[第一步输入数据] --> B[第二步检查数据] --> C[第三步处理数据] --> D[第四步生成结果] --> E[第五步查看结果] --> F[第六步完成流程]','第六步完成流程'); await page.screenshot({path:'work/mermaid-20261116/independent-mobile.png',fullPage:true}); console.log('MOBILE',JSON.stringify(await chart.locator('svg').evaluate(e=>({svg:e.getBoundingClientRect().toJSON(),viewBox:e.getAttribute('viewBox'), text:[...e.querySelectorAll('text')].map(t=>({text:t.textContent,box:t.getBoundingClientRect().toJSON()}))})))); assert.deepEqual(errors,[]);
} finally {await browser.close();}
