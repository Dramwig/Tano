import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:43845';

async function open(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('enter-regression.md', false, '124242342\n\n');
  });
  const prose = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  await expect(prose).toBeVisible();
  await prose.click();
  await page.keyboard.press('Control+End');
  return prose;
}

function markdown(page) {
  return page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content);
}

for (const text of ['234234', '**234234**']) {
  test(`Enter after typing ${text} creates a focused empty paragraph`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const prose = await open(page);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');

    const paragraphs = prose.locator(':scope > p');
    await expect(paragraphs).toHaveCount(3);
    await expect(paragraphs.last()).toHaveAttribute('data-placeholder', "输入 '/' 搜索并切换块类型，或按 space（空格）启用 AI");
    await expect.poll(() => markdown(page)).toBe(`124242342\n\n${text}\n\n`);
    await expect(prose).toBeFocused();
    await page.keyboard.type('new body');
    await expect(paragraphs.last()).toHaveText('new body');
    await expect(paragraphs.last().locator('strong, [data-tano-live-inline-source]')).toHaveCount(0);
    await expect.poll(() => markdown(page)).toBe(`124242342\n\n${text}\n\nnew body\n`);
    expect(errors).toEqual([]);
  });
}

test('Shift+Enter still creates a hard break inside the paragraph', async ({ page }) => {
  const prose = await open(page);
  await page.keyboard.type('234234');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('same block');
  await expect(prose.locator(':scope > p')).toHaveCount(2);
  await expect(prose.locator('br[data-type="hardbreak"]')).toHaveCount(1);
  await expect.poll(() => markdown(page)).toBe('124242342\n\n234234\\\nsame block\n');
});
