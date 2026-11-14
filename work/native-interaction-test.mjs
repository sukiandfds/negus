import {chromium} from '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--window-position=100,100','--window-size=1000,750']});
const p=await b.newPage({viewport:{width:980,height:600}});
await p.setContent('<html><head><title>Negus 电脑操控验收</title></head><body style="font:24px system-ui;padding:50px"><h1>Negus 电脑操控验收</h1><p>这是临时测试窗口，不会更改你的文件或网站。</p><input id="entry" placeholder="由 Negus 输入测试文字" style="font:24px system-ui;width:650px;padding:16px"><br><button id="verify" style="font:24px system-ui;margin-top:30px;padding:18px">验证输入</button><p id="result">等待实际点击和输入</p><script>document.querySelector("#verify").onclick=()=>document.querySelector("#result").textContent="收到："+document.querySelector("#entry").value</script></body></html>');
await p.bringToFront();console.log('READY');
const deadline=Date.now()+180000;
while(Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));const result=await p.locator('#result').innerText();if(result.startsWith('收到：')){await fs.writeFile('work/native-interaction-result.json',JSON.stringify({result,input:await p.locator('#entry').inputValue(),time:new Date().toISOString()}));console.log(result);await p.screenshot({path:'work/native-interaction-browser.png'});break;}}
await b.close();
