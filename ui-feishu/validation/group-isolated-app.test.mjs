import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  let storageState;
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, storageState }); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:14360/?token=isolated-test-token');
    try {
      await page.getByText('隔离附件测试群', { exact: true }).first().click();
      await page.locator('.group-workspace textarea').waitFor();
      if (name === 'desktop') {
        await page.locator('.group-workspace input[type=file]').setInputFiles({ name: 'isolation.txt', mimeType: 'text/plain', buffer: Buffer.from('隔离附件内容') });
        await page.locator('.group-workspace textarea').fill('隔离上传测试');
        const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/uploads' && response.request().method() === 'POST');
        const sent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/group/message' && response.request().method() === 'POST');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        assert.equal((await uploaded).ok(), true); assert.equal((await sent).ok(), true);
        await page.getByText('isolation.txt', { exact: true }).first().waitFor();
      }
      const ownMessage = page.locator('article[class*="ownMessage"]').filter({ hasText: '隔离上传测试' }).last();
      assert.equal(await ownMessage.evaluate(element => element.className.includes('ownMessage')), true);
      assert.equal(await ownMessage.locator('[class*="userBubble"]').count(), 1);
      storageState = await page.context().storageState();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/negus-group-full-${name}.png` });
      assert.deepEqual(errors, []);
    } catch (error) { console.error('隔离页面:', (await page.locator('body').innerText()).slice(0, 1200)); throw error; }
    finally { await page.close(); }
  }
} finally { await browser.close(); }
