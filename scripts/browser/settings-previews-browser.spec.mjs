import { expect, test } from '@playwright/test';
import { capabilityTargets, settingTargets } from '../build/preview-renderer-targets.mjs';

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

test('theme presets only bounce when the user switches presets', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSettings(page);
  const nav = page.locator('.settings-nav');
  const presets = page.locator('.theme-preset-quick-row');
  const current = presets.getByRole('button', { pressed: true });
  const islands = presets.getByRole('button', { name: '应用预设：卡片岛' });
  const selectAndReadAnimations = preset => preset.evaluate(async button => {
    // Activation through click excludes the separate pointer and keyboard press effects.
    const row = button.closest('.theme-preset-quick-row');
    button.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return row.querySelector('[aria-pressed="true"]').getAnimations()
      .map(animation => animation.effect.getKeyframes().map(frame => frame.scale))
      .filter(scales => scales.some(scale => scale !== undefined));
  });

  await nav.getByRole('button', { name: '外观', exact: true }).click();
  await expect(current).toHaveAccessibleName('应用预设：同页默认');
  await expect(current).toHaveCSS('animation-name', 'none');
  expect(await selectAndReadAnimations(islands)).toEqual([['0.94', '1']]);
  await expect(islands).toHaveAttribute('aria-pressed', 'true');

  await nav.getByRole('button', { name: '编辑器', exact: true }).click();
  await expect(current).toHaveCount(0);
  await nav.getByRole('button', { name: '外观', exact: true }).click();
  await expect(current).toHaveAccessibleName('应用预设：卡片岛');
  await expect(current).toHaveCSS('animation-name', 'none');
  expect(await selectAndReadAnimations(islands)).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The default preset is now the "previous" card beside the current one.
  const defaults = presets.getByRole('button', { name: '应用预设：同页默认' });
  expect(await selectAndReadAnimations(defaults)).toEqual([]);
  await expect(defaults).toHaveAttribute('aria-pressed', 'true');
});

test('saves, reapplies and deletes a custom theme without changing the active appearance on deletion', async ({ page }) => {
  await openSettings(page);
  const openAppearance = () => page.locator('.settings-nav').getByRole('button', { name: '外观', exact: true }).click();
  await openAppearance();
  const presets = page.getByRole('region', { name: '主题预设' });
  const save = presets.getByRole('button', { name: '保存当前搭配为自定义主题' });
  const remove = presets.getByRole('button', { name: '删除主题「自定义主题 1」' });
  const current = presets.getByRole('button', { name: '应用预设：当前搭配' });
  const shape = page.getByRole('combobox', { name: '形态与密度' });
  await expect(save).toHaveCount(0);
  await expect(presets.getByRole('button', { name: /^删除主题/ })).toHaveCount(0);
  await presets.getByRole('button', { name: '应用预设：卡片岛' }).click();
  await shape.selectOption('builtin:crisp');
  await expect(current).toHaveAttribute('aria-pressed', 'true');
  await save.focus();
  await save.press('Enter');
  const custom = presets.getByRole('button', { name: '应用预设：自定义主题 1' });
  await expect(custom).toBeFocused();
  await expect(custom).toHaveAttribute('aria-pressed', 'true');
  await expect(save).toHaveCount(0);

  await openSettings(page);
  await openAppearance();
  await expect(custom).toHaveAttribute('aria-pressed', 'true');
  await presets.getByRole('button', { name: '更多主题', exact: true }).click();
  await presets.getByRole('button', { name: '应用预设：同页默认' }).click();
  await expect(shape).toHaveValue('builtin:tano');
  await presets.getByRole('button', { name: '更多主题', exact: true }).click();
  await presets.getByRole('button', { name: '应用预设：纸感' }).click();
  await presets.getByRole('button', { name: '更多主题', exact: true }).click();
  await presets.getByRole('region', { name: '更多主题' }).getByRole('button', { name: '应用预设：自定义主题 1' }).click();
  await expect(shape).toHaveValue('builtin:crisp');
  await expect(page.getByRole('combobox', { name: '布局风格' })).toHaveValue('builtin:islands');

  await remove.click();
  await expect(current).toBeFocused();
  await expect(save).toBeVisible();
  await expect(shape).toHaveValue('builtin:crisp');
  await openSettings(page);
  await openAppearance();
  await expect(current).toHaveAttribute('aria-pressed', 'true');
  await expect(shape).toHaveValue('builtin:crisp');
  await presets.getByRole('button', { name: '更多主题', exact: true }).click();
  await expect(custom).toHaveCount(0);
  await expect(remove).toHaveCount(0);
});

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
async function expectLeftOfRow(page, tooltip, row) {
  const hint = await tooltip.boundingBox();
  const anchor = await row.boundingBox();
  expect(anchor.x - (hint.x + hint.width)).toBeCloseTo(8, 0);
  const centerTop = anchor.y + (anchor.height - hint.height) / 2;
  expect(hint.y).toBeCloseTo(Math.max(8, Math.min(centerTop, page.viewportSize().height - 8 - hint.height)), 0);
  expect(hint.x).toBeGreaterThanOrEqual(8);
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
      if (scene === 'input-spacing') {
        await expect(rendered.locator('.input-spacing-caret')).toBeVisible();
        await expect(rendered.locator('.input-spacing-source')).toContainText('用 T');
      } else {
        await animationFrame(example, scene === 'mermaid' ? 2700 : 700);
        if (scene === 'folding') {
          await expect(rendered.locator('.demo-after .tano-folded-heading-content').first()).toHaveCSS('display', 'none');
          await expect(rendered.locator('.demo-after .tano-fold-toggle').first()).toBeVisible();
          await expect(rendered.locator('.demo-after .tano-fold-toggle').first()).toHaveText('▸');
        }
        await expect(example.locator('.demo-phase > .demo-after')).toHaveCSS('opacity', '1');
      }
      const viewport = example.locator('.example-viewport');
      const height = () => viewport.evaluate(element => element.offsetHeight);
      if (scene === 'recognition') {
        await expect.poll(height).toBeLessThan(48);
      }
      await example.screenshot({ path: testInfo.outputPath(`${key}-${locale}.png`) });
      const afterHeight = await height();
      await expectLeftOfRow(page, tooltip, row);
      if (scene !== 'input-spacing') {
        await animationFrame(example, scene === 'mermaid' ? 700 : 2700);
        await expect(example.locator('.demo-phase > .demo-before')).toHaveCSS('opacity', '1');
      }
      expect(await height()).toBe(afterHeight);
      if (['editing-preview-math', 'editing-preview-mermaid', 'editing-folding'].includes(key))
        await example.screenshot({ path: testInfo.outputPath(`${key}-before-${locale}.png`) });
      covered++;
    }
    expect(await controlState()).toEqual(original);
    if (category === 'documents') {
      for (const [feature, selector] of Object.entries(capabilityTargets)) {
        const row = page.locator(`[data-settings-key="documents-${feature}"]`);
        await hoverRow(page, row);
        const example = tooltip.locator('.capability-example');
        await expect(example).toHaveAttribute('data-feature', feature);
        await expect(example.locator(selector).first()).toBeAttached();
        if (feature === 'inlineComment') await expect(example.locator(selector)).toBeVisible();
        await example.screenshot({ path: testInfo.outputPath(`capability-${feature}-${locale}.png`) });
        await expectLeftOfRow(page, tooltip, row);
      }
    }
  }
  expect(covered).toBe(20);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(page.locator('.settings-dialog')).toBeVisible();
  expect(await page.locator('.ProseMirror').first().innerText()).toBe(content);
  expect(errors).toEqual([]);
});

test('the page title preview stays close to its row when the settings window gets narrower', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSettings(page);
  await page.setViewportSize({ width: 1065, height: 700 });
  await page.locator('.settings-nav').getByRole('button', { name: '外观', exact: true }).click();
  const row = page.locator('[data-settings-key="appearance-page-title"]');
  const tooltip = page.getByRole('tooltip');
  await hoverRow(page, row);
  await expect(tooltip).toHaveAttribute('data-setting', 'appearance-page-title');
  await expect(tooltip).toHaveAttribute('data-ready', 'true');
  await expect(tooltip.locator('.example-viewport')).toHaveAttribute('data-ready', 'true');
  await expect(tooltip).toHaveCSS('animation-name', 'none');
  await expect(tooltip).toHaveCSS('pointer-events', 'none');
  await expectLeftOfRow(page, tooltip, row);
  await page.screenshot({ path: testInfo.outputPath('page-title-preview-left.png') });

  await page.setViewportSize({ width: 620, height: 700 });
  await expect(tooltip).toHaveCount(0);
  await hoverRow(page, row);
  await expect(tooltip).toHaveAttribute('data-ready', 'true');
  const hint = await tooltip.boundingBox();
  const anchor = await row.boundingBox();
  expect(hint.x).toBeCloseTo(anchor.x, 0);
  expect(Math.max(anchor.y - (hint.y + hint.height), hint.y - (anchor.y + anchor.height))).toBeCloseTo(8, 0);
  expect(hint.y).toBeGreaterThanOrEqual(8);
  expect(hint.y + hint.height).toBeLessThanOrEqual(692);
});

test('the spacing preview inserts literal spaces during individual keystrokes', async ({ page }, testInfo) => {
  await openSettings(page);
  await page.locator('.settings-nav').getByRole('button', { name: '编辑器', exact: true }).click();
  const row = page.locator('[data-settings-key="editing-autocomplete-spacing"]');
  await hoverRow(page, row);
  const example = page.getByRole('tooltip').locator('.setting-example[data-scene="input-spacing"]');
  const rendered = example.frameLocator('iframe');
  const demo = rendered.locator('.input-spacing-example');
  const readFrame = () => demo.evaluate(element => ({
    key: element.querySelector('kbd')?.textContent,
    source: element.querySelector('.input-spacing-source').textContent,
    inserted: [...element.querySelectorAll('.input-spacing-inserted')].map(space => space.textContent),
  }));
  const sampling = { intervals: [50, 100], timeout: 12000 };
  await expect.poll(readFrame, sampling).toEqual({ key: '用', source: '用', inserted: [] });
  const viewport = example.locator('.example-viewport');
  const initialHeight = await viewport.evaluate(element => element.offsetHeight);
  await expect.poll(readFrame, sampling).toEqual({ key: 'T', source: '用 T', inserted: [' '] });
  await expect.poll(readFrame, sampling).toEqual({ key: '$', source: '用 Tano 记录 2026 年\n公式 $x$', inserted: [' '] });
  await expect.poll(readFrame, sampling).toEqual({ key: ']', source: '用 Tano 记录 2026 年\n公式 $x$ 见 [[笔记]]', inserted: [' '] });
  expect(await viewport.evaluate(element => element.offsetHeight)).toBe(initialHeight);
  await example.screenshot({ path: testInfo.outputPath('typing-spaces.png') });
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('the folding preview animates in both directions without rescaling headings', async ({ page }, testInfo) => {
  await openSettings(page);
  await page.locator('.settings-nav').getByRole('button', { name: '编辑器', exact: true }).click();
  await hoverRow(page, page.locator('[data-settings-key="editing-folding"]'));
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveAttribute('data-ready', 'true');
  await expect(tooltip).toHaveCSS('animation-name', 'none');
  const example = tooltip.locator('.setting-example[data-scene="folding"]');
  const rendered = example.frameLocator('iframe');
  await expect(rendered.locator('.demo-after[data-ready="true"] h2').first()).toBeVisible();
  await animationFrame(example, 100);
  const heading = rendered.locator('.demo-after h2').first();
  const headingOnly = { style: '.tano-fold-toggle { visibility: hidden !important; }' };
  const initial = await heading.boundingBox();
  const initialPixels = await heading.screenshot({ ...headingOnly, path: testInfo.outputPath('heading-initial.png') });
  await animationFrame(example, 1200);
  const settled = await heading.boundingBox();
  expect(initial.width).toBeCloseTo(settled.width, 1);
  expect(initial.height).toBeCloseTo(settled.height, 1);
  const settledPixels = await heading.screenshot({ ...headingOnly, path: testInfo.outputPath('heading-settled.png') });
  expect(settledPixels.equals(initialPixels)).toBe(true);

  const expanded = rendered.locator('.demo-crossfade > .demo-before');
  const collapsed = rendered.locator('.demo-crossfade > .demo-after');
  const lowerHeading = expanded.locator('h2').last();
  const editorArrow = expanded.locator('.tano-fold-toggle').last();
  const foldedPosition = (await collapsed.locator('h2').last().boundingBox()).y;
  await expect(editorArrow).toHaveCSS('visibility', 'hidden');
  const headingArrow = () => lowerHeading.evaluate(element => {
    const marker = getComputedStyle(element, '::before');
    return { content: marker.content, position: marker.position, top: marker.top, height: parseFloat(marker.height) };
  });
  await animationFrame(example, 2700);
  const expandedPosition = (await lowerHeading.boundingBox()).y;
  const expandedArrow = await headingArrow();
  expect(expandedArrow).toMatchObject({ content: '"▾"', position: 'absolute', top: '0px' });
  expect(expandedArrow.height).toBeCloseTo(await lowerHeading.evaluate(element => element.getBoundingClientRect().height), 1);
  await example.screenshot({ path: testInfo.outputPath('folding-expanded.png') });
  for (const time of [1500, 4250]) {
    await animationFrame(example, time);
    await expanded.locator('.tano-prose').dispatchEvent('tano-block-layout');
    await expect(expanded).toHaveCSS('opacity', '1');
    await expect(collapsed).toHaveCSS('opacity', '0');
    const movingHeading = await lowerHeading.boundingBox();
    expect(movingHeading.y).toBeGreaterThan(foldedPosition);
    expect(movingHeading.y).toBeLessThan(expandedPosition);
    expect(movingHeading.height).toBeCloseTo(settled.height, 1);
    expect(await headingArrow()).toEqual(expandedArrow);
    await expect(editorArrow).toHaveCSS('visibility', 'hidden');
    const listClip = await expanded.locator('.tano-prose > ul').evaluate(element => getComputedStyle(element).clipPath);
    expect(parseFloat(listClip.match(/([\d.]+)%\)/)?.[1])).toBeCloseTo(50, 1);
  }
});

test('the Mermaid setting preview reserves its height and fades in the rendered diagram', async ({ page }) => {
  await openSettings(page);
  await page.locator('.settings-nav').getByRole('button', { name: '编辑器', exact: true }).click();
  const recorded = await page.evaluateHandle(() => {
    const heights = new Set();
    const transforms = new Set();
    const observer = new MutationObserver(() => {
      const viewport = document.querySelector('.setting-example[data-scene="mermaid"] .example-viewport');
      if (viewport) heights.add(viewport.style.height);
      const transform = viewport?.querySelector('iframe')?.style.transform;
      if (transform) transforms.add(transform);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    return { heights, transforms, observer };
  });
  try {
    await hoverRow(page, page.locator('[data-settings-key="editing-preview-mermaid"]'));
    const example = page.getByRole('tooltip').locator('.setting-example[data-scene="mermaid"]');
    await expect(example.frameLocator('iframe').locator('.demo-after .tano-live-mermaid-preview svg')).toBeVisible();
    const renderedPhase = example.frameLocator('iframe').locator('.demo-crossfade > .demo-after');
    for (const [time, opacity] of [[0, '0'], [2700, '1']]) {
      await animationFrame(example, time);
      await expect(example.locator('.example-viewport')).toHaveCSS('height', '104px');
      await expect(renderedPhase).toHaveCSS('opacity', opacity);
    }
    await animationFrame(example, 2150);
    const opacity = await renderedPhase.evaluate(element => Number(getComputedStyle(element).opacity));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    expect(await recorded.evaluate(({ heights }) => [...heights])).toEqual(['104px']);
    expect(await recorded.evaluate(({ transforms }) => transforms.size)).toBe(1);
  } finally {
    await recorded.evaluate(({ observer }) => observer.disconnect());
    await recorded.dispose();
  }
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

  await hoverRow(page, page.locator('[data-settings-key="editing-autocomplete-spacing"]'));
  await expect(example).toHaveAttribute('data-scene', 'input-spacing');
  const rendered = example.frameLocator('iframe');
  await expect(rendered.locator('.input-spacing-caret')).toHaveCount(0);
  await expect(rendered.locator('.input-spacing-key')).toHaveCount(0);
  await expect(rendered.locator('.input-spacing-source')).toHaveText('用 Tano 记录 2026 年 公式 $x$ 见 [[笔记]]');

  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(page.locator('.settings-dialog')).toBeVisible();
});
