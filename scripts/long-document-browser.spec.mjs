import { test, expect } from '@playwright/test';

test('long documents keep controls bounded while scrolling, folding and editing at the end', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const markdown = Array.from({ length: 800 }, (_, i) =>
    `## Section ${i + 1}\n\nParagraph ${i + 1}: ${'Long document text with 中文内容. '.repeat(12)}\n\n`).join('');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async markdown => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('long-viewport.md', false, markdown);
  }, markdown);
  const prose = page.locator('.ProseMirror');
  await expect(prose.locator('h2')).toHaveCount(800);
  const content = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content);
  await expect.poll(() => page.locator('.tano-block-handle').count()).toBeGreaterThan(0);
  expect(await page.locator('.tano-block-handle').count()).toBeLessThan(50);
  for (const fraction of [0.5, 1, 0, 1]) {
    await page.locator('.document-layout').evaluate((el, fraction) => { el.scrollTop = el.scrollHeight * fraction; }, fraction);
    await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); });
    expect(await page.locator('.tano-block-handle').count()).toBeLessThan(50);
    expect(await content()).toBe(markdown);
  }
  const heading = prose.locator('h2').last();
  await heading.hover();
  const fold = page.locator('.tano-fold-toggle.is-visible').last();
  await expect(fold).toBeVisible();
  await fold.click();
  await expect(prose.locator('p').last()).toBeHidden();
  await fold.click();
  await expect(prose.locator('p').last()).toBeVisible();
  expect(await content()).toBe(markdown);
  await prose.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('END-EDIT');
  await expect.poll(content).toContain('END-EDIT');
  await page.keyboard.press('Control+z');
  await expect.poll(content).not.toContain('END-EDIT');
  await expect(prose.locator('h2')).toHaveCount(800);
  const retained = await content();
  // Use a reading position with space below it in both modes; at the document
  // bottom the two modes can legitimately clamp to different scroll limits.
  await page.evaluate(offset => {
    let component = document.querySelector('.milkdown-host').__vueParentComponent;
    while (!component.exposed?.restoreModeSelection) component = component.parent;
    component.exposed.restoreModeSelection({ anchor: offset, head: offset });
    document.querySelector('.document-layout').scrollTop += component.exposed.modeCursorTop() - 360;
  }, retained.indexOf('Paragraph 600:') + 20);
  await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); });
  const before = await modeState(page);
  await page.getByRole('button', { name: '切换源码模式', exact: true }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.cm-source-heading-2').first()).toBeVisible();
  await expect.poll(async () => (await modeState(page)).selection).toEqual(before.selection);
  await expect.poll(async () => Math.abs((await modeState(page)).top - before.top)).toBeLessThan(3);
  await page.keyboard.insertText('SOURCE-END-EDIT');
  await expect.poll(content).toContain('SOURCE-END-EDIT');
  await page.keyboard.press('Control+z');
  await expect.poll(content).toBe(retained);
  await page.getByRole('button', { name: '返回编辑', exact: true }).first().click();
  await expect(prose.locator('h2')).toHaveCount(800);
  expect(await page.locator('.tano-block-handle').count()).toBeLessThan(50);
  expect(await content()).toBe(retained);
  expect(errors).toEqual([]);
});

test('outline follows scroll snapshots and refreshes its index after wrapping changes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const text = Array.from({ length: 12 }, (_, i) => `## Reading section ${i + 1}\n\n${'正文 English paragraph. '.repeat(100)}\n\n`).join('');
    await store.create('outline-scroll-snapshot.md', false, text);
  });
  const headings = page.locator('.ProseMirror h2');
  await expect(headings).toHaveCount(12);
  for (const [width, index] of [[1280, 6], [900, 3], [1440, 9]]) {
    await page.setViewportSize({ width, height: 900 });
    await headings.nth(index).evaluate(heading => heading.scrollIntoView({ block: 'start' }));
    await expect(page.locator('.outline [aria-current="location"]')).toHaveAttribute('aria-label', `跳转到Reading section ${index + 1}`);
  }
  expect(errors).toEqual([]);
});

async function modeState(page) {
  return page.evaluate(() => {
    let component = document.querySelector('.source-editor, .milkdown-host').__vueParentComponent;
    while (!component.exposed?.captureModeSelection) component = component.parent;
    return { selection: component.exposed.captureModeSelection(), top: component.exposed.modeCursorTop() };
  });
}
