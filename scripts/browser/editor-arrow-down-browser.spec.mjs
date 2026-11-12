import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:43845';

async function open(page, content) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin);
  await expect(page).toHaveURL(origin + '/');
  await expect(page).toHaveTitle(/Tano|同页/);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async content => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('arrow-down-regression.md', false, content);
  }, content);
  const prose = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  await expect(prose).toBeVisible();
  await prose.focus();
  await page.keyboard.press('Control+End');
  return prose;
}

for (const content of ['正文', '# 标题', '- 第一项\n- 第二项', '> 引用', '```\nfirst\nlast\n```', '---', '| A | B |\n| --- | --- |\n| 1 | 2 |']) {
  test(`ArrowDown exits the final visual line of ${content}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const prose = await open(page, content);
    if (content.startsWith('|')) {
      await prose.locator('td').last().click();
      await page.keyboard.press('End');
    }
    const count = await prose.locator(':scope > *').count();
    await page.keyboard.press('ArrowDown');
    await expect(prose.locator(':scope > *')).toHaveCount(count + 1);
    const last = prose.locator(':scope > p').last();
    await expect(last).toHaveText('');
    await expect(prose).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(prose.locator(':scope > *')).toHaveCount(count + 1);
    if (content === '正文' && process.env.TANO_ARROW_DOWN_SCREENSHOT)
      await page.screenshot({ path: process.env.TANO_ARROW_DOWN_SCREENSHOT });
    await page.keyboard.type('new body');
    await expect(last).toHaveText('new body');
    expect(errors).toEqual([]);
  });
}

test('wrapped lines move normally before appending; Shift+Down and slash navigation do not append', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const prose = await open(page, '自动换行内容。'.repeat(80));
  await page.keyboard.press('Control+Home');
  const before = await page.evaluate(() => window.getSelection().anchorOffset);
  await page.keyboard.press('ArrowDown');
  await expect(prose.locator(':scope > p')).toHaveCount(1);
  expect(await page.evaluate(() => window.getSelection().anchorOffset)).toBeGreaterThan(before);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(prose.locator(':scope > p')).toHaveCount(1);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowDown');
  await expect(prose.locator(':scope > p')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(prose.locator(':scope > p')).toHaveCount(1);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('/');
  await expect(page.locator('.tano-slash-menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tano-slash-menu')).toBeVisible();
  await expect(prose.locator(':scope > p')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await expect(prose.locator(':scope > p').last()).toHaveText('');
  expect(errors).toEqual([]);
});
