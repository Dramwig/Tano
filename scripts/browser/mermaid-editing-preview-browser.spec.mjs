import { expect, test } from '@playwright/test';

const markdown = '# 编辑时预览\n\n点击图表展开源码，编辑时同步预览。\n\n```mermaid\nflowchart LR\n  A[Markdown file] --> B[Editor]\n  B --> C[Save changes]\n  C --> A\n```\n\n后续正文。\n';
const origin = process.env.TANO_MERMAID_TEST_URL || 'http://127.0.0.1:43845';

test('previews Mermaid source while typing and persists the independent setting', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (window.top === window) localStorage.setItem('tano.preference.locale', 'zh-CN');
  });
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async content => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('Mermaid 编辑预览.md', false, content);
  }, markdown);
  const prose = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  await expect(prose.locator('.tano-mermaid-preview svg')).toBeVisible();
  await prose.locator('.tano-mermaid-preview').click();
  const source = prose.locator('pre[data-tano-live-source]');
  const preview = source.locator('.tano-live-mermaid-preview');
  await expect(preview.locator('svg')).toBeVisible();
  await expect(preview).toHaveCSS('background-color', 'rgb(21, 21, 21)');
  const checkBounds = async () => {
    const bounds = await preview.boundingBox();
    const size = page.viewportSize();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
  };
  await checkBounds();
  await page.screenshot({ path: testInfo.outputPath('mermaid-editing-preview.png') });
  await expect(source.locator('code')).toContainText('Save changes');
  await expect(preview).toContainText('Save changes');
  // Edit in the real contenteditable field without replacing the preview DOM.
  await source.locator('code').evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const offset = walker.currentNode.textContent.indexOf('Save changes');
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, offset);
      range.setEnd(walker.currentNode, offset + 'Save changes'.length);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      break;
    }
  });
  await page.keyboard.type('Live update');
  await expect(preview).toContainText('Live update');
  await expect(preview.locator('svg')).toBeVisible();
  await prose.locator('p').filter({ hasText: '后续正文。' }).click();
  await expect(preview).toHaveCount(0);
  await expect(prose.locator('.tano-mermaid-preview svg')).toBeVisible();

  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const search = page.getByRole('searchbox');
  await search.fill('Mermaid');
  await page.locator('.settings-nav-setting-results button').filter({ hasText: '编辑时预览 Mermaid' }).click();
  const toggle = page.getByRole('switch', { name: '编辑时预览 Mermaid', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('mermaid-editing-setting.png') });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('tano.preference.previewMermaidWhileEditing'))).toBe('false');
  expect(await page.evaluate(() => localStorage.getItem('tano.preference.previewMathWhileEditing'))).not.toBe('false');
  await page.reload();
  await page.getByRole('button', { name: /^切换上下文：/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-nav button').filter({ hasText: /^编辑器$/ }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await prose.locator('.tano-mermaid-preview').click();
  await expect(preview.locator('svg')).toBeVisible();
  await page.setViewportSize({ width: 480, height: 800 });
  await checkBounds();
  await page.screenshot({ path: testInfo.outputPath('mermaid-editing-preview-narrow.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});
