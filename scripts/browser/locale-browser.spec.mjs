import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const uiText = (locale, key) => locale === 'zh-CN' ? key : read(`../../packages/workbench/src/locales/${locale}.json`)[key];

for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'ja-JP', 'es-ES', 'de-DE']) test(`uses English AI task prompts with ${locale} UI and responses while preserving the document`, async ({ page }, testInfo) => {
  const copy = read(`../../packages/workbench/src/assistant/locales/${locale}.json`);
  await page.addInitScript(value => localStorage.setItem('tano.preference.locale', value), locale);
  await page.goto('http://127.0.0.1:43845');
  const editor = page.locator('.ProseMirror').first();
  await editor.waitFor();
  const original = await editor.innerText();
  await page.locator('.assistant-launcher').first().click();
  const panel = page.locator('.assistant-panel');
  await expect(panel.locator('.assistant-starter')).toHaveCount(4);
  const translate = panel.getByRole('button', { name: copy.starters.translate, exact: true });
  await translate.click();
  const translationPrompt = 'Translate this note, choosing an appropriate target language based on its content and the conversation context. Preserve its Markdown formatting.';
  await expect(panel.locator('textarea')).toHaveValue(translationPrompt);
  await expect(panel.locator('textarea')).toBeFocused();
  await expect(translate).not.toHaveAttribute('aria-haspopup');
  await expect(translate.locator('svg')).toHaveCount(1);
  await expect(panel.locator('.assistant-popover')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath(`translation-starter-${locale}.png`) });
  await translate.click();
  await expect(panel.locator('textarea')).toHaveValue(translationPrompt);
  await panel.getByRole('button', { name: copy.starters.summary, exact: true }).click();
  await expect(panel.locator('textarea')).toHaveValue('Summarize this note and extract its key ideas and main points.');
  await panel.getByRole('button', { name: locale === 'en-US' ? 'Select assistant model' : uiText(locale, '选择助手模型'), exact: true }).click();
  await panel.locator('.assistant-model-option').filter({ hasText: '简洁模拟' }).click();
  await panel.locator('.assistant-send').click();
  await expect(panel.locator('.assistant-message-assistant')).toContainText(copy.demo.read.split('{0}')[0]);
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
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en-US');
  await expect(page.locator('#settings-title')).toHaveText('Appearance');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await page.screenshot({ path: testInfo.outputPath('english-appearance.png') });
  for (const name of ['Editor', 'Keyboard shortcuts', 'Assistant', 'General settings', 'Markdown & formatting', 'About Tano']) {
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
  await page.getByRole('button', { name: /^Switch context:/ }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 700 });
  expect(await page.locator('.settings-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN');
  await expect(page.locator('#settings-title')).toHaveText('外观');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('switches the four new locales through settings without changing Markdown', async ({ page }, testInfo) => {
  await page.goto('http://127.0.0.1:43845');
  const editor = page.locator('.ProseMirror').first();
  await editor.waitFor();
  const original = await editor.innerText();
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const locale of ['zh-TW', 'ja-JP', 'es-ES', 'de-DE']) {
    await page.locator('.settings-row select').first().selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    expect(await page.evaluate(() => localStorage.getItem('tano.preference.locale'))).toBe(locale);
    const pages = page.locator('.settings-nav-scroll button');
    for (let index = 0; index < await pages.count(); index++) {
      await pages.nth(index).click();
      expect(await page.locator('.settings-main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await pages.first().click();
    await page.setViewportSize({ width: 900, height: 700 });
    expect(await page.locator('.settings-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`settings-${locale}.png`) });
  }
  await page.locator('.settings-close').click();
  expect(await editor.innerText()).toBe(original);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
  await editor.waitFor();
  expect(await editor.innerText()).toBe(original);
});
