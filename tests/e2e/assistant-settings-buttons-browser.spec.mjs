import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

async function openConnectionEditor(page) {
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem('tano.preference.locale', 'zh-CN');
  });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('assistant'));
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant').demo = false;
  });
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-nav button').filter({ hasText: /^助手$/ }).click();
  await page.getByRole('button', { name: '添加连接', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建连接', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('connection footer aligns the save icon and uses consistent button dimensions', async ({ page }, testInfo) => {
  const dialog = await openConnectionEditor(page);
  const save = dialog.getByRole('button', { name: '保存', exact: true });
  const cancel = dialog.getByRole('button', { name: '取消', exact: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(save).toHaveCSS('height', '36px');
    await expect(cancel).toHaveCSS('height', '36px');
    await expect(save).toHaveCSS('column-gap', '6px');
    await expect(save).toHaveCSS('padding-left', '12px');
    await expect(save.locator('svg')).toHaveClass(/lucide-save/);
    const saveBounds = await save.boundingBox();
    const cancelBounds = await cancel.boundingBox();
    const iconBounds = await save.locator('svg').boundingBox();
    expect(saveBounds.y).toBe(cancelBounds.y);
    expect(saveBounds.x - cancelBounds.x - cancelBounds.width).toBe(8);
    expect(iconBounds.y + iconBounds.height / 2).toBe(saveBounds.y + saveBounds.height / 2);
    await page.screenshot({ path: testInfo.outputPath(`save-buttons-${width}.png`) });
  }
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 560 }]) {
  test(`avatar picker stays in place when changing icon styles at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const dialog = await openConnectionEditor(page);
    await page.setViewportSize(viewport);
    const trigger = dialog.getByRole('button', { name: /连接头像/ });
    await trigger.click();
    const picker = dialog.getByRole('dialog', { name: '选择连接头像', exact: true });
    await expect(picker).toBeVisible();
    const initialBounds = await picker.boundingBox();
    expect(initialBounds.y).toBeGreaterThanOrEqual(8);
    expect(initialBounds.y + initialBounds.height).toBeLessThanOrEqual(viewport.height - 8);

    const grid = picker.locator('.connection-icon-options');
    const categories = picker.getByRole('group', { name: '图标风格' }).getByRole('button');
    const categoryBounds = await Promise.all((await categories.all()).map(button => button.boundingBox()));
    for (const [style, count] of [['像素', 12], ['线条', 24], ['彩色', 24], ['品牌', 25]]) {
      const category = picker.getByRole('button', { name: style, exact: true });
      await category.click();
      await expect(category).toHaveAttribute('aria-pressed', 'true');
      await expect(grid.getByRole('button')).toHaveCount(count);
      expect(await picker.boundingBox(), style).toEqual(initialBounds);
      expect(await Promise.all((await categories.all()).map(button => button.boundingBox())), style).toEqual(categoryBounds);
    }
  });
}
