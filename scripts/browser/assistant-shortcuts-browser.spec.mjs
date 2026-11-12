import { expect, test } from '@playwright/test';

const origin = process.env.TANO_ASSISTANT_TEST_URL || 'http://127.0.0.1:43845';

async function prepare(page, source = false) {
  await page.addInitScript(() => localStorage.setItem('tano.preference.locale', 'zh-CN'));
  await page.goto(origin);
  await page.waitForFunction(() => {
    const stores = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s;
    return stores?.get('workspace')?.workspace && stores.get('assistant')?.connections.length && !stores.get('assistant').loading;
  });
  await page.evaluate(async () => {
    const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s;
    await stores.get('workspace').create('助手快捷键.md', false, 'Alpha bravo charlie\n');
  });
  await expect(page.locator('.ProseMirror p').first()).toHaveText('Alpha bravo charlie');
  if (source) await page.keyboard.press('Control+Shift+e');
}

async function settings(page) {
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-nav button').filter({ hasText: /^快捷键$/ }).click();
}

for (const mode of ['floating', 'sidebar', 'fullscreen']) {
  test(`opens and closes the ${mode} assistant with context and a preserved draft`, async ({ page }) => {
    await prepare(page);
    const launcher = page.getByRole('button', { name: '打开同页助手', exact: true });
    await expect(launcher).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+A');
    await launcher.hover();
    await expect(launcher.getByRole('tooltip')).toContainText('Ctrl + Shift + A');
    await page.evaluate(mode => {
      const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s;
      stores.get('assistant').setDisplayMode(mode);
      let component = document.querySelector('.milkdown-host').__vueParentComponent;
      while (!component.exposed?.restoreModeSelection) component = component.parent;
      component.exposed.restoreModeSelection({ anchor: 6, head: 11 });
    }, mode);
    await page.keyboard.press('Control+Shift+a');
    const panel = page.locator('.assistant-panel');
    const prompt = panel.getByRole('textbox', { name: '给助手的任务', exact: true });
    await expect(panel).toBeVisible();
    await expect(prompt).toBeFocused();
    await expect(panel.locator('.assistant-selection')).toContainText('bravo');
    await expect(panel.getByRole('button', { name: '收起助手', exact: true })).toHaveAttribute('data-tooltip-shortcut', 'Mod+Shift+A');
    await prompt.fill('保留这条未发送的草稿');
    await prompt.press('Control+Shift+a');
    await expect(panel).toBeHidden();
    await expect(page.locator('.milkdown-host .ProseMirror')).toBeFocused();
    await expect(page.locator('.ProseMirror p').first()).toHaveText('Alpha bravo charlie');
    await page.keyboard.press('Control+Shift+a');
    await expect(prompt).toBeFocused();
    await expect(prompt).toHaveValue('保留这条未发送的草稿');
  });
}

test('opens from source selection and restores source editor focus when closing', async ({ page }) => {
  await prepare(page, true);
  await expect(page.locator('.source-editor .cm-content')).toBeVisible();
  await page.evaluate(() => {
    let component = document.querySelector('.source-editor').__vueParentComponent;
    while (!component.exposed?.restoreModeSelection) component = component.parent;
    component.exposed.restoreModeSelection({ anchor: 6, head: 11 });
  });
  await page.keyboard.press('Control+Shift+a');
  await expect(page.locator('.assistant-panel .assistant-selection')).toContainText('bravo');
  await page.keyboard.press('Control+Shift+a');
  await expect(page.locator('.assistant-panel')).toBeHidden();
  await expect(page.locator('.source-editor .cm-content')).toBeFocused();
  const selection = await page.locator('.source-editor').evaluate(host => {
    let component = host.__vueParentComponent;
    while (!component.exposed?.captureModeSelection) component = component.parent;
    return component.exposed.captureModeSelection();
  });
  expect(selection).toEqual({ anchor: 6, head: 11 });
});

test('custom assistant shortcut applies immediately, persists, and does not toggle while recording in settings', async ({ page }) => {
  await prepare(page); await settings(page);
  const binding = page.getByRole('button', { name: '设置打开或关闭同页助手快捷键', exact: true });
  await expect(binding).toContainText('Ctrl+Shift+A');
  await binding.click(); await binding.press('Alt+a');
  await expect(binding).toContainText('Alt+A');
  await page.keyboard.press('Alt+a');
  await expect(page.locator('.assistant-panel')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('Control+Shift+a');
  await expect(page.locator('.assistant-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开同页助手', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Alt+A');
  await page.keyboard.press('Alt+a');
  await expect(page.locator('.assistant-panel')).toBeVisible();
  await page.keyboard.press('Alt+a');
  await expect(page.locator('.assistant-panel')).toBeHidden();
  await page.reload(); await settings(page);
  await expect(binding).toContainText('Alt+A');
});
