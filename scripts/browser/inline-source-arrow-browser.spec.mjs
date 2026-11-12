import { test, expect } from '@playwright/test';

for (const [key, content, selector, initial, expanded, prefix] of [
  ['ArrowLeft', '~文字~++文字++==文字==\n', 'mark', '==文字==', '++文字++==文字==', '++文字++'],
  ['ArrowRight', '~文字~++文字++==文字==\n', 'sub', '~文字~', '~文字~++文字++', '~文字~'],
  ['ArrowRight', '**123213**$12312$\n', 'strong', '**123213**', '**123213**$12312$', '**123213**'],
  ['ArrowLeft', '$12312$**123213**\n', 'strong', '**123213**', '$12312$**123213**', '$12312$'],
  ['ArrowRight', '==文字==%%文字%%123\n', 'mark', '==文字==', '==文字==%%文字%%', '==文字=='],
]) {
  test(`${key} reveals both adjacent fields in ${content.trim()}`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:43845');
    await expect(page).toHaveURL('http://127.0.0.1:43845/');
    await expect(page).toHaveTitle(/Tano|同页/);
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
    await page.evaluate(async content => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      await store.create('inline-arrow.md', false, content);
    }, content);
    const prose = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
    await expect(prose).toBeVisible();
    await prose.locator(selector).click();
    const field = prose.locator('[data-tano-live-inline-source]');
    await expect(field).toHaveText(initial);
    await field.evaluate((element, key) => {
      const range = document.createRange();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const text = key === 'ArrowLeft' ? nodes[0] : nodes.at(-1);
      range.setStart(text, key === 'ArrowLeft' ? 1 : text.length - 1);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, key);
    await page.keyboard.press(key);
    await expect(field).toHaveText(expanded);
    expect(await field.evaluate(element => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      return range.toString();
    })).toBe(prefix);
    expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content)).toBe(content);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('underline-revealed.png') });
    // One more arrow enters one field; the sibling no longer touches the caret.
    await page.keyboard.press(key);
    await expect.poll(() => field.evaluate(element => {
      const clone = element.cloneNode(true);
      clone.querySelectorAll('[contenteditable="false"]').forEach(node => node.remove());
      return clone.textContent;
    })).toBe(key === 'ArrowRight' ? expanded.slice(prefix.length) : prefix);
    await page.keyboard.press(key === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight');
    await expect(field).toHaveText(expanded);
    if (content.startsWith('==')) {
      await field.locator('.tano-live-source-inline_comment').click();
      await expect(field).toHaveText('%%文字%%');
      await expect(prose.locator('mark')).toHaveText('文字');
      await page.screenshot({ path: testInfo.outputPath('previous-field-collapsed.png') });
    }
    expect(errors).toEqual([]);
  });
}
