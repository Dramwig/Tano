import { test, expect } from '@playwright/test';
import sharp from 'sharp';
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error(error.message));
});
async function settleProperties(panel) {
  await panel.evaluate(async el => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await Promise.allSettled(el.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished));
  });
}

test('document properties collapse once without a second native disclosure transition', async ({ page }) => {
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('collapse-properties.md', false, '---\nowner: Tester\nscore: 100\n---\n\n# Properties\n');
  });
  const panel = page.locator('.frontmatter-panel');
  await expect(panel).toBeVisible();
  for (let cycle = 0; cycle < 2; cycle++) {
    await panel.locator('summary').click();
    await settleProperties(panel);
    await expect(panel).toHaveAttribute('open', '');
    const samples = await panel.evaluate(async el => {
      el.querySelector('summary').click();
      const samples = [];
      const started = performance.now();
      while (performance.now() - started < 900) {
        await new Promise(requestAnimationFrame);
        samples.push({ height: el.getBoundingClientRect().height, open: el.open });
      }
      return samples;
    });
    expect(samples.at(-1).open).toBe(false);
    // The native open flag is cleared when the custom animation finishes;
    // its wrapper must already have the final height at that point.
    const closed = samples.filter(sample => !sample.open);
    expect(closed.length).toBeGreaterThan(0);
    for (const sample of closed) expect(Math.abs(sample.height - samples.at(-1).height)).toBeLessThan(1);
    for (let index = 1; index < samples.length; index++)
      expect(samples[index].height).toBeLessThanOrEqual(samples[index - 1].height + 1);
  }
});

test('property text keeps its geometry throughout press and editor replacement', async ({ page }) => {
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('press-layout.md', false, '---\nupdated_at: 2026-09-26T09:00:00+08:00\n---\n\n# Press feedback\n');
  });
  const panel = page.locator('.frontmatter-panel');
  await expect(panel).toBeVisible();
  await panel.evaluate(el => { el.open = true; });
  await settleProperties(panel);
  const row = panel.locator('[data-property-name="updated_at"]');
  async function press(button, editor, heldFrames) {
    const before = await button.boundingBox();
    await page.mouse.move(before.x + 12, before.y + 11);
    await page.mouse.down();
    const sample = (locator, frames) => locator.evaluate(async (el, frames) => {
      const samples = [];
      for (let i = 0; i < frames; i++) {
        await new Promise(requestAnimationFrame);
        const rect = el.getBoundingClientRect();
        samples.push({ x: rect.x, y: rect.y, width: rect.width, scale: getComputedStyle(el).scale });
      }
      return samples;
    }, frames);
    const down = await sample(button, heldFrames);
    await page.mouse.up();
    await expect(editor).toBeFocused();
    const up = await sample(editor, 24);
    for (const frame of [...down, ...up]) {
      expect(frame.scale === 'none' || frame.scale === '1').toBe(true);
      expect(frame.x).toBe(before.x);
      expect(frame.y).toBe(before.y);
      expect(frame.width).toBe(before.width);
    }
  }
  for (const heldFrames of [1, 12]) {
    await press(row.locator('.frontmatter-property-name'), row.locator('.frontmatter-name-input'), heldFrames);
    await press(row.locator('.frontmatter-property-value'), row.locator('.frontmatter-value-editor input'), heldFrames);
    await row.locator('.frontmatter-value-editor input').press('Enter');
    await settleProperties(panel);
    await press(row.locator('.frontmatter-property-value'), row.locator('.frontmatter-value-editor input'), heldFrames);
    await row.locator('.frontmatter-value-editor input').press('Enter');
    await settleProperties(panel);
  }
  await row.locator('.frontmatter-property-type').click();
  const menu = row.locator('.frontmatter-type-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('button').first()).toHaveCSS('font-size', '12px');
  await expect(menu.locator('button').first()).toHaveCSS('line-height', '16px');
  await expect(menu.locator('button').first()).toHaveCSS('min-height', '26px');
  await expect(menu.locator('button').first()).toHaveCSS('gap', '6px');
  await expect(menu.locator('button svg').first()).toHaveCSS('width', '14px');
  await settleProperties(panel);
  const deleteButton = menu.locator('.frontmatter-type-delete');
  // The disclosure/row animations temporarily clip these containers.
  await panel.locator('.frontmatter-content').evaluate(el => { el.style.overflow = 'clip'; });
  expect(await deleteButton.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await panel.locator('.frontmatter-content').evaluate(el => { el.style.overflow = ''; });
  // Click non-focusable whitespace: dismissal must not depend on focusout.
  const bounds = await panel.boundingBox();
  await page.mouse.click(bounds.x + bounds.width - 3, bounds.y + bounds.height - 3);
  await expect(menu).toHaveCount(0);
  await expect(row.locator('.frontmatter-property-type')).toHaveAttribute('aria-expanded', 'false');
  await row.locator('.frontmatter-property-type').click();
  await expect(menu).toBeVisible();
  // A menu option still receives its click and applies the chosen type.
  await menu.getByRole('menuitemradio').filter({ hasText: /^(数字|Number)$/ }).click();
  await expect(menu).toHaveCount(0);
  await row.locator('.frontmatter-property-type').click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio').filter({ hasText: /^(数字|Number)$/ })).toHaveAttribute('aria-checked', 'true');
  await row.locator('.frontmatter-property-type').click();
  await expect(menu).toHaveCount(0);
});

test('null placeholder stays in place when entering and leaving editing', async ({ page }) => {
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('null-layout.md', false, '---\nempty: null\nafter: next row\n---\n\n# Null property\n');
  });
  const panel = page.locator('.frontmatter-panel');
  await expect(panel).toBeVisible();
  await panel.evaluate(el => { el.open = true; });
  const row = panel.locator('[data-property-name="empty"]');
  const next = panel.locator('[data-property-name="after"]');
  const metrics = locator => locator.evaluate(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { x: rect.x, y: rect.y, height: rect.height, padding: style.padding, font: style.font, color: style.color };
  });
  for (const width of [1280, 500]) {
    await page.setViewportSize({ width, height: 900 });
    const preview = row.locator('.frontmatter-property-value');
    await expect(preview).toBeVisible();
    await settleProperties(panel);
    const before = await metrics(preview);
    const ink = await textInk(page, preview);
    const following = await metrics(next);
    const label = await preview.textContent();
    await preview.click();
    const placeholder = row.locator('.frontmatter-null-value');
    await expect(placeholder).toHaveText(label);
    await settleProperties(panel);
    expect(await metrics(placeholder)).toEqual(before);
    expect(await textInk(page, placeholder)).toEqual(ink);
    expect(await metrics(next)).toEqual(following);
    await row.locator('.frontmatter-name-input').press('Tab');
    await expect(placeholder).toHaveCount(0);
    await settleProperties(panel);
    expect(await metrics(preview)).toEqual(before);
    expect(await textInk(page, preview)).toEqual(ink);
    expect(await metrics(next)).toEqual(following);
  }
});

// Native controls can move the text inside an otherwise identical CSS box.
async function textInk(page, locator) {
  const box = await locator.boundingBox();
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: 60, height: 22 } });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = [];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * info.channels;
    if (data[offset] < 120 && data[offset + 1] < 120 && data[offset + 2] < 120) pixels.push([x, y]);
  }
  expect(pixels.length).toBeGreaterThan(0);
  return { x: Math.min(...pixels.map(p => p[0])), y: Math.min(...pixels.map(p => p[1])) };
}

test('multiline property editors and validation stay inside their row', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('json-layout.md', false, '---\ndescription: |\n  First line of a multiline string.\n  Second line keeps its line break.\nnested:\n  owner: Tester\n  score: 100\nitems:\n  - name: Document\n    done: true\n  - name: Attachment\n    done: false\nenabled: true\ndisabled: false\nafter: next row\n---\n\n# JSON properties\n');
  });
  const panel = page.locator('.frontmatter-panel');
  await expect(panel).toBeVisible();
  await panel.evaluate(el => { el.open = true; });
  const assertContained = async () => {
    await expect.poll(() => panel.evaluate(el => {
      const row = el.querySelector('.is-editing');
      const bottom = row.getBoundingClientRect().bottom;
      return [...row.querySelectorAll('textarea, .frontmatter-row-error')].every(child => child.getBoundingClientRect().bottom <= bottom)
        && row.nextElementSibling.getBoundingClientRect().top >= bottom;
    })).toBe(true);
  };
  for (const width of [1280, 500]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['description', 'nested', 'items', 'after', 'enabled', 'disabled']) {
      const row = panel.locator(`[data-property-name="${name}"]`);
      await expect(row).toBeVisible();
      await expect.poll(() => row.evaluate(el => el.getBoundingClientRect().height)).toBe(34);
      const collapsedHeight = await row.evaluate(el => el.getBoundingClientRect().height);
      expect(collapsedHeight).toBe(34);
      await expect(row.locator('.frontmatter-property-value')).toHaveCSS('white-space', 'nowrap');
      await expect(row.locator('.frontmatter-property-value')).toHaveCSS('text-overflow', 'ellipsis');
      const metrics = selector => row.locator(selector).evaluate(el => {
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        return { x: rect.x, y: rect.y, font: style.font, color: style.color, padding: style.padding, lineHeight: style.lineHeight };
      });
      const nameBefore = await metrics('.frontmatter-property-name');
      const valueBefore = await metrics('.frontmatter-property-value');
      await row.locator('.frontmatter-property-name').click();
      await expect(row.locator('.frontmatter-name-input')).toBeFocused();
      await expect(row.locator('.frontmatter-value-editor :is(input, textarea, select)')).toHaveCount(0);
      await settleProperties(panel);
      expect(await metrics('.frontmatter-property-value')).toEqual(valueBefore);
      expect(await row.evaluate(el => el.getBoundingClientRect().height)).toBe(collapsedHeight);
      const originalValue = await row.locator('.frontmatter-property-value').textContent();
      // Rename while leaving the value collapsed, then enter value editing directly.
      await row.locator('.frontmatter-name-input').fill(`${name}_renamed`);
      const renamed = panel.locator(`[data-property-name="${name}_renamed"]`);
      await expect(renamed.locator('.frontmatter-property-value')).toHaveText(originalValue);
      await expect(renamed.locator('textarea')).toHaveCount(0);
      await renamed.locator('.frontmatter-name-input').fill(name);
      await expect(row).toBeVisible();
      const boolean = name === 'enabled' || name === 'disabled';
      const inkBefore = boolean ? await textInk(page, row.locator('.frontmatter-property-value')) : null;
      await row.locator('.frontmatter-property-value').click();
      const input = row.locator('.frontmatter-value-editor :is(input, textarea, select)');
      await expect(input).toBeVisible();
      expect(await metrics('.frontmatter-name-input')).toEqual(nameBefore);
      const editingMetrics = await metrics('.frontmatter-value-editor :is(input, textarea, select)');
      // The select reserves extra space on the right for its arrow.
      expect({ ...editingMetrics, padding: valueBefore.padding }).toEqual(valueBefore);
      if (boolean) expect(await textInk(page, input)).toEqual(inkBefore);
      const value = await input.inputValue();
      if (boolean) {
        const other = value === 'true' ? 'false' : 'true';
        await input.selectOption(other);
        await expect(input).toHaveValue(other);
        await input.selectOption(value);
      }
      if (['description', 'nested', 'items'].includes(name)) {
        await assertContained();
        expect(await row.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(collapsedHeight);
      }
      expect(await input.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      await panel.screenshot({ path: testInfo.outputPath(`properties-${name}-${width}.png`) });
      if (name === 'nested' || name === 'items') {
        await input.fill('{');
        await expect(row.locator('.frontmatter-row-error')).toBeVisible();
        await assertContained();
        await input.fill(value);
        await expect(row.locator('.frontmatter-row-error')).toHaveCount(0);
      }
      await input.press('Tab');
      await expect(row.locator('.frontmatter-row-editor')).toHaveCount(0);
      expect(await metrics('.frontmatter-property-name')).toEqual(nameBefore);
      expect(await metrics('.frontmatter-property-value')).toEqual(valueBefore);
      if (boolean) expect(await textInk(page, row.locator('.frontmatter-property-value'))).toEqual(inkBefore);
      await expect.poll(() => row.evaluate(el => el.getBoundingClientRect().height)).toBe(collapsedHeight);
    }
  }
});
