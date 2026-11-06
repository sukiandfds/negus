import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const bubbles = [];
    for (const view of ['group', 'background']) {
      await page.goto(`http://127.0.0.1:4320/validation/group-visual.html${view === 'background' ? '?background=1' : ''}`);
      await page.getByText('已完成检查，结果正常。').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('textarea').isVisible(), true);
      bubbles.push(await page.getByText('请检查这个问题。', { exact: true }).evaluate(element => {
        const bubble = element.closest('[class*="userBubble"]');
        if (!bubble) throw Error('missing shared user bubble');
        const rect = bubble.getBoundingClientRect(); const style = getComputedStyle(bubble);
        return { right: innerWidth - rect.right, width: rect.width, background: style.backgroundColor, border: style.borderColor };
      }));
      await page.screenshot({ path: `/tmp/negus-group-${view}-${label}.png` });
    }
    assert.deepEqual(bubbles[0], bubbles[1]);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
