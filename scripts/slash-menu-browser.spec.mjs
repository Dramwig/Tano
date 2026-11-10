import { expect, test } from '@playwright/test';
import { blockTarget } from './preview-renderer-targets.mjs';

for (const locale of ['zh-CN', 'en-US']) {
  for (const width of [1280, 390]) {
    test(`slash menu shows localized names and markers with bilingual search (${locale}, ${width}px)`, async ({ page }, testInfo) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript(value => {
        if (window.top === window) localStorage.setItem('tano.preference.locale', value);
      }, locale);
      await page.goto(process.env.TANO_PREVIEW_URL ?? 'http://127.0.0.1:43845');
      await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
        await store.create('slash-menu.md', false, '');
      });
      const prose = page.locator('.ProseMirror').first();
      await prose.click();
      await page.keyboard.type('/');
      const menu = page.locator('.tano-slash-menu');
      await expect(menu).toBeVisible();
      const labels = menu.locator('.tano-slash-label');
      await expect(labels.first()).toHaveText(locale === 'en-US' ? 'Paragraph' : '正文');
      for (const [name, marker] of [
        [locale === 'en-US' ? 'Heading 1' : '1 级标题', '#'],
        [locale === 'en-US' ? 'Bullet list' : '无序列表', '-'],
        [locale === 'en-US' ? 'Numbered list' : '有序列表', '1.'],
        [locale === 'en-US' ? 'Task list' : '待办列表', '[]'],
      ]) {
        const option = menu.getByRole('option', { name, exact: true });
        await expect(option.locator('.tano-slash-marker')).toHaveText(marker);
      }
      const bounds = await menu.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`slash-menu-${locale}-${width}.png`) });
      const headingRow = menu.getByRole('option', { name: locale === 'en-US' ? 'Heading 3' : '3 级标题', exact: true });
      await headingRow.hover();
      const tooltip = page.getByRole('tooltip').filter({ has: page.locator('.block-example') });
      await expect(tooltip.locator('h3')).toHaveText(locale === 'en-US' ? 'Sunset at the lighthouse' : '在灯塔下等日落');
      await expect(tooltip).toHaveAttribute('data-ready', 'true');
      const preview = await tooltip.boundingBox();
      if (width === 1280) expect(preview.x).toBeGreaterThan(bounds.x + bounds.width);
      else expect(preview.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
      expect(preview.x + preview.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`slash-preview-${locale}-${width}.png`) });
      await page.mouse.move(0, 0);
      await expect(tooltip).toHaveCount(0);

      // English aliases and local names produce the same four localized headings.
      const expected = Array.from({ length: 4 }, (_, i) => locale === 'en-US' ? `Heading ${i + 1}` : `${i + 1} 级标题`);
      for (const query of ['head', '标题', 'H2', 'table', '表格']) {
        await page.keyboard.insertText(query);
        const heading = ['head', '标题'].includes(query);
        await expect(labels).toHaveText(heading ? expected : query === 'H2' ? [expected[1]] : [locale === 'en-US' ? 'Table' : '表格']);
        if (heading) await expect(menu.locator('.tano-slash-marker')).toHaveText(['#', '##', '###', '####']);
        if (query === '标题') await page.screenshot({ path: testInfo.outputPath(`slash-search-${locale}-${width}.png`) });
        for (const character of query) await page.keyboard.press('Backspace');
      }
      await page.keyboard.type('head');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(menu).toBeHidden();
      await expect(prose.locator('h2')).toHaveCount(1);
      await expect(prose).toHaveText('');
      await page.keyboard.type('A heading');
      await expect(prose.locator('h2')).toHaveText('A heading');
      expect(errors).toEqual([]);
    });
  }
}

test('keeps native IME preedit open, searches committed Chinese, and dismisses committed garbage', async ({ page }) => {
  await page.goto(process.env.TANO_PREVIEW_URL ?? 'http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').create('slash-ime.md', false, '');
  });
  const prose = page.locator('.ProseMirror').first();
  const menu = page.locator('.tano-slash-menu');
  await prose.click();
  await page.keyboard.type('/');
  const ime = await page.context().newCDPSession(page);
  for (const text of ['b', 'biao', 'biao ti']) {
    await ime.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await expect(menu).toBeVisible();
  }
  await ime.send('Input.insertText', { text: '标题' });
  await expect(prose).toHaveText('/标题');
  await expect(menu.locator('[role="option"]')).toHaveCount(4);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(prose.locator('h2')).toHaveCount(1);
  await expect(menu).toBeHidden();

  await page.keyboard.type('/');
  await ime.send('Input.imeSetComposition', { text: 'wwwwwww', selectionStart: 7, selectionEnd: 7 });
  await expect(menu).toBeVisible();
  await ime.send('Input.insertText', { text: 'wwwwwww' });
  await expect(menu).toBeHidden();
  await expect(prose).toHaveText('/wwwwwww');
  await ime.detach();
});

test('every slash command has an inert rendered hover example', async ({ page }, testInfo) => {
  await page.goto(process.env.TANO_PREVIEW_URL ?? 'http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').create('slash-examples.md', false, '');
  });
  const prose = page.locator('.ProseMirror').first();
  await prose.click();
  await page.keyboard.type('/');
  const rows = page.locator('.tano-slash-menu [role="option"]');
  const examples = await rows.evaluateAll(items => items.map(item => ({
    command: item.dataset.tooltipBlock, value: item.dataset.tooltipBlockValue ?? '',
  })));
  for (const { command, value } of examples) {
    const query = command === 'heading' ? `h${value}` : value === 'CUSTOM' ? 'custom' : command;
    await page.keyboard.type(query);
    const row = page.locator(`.tano-slash-menu [role="option"][data-tooltip-block="${command}"]${value ? `[data-tooltip-block-value="${value}"]` : ':not([data-tooltip-block-value])'}`);
    await page.mouse.move(0, 0);
    await row.hover();
    const example = page.getByRole('tooltip').locator('.block-example');
    const rendered = command === 'table' ? example.frameLocator('iframe') : example;
    await expect(example).toHaveAttribute('data-command', command);
    await expect(rendered.locator(blockTarget(command, value)).first()).toBeAttached();
    await expect(example.locator('.block-example-rendered > *').first()).toBeVisible();
    await expect(rendered.locator('.rendered-example')).toHaveAttribute('inert', '');
    if (command === 'code-block') expect(await example.locator('pre').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    if (command === 'table') expect(await rendered.locator('table').evaluate(node => node.getBoundingClientRect().right - node.closest('.tableWrapper').getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    await example.screenshot({ path: testInfo.outputPath(`block-${command}${value ? `-${value}` : ''}.png`) });
    for (const character of query) await page.keyboard.press('Backspace');
  }
  await expect(prose).toHaveText('/');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tano-slash-menu')).toBeHidden();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});
