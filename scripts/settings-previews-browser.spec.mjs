import { expect, test } from '@playwright/test';
import { capabilityTargets, settingTargets } from './preview-renderer-targets.mjs';

const pages = {
  editing: ['编辑器', 'Editor'], appearance: ['外观', 'Appearance'], documents: ['Markdown 与格式', 'Markdown & formatting'],
};
async function openSettings(page, locale = 'zh-CN') {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(locale => {
    if (window.top === window) localStorage.setItem('tano.preference.locale', locale);
  }, locale);
  await page.goto(process.env.TANO_PREVIEW_URL ?? 'http://127.0.0.1:43845');
  await page.locator('.ProseMirror').first().waitFor();
  await page.getByRole('button', { name: locale === 'en-US' ? /^Switch context:/ : /^切换上下文：/ }).click();
  await page.getByRole('button', { name: locale === 'en-US' ? 'Settings' : '设置', exact: true }).click();
  await expect(page.locator('.settings-dialog')).toBeVisible();
}
async function animationFrame(example, time) {
  await example.evaluate(async (element, time) => {
    const inner = element.querySelector('iframe')?.contentDocument?.body;
    for (const root of [element, inner].filter(Boolean)) for (const animation of root.getAnimations({ subtree: true })) {
      animation.pause(); animation.currentTime = time;
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
  }, time);
}
async function hoverRow(page, row) {
  await page.mouse.move(0, 0);
  await row.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await row.hover({ position: { x: 95, y: 28 } });
}

for (const locale of ['zh-CN', 'en-US']) test(`settings explain visual behavior with hover animations (${locale})`, async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openSettings(page, locale);
  const content = await page.locator('.ProseMirror').first().innerText();
  const tooltip = page.getByRole('tooltip');
  let covered = 0;
  for (const [category, names] of Object.entries(pages)) {
    await page.locator('.settings-nav').getByRole('button', { name: names[locale === 'en-US' ? 1 : 0], exact: true }).click();
    const controlState = () => page.locator('.settings-main').evaluate(root => [...root.querySelectorAll('input, select, [role="switch"]')].map(element => ({
      name: element.getAttribute('aria-label'), value: element.value, checked: element.getAttribute('aria-checked'), disabled: element.disabled,
    })));
    const original = await controlState();
    const rows = page.locator('.settings-row[data-tooltip-setting]');
    const keys = await rows.evaluateAll(rows => rows.map(row => row.dataset.tooltipSetting));
    for (const key of keys) {
      const row = page.locator(`[data-settings-key="${key}"]`);
      await hoverRow(page, row);
      const example = tooltip.locator('.setting-example');
      await expect(example).toHaveAttribute('data-setting', key);
      const scene = await example.getAttribute('data-scene');
      const rendered = example.frameLocator('iframe');
      await expect(rendered.locator(settingTargets[scene]).first()).toBeAttached();
      await expect(example.locator('.setting-example-description')).not.toBeEmpty();
      await expect(example.locator('.setting-example-stage')).toHaveAttribute('inert', '');
      await animationFrame(example, 700);
      if (scene === 'folding') {
        await expect(rendered.locator('.demo-after .tano-folded-heading-content').first()).toHaveCSS('display', 'none');
        await expect(rendered.locator('.demo-after .tano-fold-toggle').first()).toBeVisible();
        await expect(rendered.locator('.demo-after .tano-fold-toggle').first()).toHaveText('▸');
      }
      await expect(example.locator('.demo-phase > .demo-after')).toHaveCSS('opacity', '1');
      const after = await example.boundingBox();
      const hint = await tooltip.boundingBox();
      const anchor = await row.boundingBox();
      expect(hint.y + hint.height <= anchor.y || hint.y >= anchor.y + anchor.height).toBe(true);
      expect(after.x).toBeGreaterThanOrEqual(8);
      expect(after.x + after.width).toBeLessThanOrEqual(1432);
      await example.screenshot({ path: testInfo.outputPath(`${key}-${locale}.png`) });
      await animationFrame(example, 2700);
      await expect(example.locator('.demo-phase > .demo-before')).toHaveCSS('opacity', '1');
      const before = await example.boundingBox();
      expect(Math.abs(after.height - before.height)).toBeLessThan(1);
      if (['editing-preview-math', 'editing-preview-mermaid', 'editing-folding'].includes(key))
        await example.screenshot({ path: testInfo.outputPath(`${key}-before-${locale}.png`) });
      covered++;
    }
    expect(await controlState()).toEqual(original);
    if (category === 'documents') {
      for (const [feature, selector] of Object.entries(capabilityTargets)) {
        await hoverRow(page, page.locator(`[data-settings-key="documents-${feature}"]`));
        const example = tooltip.locator('.capability-example');
        await expect(example).toHaveAttribute('data-feature', feature);
        await expect(example.locator(selector).first()).toBeAttached();
        if (feature === 'inlineComment') await expect(example.locator(selector)).toBeVisible();
        await example.screenshot({ path: testInfo.outputPath(`capability-${feature}-${locale}.png`) });
      }
    }
  }
  expect(covered).toBe(19);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(page.locator('.settings-dialog')).toBeVisible();
  expect(await page.locator('.ProseMirror').first().innerText()).toBe(content);
  expect(errors).toEqual([]);
});

test('setting previews stay informative without motion and explain disabled controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSettings(page);
  await page.locator('.settings-nav').getByRole('button', { name: '编辑器', exact: true }).click();
  await page.getByRole('switch', { name: '光标进入时展开 Markdown 源码', exact: true }).click();
  const row = page.locator('[data-settings-key="editing-preview-math"]');
  await expect(row.getByRole('switch')).toBeDisabled();
  await hoverRow(page, row);
  const tooltip = page.getByRole('tooltip');
  const example = tooltip.locator('.setting-example');
  await expect(example).toHaveAttribute('data-scene', 'math');
  await expect(example.frameLocator('iframe').locator('.demo-after .tano-live-math-preview .katex')).toBeVisible();
  expect(await example.evaluate(element => element.getAnimations({ subtree: true }).length + element.querySelector('iframe').contentDocument.body.getAnimations({ subtree: true }).length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(page.locator('.settings-dialog')).toBeVisible();
});
