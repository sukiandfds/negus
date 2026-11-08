import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const bubbles = [];
    const composers = [];
    const messageClasses = [];
    let groupPresentation;
    for (const view of ['group', 'background']) {
      await page.goto(`http://127.0.0.1:4320/validation/group-visual.html${view === 'background' ? '?background=1' : ''}`);
      await page.getByText('已完成检查，结果正常。').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('textarea').isVisible(), true);
      bubbles.push(await page.getByText('请检查这个问题。', { exact: true }).evaluate(element => {
        const bubble = element.closest('[class*="userBubble"]');
        if (!bubble) throw Error('missing shared user bubble');
        const rect = bubble.getBoundingClientRect(); const style = getComputedStyle(bubble);
        return { width: rect.width, background: style.backgroundColor, border: style.borderColor };
      }));
      composers.push(await page.locator('textarea').evaluate(element => element.parentElement?.className));
      messageClasses.push(await page.getByText('请检查这个问题。', { exact: true }).evaluate(element => element.closest('article')?.className));
      if (view === 'group') {
        groupPresentation = await page.evaluate(() => {
          const article = text => [...document.querySelectorAll('article')].find(element => element.textContent?.includes(text));
          const own = article('请检查这个问题。');
          const agent = article('已完成检查，结果正常。');
          const pending = article('正在回复');
          if (!own || !agent || !pending) throw Error('missing group message');
          const avatar = element => {
            const style = getComputedStyle(element, '::before');
            return { content: style.content, display: style.display, width: style.width, height: style.height };
          };
          return {
            ownAvatar: avatar(own),
            agentAvatar: avatar(agent),
            ownBubbleRight: Math.round(innerWidth - (own.querySelector('[class*="userBubble"]')?.getBoundingClientRect().right || 0)),
            agentArticleClass: agent.className,
            pendingInsideBubble: Boolean(pending.closest('[class*="messageBubble"]')),
          };
        });
      }
      await page.screenshot({ path: `/tmp/negus-group-${view}-${label}.png` });
    }
    assert.deepEqual(bubbles[0], bubbles[1]);
    assert.equal(composers[0], composers[1]);
    assert.equal(messageClasses[0], messageClasses[1]);
    assert.equal(groupPresentation.ownAvatar.display, 'grid');
    assert.equal(groupPresentation.ownAvatar.width, viewport.width < 760 ? '30px' : '34px');
    assert.equal(groupPresentation.agentAvatar.display, 'grid');
    assert.equal(groupPresentation.agentAvatar.width, viewport.width < 760 ? '30px' : '34px');
    assert.equal(groupPresentation.agentArticleClass.includes('undefined'), false);
    assert.ok(groupPresentation.ownBubbleRight < 120);
    assert.equal(groupPresentation.pendingInsideBubble, false);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
