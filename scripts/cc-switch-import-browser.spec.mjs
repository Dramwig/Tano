import { expect, test } from '@playwright/test';

for (const [theme, width, height] of [['light', 1440, 940], ['dark', 1440, 940], ['light', 390, 744], ['light', 1000, 600]]) {
  test(`CC Switch dialog has an opaque themed surface and scrolls (${theme}, ${width}x${height})`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem('tano.preference.locale', 'zh-CN'); });
    await page.goto('http://127.0.0.1:43845');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('assistant'));
    // Replace only native discovery. Render the real app, settings and theme styles.
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
      assistant.demo = false;
      assistant.canImportCcSwitch = true;
      assistant.scanCcSwitch = async () => Array.from({ length: 17 }, (_, index) => ({
        id: String(index), name: `提供商 ${index + 1}`, source: index < 5 ? 'claude' : 'codex',
        endpoint: 'https://example.com/v1', reason: index < 5 ? '暂不支持此接口协议' : null,
      }));
    }, theme);
    await page.getByRole('button', { name: /^切换上下文：/ }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('.settings-nav button').filter({ hasText: /^助手$/ }).click();
    await page.getByRole('button', { name: '从 CC Switch 导入', exact: true }).click();
    await page.setViewportSize({ width, height });
    const dialog = page.locator('.cc-import-dialog');
    await expect(dialog.locator('li')).toHaveCount(17);
    await expect(dialog).toHaveCSS('background-color', theme === 'dark' ? 'rgb(31, 31, 30)' : 'rgb(255, 255, 255)');
    expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);
    expect(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    expect(await dialog.locator('form').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    const footerBefore = await dialog.locator('footer').boundingBox();
    const body = dialog.locator('.cc-import-body');
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByText('提供商 17', { exact: true })).toBeInViewport();
    expect(await dialog.locator('footer').boundingBox()).toEqual(footerBefore);
    expect(await dialog.evaluate(element => element.scrollTop)).toBe(0);
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeInViewport();
    await dialog.getByLabel('全选可导入项').check();
    await expect(dialog.locator('li input:checked')).toHaveCount(12);
    await page.screenshot({ path: testInfo.outputPath('cc-switch-import.png') });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '从 CC Switch 导入', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  });
}
