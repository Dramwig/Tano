import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) test(`source line numbers follow the caret and the page menu at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 850 });
  await page.goto('http://127.0.0.1:43845');
  await page.locator('.ProseMirror').first().waitFor();
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('源码行号.md', false, '# 标题\n\n第一段\n第二段\n第三段\n');
  });
  await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  const source = page.locator('.source-editor');
  const content = source.locator('.cm-content');
  const displayedNumbers = () => source.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll(elements =>
    elements.filter(element => {
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.color !== 'rgba(0, 0, 0, 0)';
    }).map(element => element.textContent));
  await content.click();
  await page.keyboard.press('Control+Home');
  await expect.poll(displayedNumbers).toEqual(['1']);
  await page.keyboard.press('ArrowDown');
  await expect.poll(displayedNumbers).toEqual(['2']);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(displayedNumbers).toEqual(['3']);
  const before = await content.boundingBox();
  const openMenu = async () => {
    await page.locator('.editor-scroll').first().click({ button: 'right', position: { x: 12, y: 160 } });
    return page.getByRole('menuitemcheckbox', { name: '显示所有行号', exact: true });
  };
  let toggle = await openMenu();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect.poll(displayedNumbers).toEqual(['1', '2', '3', '4', '5', '6']);
  expect((await content.boundingBox()).x).toBe(before.x);
  toggle = await openMenu();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').flush());
  await page.reload();
  await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  await expect.poll(displayedNumbers).toEqual(['1', '2', '3', '4', '5', '6']);
  toggle = await openMenu();
  await toggle.click();
  await content.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Enter');
  await expect.poll(displayedNumbers).toEqual(['2']);
  await page.keyboard.press('Control+z');
  await expect.poll(displayedNumbers).toEqual(['1']);
  await page.screenshot({ path: testInfo.outputPath(`source-current-line-${width}.png`) });
});
