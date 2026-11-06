import { expect, test } from '@playwright/test';

for (const mode of ['selection', 'fixed']) for (const locale of ['zh-CN', 'en-US']) {
  test(`toolbar reuses right-side block previews (${mode}, ${locale})`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.addInitScript(({ mode, locale }) => {
      if (window.top !== window) return;
      localStorage.setItem('tano.preference.locale', locale);
      localStorage.setItem('tano.preference.toolbarMode', mode);
    }, { mode, locale });
    await page.goto(process.env.TANO_PREVIEW_URL ?? 'http://127.0.0.1:43845');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
    const content = '# 海边两日游\n\n沿着海岸步行到灯塔。\n';
    await page.evaluate(async content => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').create('toolbar-preview.md', false, content);
    }, content);
    const prose = page.locator('.ProseMirror').first();
    await expect(prose).toContainText('沿着海岸步行到灯塔。');
    await page.locator('.milkdown-host').first().evaluate((element, selection) => {
      let component = element.__vueParentComponent;
      while (!component.exposed?.restoreModeSelection) component = component.parent;
      component.exposed.restoreModeSelection(selection);
    }, { anchor: content.indexOf('沿着海岸'), head: content.indexOf('沿着海岸') + 4 });
    await page.getByRole('button', { name: locale === 'en-US' ? 'Block type' : '块级类型', exact: true }).click();
    const menu = page.locator('.block-type-menu');
    await expect(menu).toBeVisible();
    const original = await prose.innerText();
    const tooltip = page.getByRole('tooltip');
    for (const row of await menu.locator('[data-tooltip-block]').all()) {
      const command = await row.getAttribute('data-tooltip-block');
      const value = await row.getAttribute('data-tooltip-block-value');
      await row.hover();
      await expect(tooltip.locator('.block-example')).toHaveAttribute('data-command', command);
      if (value) await expect(tooltip.locator('.block-example')).toHaveAttribute('data-value', value);
      await expect(tooltip.locator('.block-example-rendered > *').first()).toBeVisible();
      await expect(tooltip.locator('.block-example-description')).not.toBeEmpty();
      const preview = await tooltip.boundingBox();
      const bounds = await menu.boundingBox();
      expect(preview.x).toBeGreaterThanOrEqual(bounds.x + bounds.width);
      if (command === 'quote') await page.screenshot({ path: testInfo.outputPath(`toolbar-quote-${mode}-${locale}.png`) });
    }
    await menu.locator('[data-heading-trigger]').hover();
    const headings = page.locator('.heading-submenu');
    await expect(headings).toBeVisible();
    await expect(tooltip).toHaveCount(0);
    for (let level = 1; level <= 4; level++) {
      await headings.locator(`[data-tooltip-block-value="${level}"]`).hover();
      await expect(tooltip.locator(`h${level}`)).toBeVisible();
      const preview = await tooltip.boundingBox();
      const bounds = await headings.boundingBox();
      expect(preview.x).toBeGreaterThanOrEqual(bounds.x + bounds.width);
    }
    await page.screenshot({ path: testInfo.outputPath(`toolbar-heading-${mode}-${locale}.png`) });
    expect(await prose.innerText()).toBe(original);
    // Conversion must still use the original editor selection after hovering.
    await headings.locator('[data-tooltip-block-value="3"]').click();
    await expect(prose.locator('h3')).toHaveText('沿着海岸步行到灯塔。');
    await expect(menu).toHaveCount(0);
    await expect(tooltip).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
