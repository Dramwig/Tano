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

for (const { scenario, withWorkspace, width } of [
  { scenario: 'with a workspace open', withWorkspace: true, width: 1280 },
  { scenario: 'without a workspace', withWorkspace: false, width: 1280 },
  { scenario: 'in a narrow window without a workspace', withWorkspace: false, width: 680 },
]) test(`Home settings open as a desktop tab ${scenario}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tano.preference.locale', 'zh-CN'));
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.ProseMirror').first()).toBeVisible();
  await page.evaluate(async withWorkspace => {
    let component = document.querySelector('.workspace-layout').__vueParentComponent;
    while (component && !component.type.__file?.endsWith('/App.vue')) component = component.parent;
    const key = Reflect.ownKeys(component.provides).find(key => key.description === 'tano-workbench');
    const workbench = component.provides[key];
    workbench.native = true;
    workbench.tabsEnabled = true;
    if (withWorkspace) workbench.selectContext('home');
    else if (!(await workbench.store.leaveWorkspace())) throw new Error('Could not leave the demo workspace');
  }, withWorkspace);
  await page.setViewportSize({ width, height: 820 });
  if (width < 700) await page.locator('.main-column').getByRole('button', { name: '展开侧栏', exact: true }).click();

  const openSettings = async () => {
    await page.getByRole('button', { name: '切换上下文：主页', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
  };
  await openSettings();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '编辑器', exact: true }).click();
  await dialog.getByRole('button', { name: '作为标签页打开', exact: true }).click();

  const tab = page.getByRole('tab', { name: '设置', exact: true });
  const settings = page.locator('.settings-tabbed');
  await expect(dialog).toHaveCount(0);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('heading', { name: '编辑器', exact: true }).first()).toBeVisible();
  await expect(settings.locator('.settings-nav-foot')).toContainText('个人偏好 · 当前设备');
  await expect(settings.getByRole('button', { name: '基本设置', exact: true })).toHaveCount(0);
  if (withWorkspace) {
    await page.locator('.desktop-tab-switch').getByText(/00-从这里开始/).click();
    await openSettings();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(dialog).toHaveCount(0);
  }
  await tab.hover();
  await page.getByRole('button', { name: '关闭 设置', exact: true }).click();
  await expect(tab).toHaveCount(0);
  if (withWorkspace) await expect(page.locator('.ProseMirror').first()).toBeVisible();
});
