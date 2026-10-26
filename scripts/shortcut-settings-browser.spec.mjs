import { expect, test } from '@playwright/test';
async function prepare(page) {
  await page.addInitScript(() => localStorage.setItem('tano.preference.locale', 'zh-CN'));
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => { await document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').create('快捷键验证.md', false, 'Alpha\n'); });
  await expect(page.locator('.ProseMirror p').first()).toHaveText('Alpha');
}
async function settings(page) {
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-nav button').filter({ hasText: /^快捷键$/ }).click();
}

test('shows shortcut conflicts directly under the active binding and clears them on cancel', async ({ page }) => {
  await prepare(page); await settings(page);
  const control = page.getByRole('button', { name: '设置打开文档快捷键', exact: true });
  await control.click(); await control.press('Control+n');
  const row = page.locator('[data-settings-key="shortcut-openDocument"]');
  const alert = row.getByRole('alert');
  await expect(alert).toContainText('新建文档');
  await expect(page.locator('.shortcut-settings > [role="alert"]')).toHaveCount(0);
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const buttonBounds = await control.boundingBox(), errorBounds = await alert.boundingBox();
  expect(errorBounds.y).toBeGreaterThanOrEqual(buttonBounds.y + buttonBounds.height);
  expect(Math.abs(errorBounds.x - buttonBounds.x)).toBeLessThan(2);
  await row.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(control).toContainText('Ctrl+O');
});
test('shows and independently edits multiple redo keys, persists them, and routes live editor input', async ({ page }) => {
  await prepare(page);
  await settings(page);
  const first = page.getByRole('button', { name: '设置重做快捷键', exact: true });
  const second = page.getByRole('button', { name: '设置重做快捷键 2', exact: true });
  await expect(first).toContainText('Ctrl+Y');
  await expect(second).toContainText('Ctrl+Shift+Z');
  await first.click(); await first.press('Alt+y');
  await expect(first).toContainText('Alt+Y');
  await expect(second).toContainText('Ctrl+Shift+Z');
  await page.getByRole('button', { name: '清除重做快捷键 2', exact: true }).click();
  await page.getByRole('button', { name: '添加重做快捷键', exact: true }).click();
  await second.press('Alt+Shift+y');
  await expect(second).toContainText('Alt+Shift+Y');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const paragraph = page.locator('.ProseMirror p').first();
  await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.type('X');
  await expect(paragraph).toHaveText('AlphaX');
  await page.keyboard.press('Control+z'); await expect(paragraph).toHaveText('Alpha');
  await page.keyboard.press('Control+y'); await expect(paragraph).toHaveText('Alpha');
  await page.keyboard.press('Alt+y'); await expect(paragraph).toHaveText('AlphaX');
  await page.keyboard.press('Control+z'); await expect(paragraph).toHaveText('Alpha');
  await page.keyboard.press('Alt+Shift+y'); await expect(paragraph).toHaveText('AlphaX');
  await page.reload(); await settings(page);
  await expect(first).toContainText('Alt+Y'); await expect(second).toContainText('Alt+Shift+Y');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  const source = page.locator('.cm-content');
  await source.click(); await page.keyboard.press('Control+End');
  const before = await source.textContent();
  await page.keyboard.type('Q');
  await page.keyboard.press('Control+z'); await expect(source).toHaveText(before);
  await page.keyboard.press('Alt+y'); await expect(source).not.toHaveText(before);
});

test('a custom block delete key replaces Backspace even while the menu owns focus', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tano.preference.shortcuts', JSON.stringify({ deleteBlock: 'Alt+D' })));
  await prepare(page);
  await page.locator('.tano-block-handle').first().dispatchEvent('click');
  const menu = page.locator('.block-context-menu');
  await expect(menu.getByRole('menuitem', { name: '删除块', exact: true }).locator('.menu-shortcut')).toHaveText('Alt + D');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.ProseMirror p')).toHaveText('Alpha');
  await page.keyboard.press('Alt+d');
  await expect(page.locator('.ProseMirror p')).toHaveText('');
});
test('custom formatting replaces native defaults without stealing sidebar bindings', async ({ page }) => {
  await prepare(page); await settings(page);
  const bold = page.getByRole('button', { name: '设置粗体快捷键', exact: true });
  await bold.click(); await bold.press('Alt+b');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const paragraph = page.locator('.ProseMirror p').first();
  await paragraph.click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+b'); await expect(paragraph.locator('strong')).toHaveCount(0);
  await page.keyboard.press('Alt+b'); await expect(paragraph.locator('strong')).toHaveText('Alpha');
});
