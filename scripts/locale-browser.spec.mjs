import { expect, test } from '@playwright/test';

for (const locale of ['zh-CN', 'en-US']) test(`uses English AI task prompts with ${locale} UI and responses while preserving the document`, async ({ page }, testInfo) => {
  await page.addInitScript(value => localStorage.setItem('tano.preference.locale', value), locale);
  await page.goto('http://127.0.0.1:43845');
  const editor = page.locator('.ProseMirror').first();
  await editor.waitFor();
  const original = await editor.innerText();
  await page.locator('.assistant-launcher').first().click();
  const panel = page.locator('.assistant-panel');
  await expect(panel.locator('.assistant-starter > button')).toHaveCount(4);
  const translate = panel.getByRole('button', { name: locale === 'en-US' ? 'Translate this note' : '翻译这篇笔记', exact: true });
  await translate.click();
  await page.screenshot({ path: testInfo.outputPath(`translation-menu-${locale}.png`) });
  await panel.getByRole('menuitem', { name: locale === 'en-US' ? 'Translate to Chinese' : '翻译成中文', exact: true }).click();
  await expect(panel.locator('textarea')).toHaveValue('Translate this note into Simplified Chinese and preserve its Markdown formatting.');
  await expect(panel.locator('#assistant-translation-options')).toHaveCount(0);
  await translate.click();
  await page.keyboard.press('Escape');
  await expect(translate).toBeFocused();
  await translate.click();
  await panel.getByRole('menuitem', { name: locale === 'en-US' ? 'Translate to English' : '翻译成英文', exact: true }).click();
  await expect(panel.locator('textarea')).toHaveValue('Translate this note into English and preserve its Markdown formatting.');
  await panel.getByRole('button', { name: locale === 'en-US' ? 'Summarize this note' : '总结这篇笔记', exact: true }).click();
  await expect(panel.locator('textarea')).toHaveValue('Summarize this note and extract its key ideas and main points.');
  await panel.getByRole('button', { name: locale === 'en-US' ? 'Select assistant model' : '选择助手模型', exact: true }).click();
  await panel.locator('.assistant-model-option').filter({ hasText: '简洁模拟' }).click();
  await panel.locator('.assistant-send').click();
  await expect(panel.locator('.assistant-message-assistant')).toContainText(locale === 'en-US' ? 'Simulated browser response:' : '浏览器模拟回答：');
  await expect(panel.locator('.assistant-stop')).toHaveCount(0);
  expect(await editor.innerText()).toBe(original);
  await page.screenshot({ path: testInfo.outputPath(`ai-demo-${locale}.png`) });
});

test('shows English startup recovery when the saved language is English and loading fails', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tano.preference.locale', 'en-US'));
  // Vite may serve the dynamic import without an extension or with a cache-busting query.
  let blocked = false;
  await page.route(/\/src\/start(?:\.ts)?(?:\?|$)/, route => { blocked = true; return route.abort(); });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.getByRole('status')).toHaveText('Unable to open Tano');
  expect(blocked).toBe(true);
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
});

test('switches desktop pages live, preserves document content and remembers the language', async ({ page }, testInfo) => {
  await page.goto('http://127.0.0.1:43845');
  await page.locator('.ProseMirror').first().waitFor();
  const original = await page.locator('.ProseMirror').first().innerText();
  await page.getByRole('button', { name: '切换工作区', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en-US');
  await expect(page.locator('#settings-title')).toHaveText('Appearance');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await page.screenshot({ path: testInfo.outputPath('english-appearance.png') });
  for (const name of ['Editing', 'Keyboard shortcuts', 'Assistant settings', 'Workspace', 'Document capabilities', 'About Tano']) {
    await page.locator('.settings-nav button').filter({ hasText: new RegExp(`^${name}$`) }).click();
    await expect(page.locator('#settings-title')).toHaveText(name);
    expect(await page.locator('.settings-main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New document', exact: true })).toBeVisible();
  expect(await page.locator('.ProseMirror').first().innerText()).toBe(original);
  await page.screenshot({ path: testInfo.outputPath('english-workbench.png') });
  await page.reload();
  await expect(page.getByRole('button', { name: 'New document', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 700 });
  expect(await page.locator('.settings-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN');
  await expect(page.locator('#settings-title')).toHaveText('外观设置');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});
