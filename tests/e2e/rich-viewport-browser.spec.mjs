import { test, expect } from '@playwright/test';

async function openDocument(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  const text = Array.from({ length: 1000 }, (_, i) =>
    `Paragraph-${i} ${'正文包含 **加粗** 和 ==高亮==。'.repeat(8)}\n\n` +
    (i % 20 === 0 ? `| ${'Name'.padEnd(`Cell-${i}`.length)} | Value |\n| ${'-'.repeat(`Cell-${i}`.length)} | ----- |\n| Cell-${i} | 123   |\n\n` : '')).join('').trimEnd() + '\n';
  await page.evaluate(async text => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('virtual-body.md', false, text);
  }, text);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  return text;
}

async function editorAction(page, action, args) {
  return page.evaluate(({ action, args }) => {
    let component = document.querySelector('.milkdown-host').__vueParentComponent;
    while (!component.exposed?.restoreModeSelection) component = component.parent;
    return component.exposed[action](...args);
  }, { action, args });
}

const content = page => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content);

test('virtual body mounts distant search targets and tables while retaining full text and undo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const text = await openDocument(page);
  await expect.poll(() => page.locator('[data-tano-virtual-placeholder]').count()).toBeGreaterThan(900);
  expect(await page.locator('.ProseMirror strong').count()).toBeLessThan(500);
  expect(await page.locator('.tano-table-viewport').count()).toBeLessThan(5);
  expect(await content(page)).toBe(text);
  await editorAction(page, 'search', ['Paragraph-700', 0, true]);
  await expect(page.locator('.ProseMirror p').filter({ hasText: 'Paragraph-700' })).toBeVisible();
  await page.locator('.ProseMirror p').filter({ hasText: 'Paragraph-700' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('本地输入');
  await expect.poll(() => content(page)).toContain('本地输入');
  await page.keyboard.press('Control+z');
  await expect.poll(() => content(page)).toBe(text);
  await editorAction(page, 'search', ['Cell-980', 0, true]);
  await expect(page.locator('.ProseMirror td').filter({ hasText: 'Cell-980' })).toBeVisible();
  await page.setViewportSize({ width: 850, height: 900 });
  await expect(page.locator('.ProseMirror td').filter({ hasText: 'Cell-980' })).toBeVisible();
  expect(await content(page)).toBe(text);
  expect(errors).toEqual([]);
});

test('cross-screen selection copies all selected text and offscreen updates appear when revealed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const text = await openDocument(page);
  const from = text.indexOf('Paragraph-20'), to = text.indexOf('Paragraph-900');
  await editorAction(page, 'restoreModeSelection', [{ anchor: from, head: to }]);
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, clipboardData: data }));
    return data.getData('text/plain');
  });
  expect(copied).toContain('Paragraph-20');
  expect(copied).toContain('Paragraph-500');
  expect(copied).toContain('Paragraph-899');
  await editorAction(page, 'restoreModeSelection', [{ anchor: 20, head: 20 }]);
  const changed = text.replace('Paragraph-500', 'REMOTE-500').replace('Paragraph-999', 'REMOTE-999');
  await page.evaluate(value => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content = value;
  }, changed);
  await editorAction(page, 'search', ['REMOTE-500', 0, true]);
  await expect(page.locator('.ProseMirror p').filter({ hasText: 'REMOTE-500' })).toBeVisible();
  await editorAction(page, 'search', ['REMOTE-999', 0, true]);
  await expect(page.locator('.ProseMirror p').filter({ hasText: 'REMOTE-999' })).toBeVisible();
  expect(await content(page)).toBe(changed);
  expect(errors).toEqual([]);
});

test('printing renders a complete snapshot of a virtualized document', async ({ page }) => {
  await page.addInitScript(() => { window.print = () => window.dispatchEvent(new Event('beforeprint')); });
  const text = await openDocument(page);
  await expect.poll(() => page.locator('[data-tano-virtual-placeholder]').count()).toBeGreaterThan(900);
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await page.getByRole('button', { name: /打印…/ }).click();
  const snapshot = page.locator('.document-print-root .document-export-content');
  await expect(snapshot).toContainText('Paragraph-999');
  await expect(snapshot.locator('table')).toHaveCount(50);
  await expect(snapshot.locator('strong')).toHaveCount(8000);
  await expect(snapshot.locator('[data-tano-virtual-placeholder]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(snapshot).toHaveCount(0);
  expect(await content(page)).toBe(text);
});
