import { expect, test } from '@playwright/test';

test('connection footer aligns the save icon and uses consistent button dimensions', async ({ page }, testInfo) => {
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
