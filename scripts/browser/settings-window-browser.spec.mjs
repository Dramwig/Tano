import { expect, test } from '@playwright/test';

for (const owner of ['main', 'auxiliary']) test(`settings float in the current window until explicitly detached (${owner})`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tano.preference.locale', 'zh-CN'));
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    // Exercise desktop routing while keeping the browser's filesystem adapter.
    const body = (await response.text()).replace(
      /(function openSettings(?:InNewWindow)?\([^\n]+\{)/g,
      '$1\nconst native = true; const tabsEnabled = true;',
    );
    await route.fulfill({ response, body });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.workspace-layout')).toBeVisible();
  await page.evaluate(() => {
    let component = document.querySelector('.workspace-layout').__vueParentComponent;
    while (component && !component.type.__file?.endsWith('/App.vue')) component = component.parent;
    const key = Reflect.ownKeys(component.provides).find(key => key.description === 'tano-workbench');
    window.__settingsWorkbench = component.provides[key];
    const workbench = window.__settingsWorkbench;
    workbench.native = true;
    workbench.tabsEnabled = true;
    window.__settingsOpens = [];
    workbench.auxiliaryWindows.open = async (...args) => {
      window.__settingsOpens.push(args);
      return { context: workbench.activeWindow };
    };
  });
  let target = page;
  if (owner === 'auxiliary') {
    const popup = page.waitForEvent('popup');
    await page.evaluate(() => {
      const child = window.open('about:blank', '_blank', 'width=1100,height=760');
      for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) child.document.head.append(style.cloneNode(true));
      window.__settingsWorkbench.activeWindow = {
        id: 'settings-owner', label: 'aux-settings-owner', window: child,
        document: child.document, overlays: child.document.body, native: undefined,
      };
    });
    target = await popup;
  }
  await page.evaluate(() => window.__settingsWorkbench.openSettings('appearance'));
  const dialog = target.locator('.settings-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(target.locator('.settings-windowed')).toHaveCount(0);
  expect(await page.evaluate(() => window.__settingsOpens)).toEqual([]);
  if (owner === 'auxiliary') await expect(page.locator('.settings-dialog')).toHaveCount(0);
  await target.getByRole('button', { name: '在新窗口打开', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__settingsOpens)).toEqual([['settings', 'settings', '设置 — Tano / 同页']]);
  if (owner === 'auxiliary') await target.close();
});
