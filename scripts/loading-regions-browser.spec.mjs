import { test, expect } from '@playwright/test';

test('real shell stays interactive while the editor module is still downloading', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/packages/editor/src/MarkdownEditor.vue*', async route => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto('http://127.0.0.1:43845/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.markdown-editor-skeleton')).toBeVisible();
    await expect(page.locator('.tree-row').first()).toBeVisible();
    await expect(page.locator('#tano-first-paint')).toHaveCount(0);
    const menu = page.getByRole('button', { name: '文档操作', exact: true });
    const mountedControl = await menu.elementHandle();
    await menu.click();
    await expect(page.locator('.document-dropdown')).toBeVisible();
    release();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    expect(await mountedControl.evaluate(element => element.isConnected)).toBe(true);
    await expect(page.locator('.document-dropdown')).toBeVisible();
    await expect(page.locator('.markdown-editor-skeleton')).toHaveCount(0);
  } finally { release(); }
});


for (const desktopTabs of [false, true]) {
test(`workspace recovery retains chrome and content origin (desktop tabs: ${desktopTabs})`, async ({ page }) => {
  // Exercise desktop layout with browser storage, without emulating native IPC.
  if (desktopTabs) await page.route('**/packages/workbench/src/App.vue', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;');
    await route.fulfill({ response, body });
  });
  await page.route('**/src/start.ts', async route => {
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace(/createMarkdownDemo\(markdownDemoLocaleFromPath\(window.location.pathname\) \?\? ["']zh-cn["']\)/, 'createMarkdownDemo("zh-cn", { "test.md": "正文测试" })');
    body = body.replace('const app =', `const originalOpen = storage.adapter.open.bind(storage.adapter);
      storage.adapter.open = async (...args) => {
        await new Promise(resolve => { window.releaseWorkspace = resolve; });
        return originalOpen(...args);
      };
      const app =`);
    await route.fulfill({ response, body });
  });
  let releaseEditor;
  const pending = new Promise(resolve => { releaseEditor = resolve; });
  await page.route('**/packages/editor/src/MarkdownEditor.vue*', async route => {
    await pending; await route.continue();
  });
  try {
    await page.goto('http://127.0.0.1:43845/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.breadcrumb-loading')).toBeVisible();
    if (desktopTabs) await expect(page.locator('.desktop-tabs-loading')).toBeVisible();
    const rail = desktopTabs ? await page.locator('.workspace-tabbar').elementHandle() : null;
    const header = await page.locator('.workspace-page-content > header').elementHandle();
    const before = await page.locator('.workspace-page-content > header').boundingBox();
    const origin = await page.locator('.workspace-no-tabs .editor-scroll').boundingBox();
    const titleBefore = await page.locator('.document-title-loading').boundingBox();
    const bodyBefore = await page.locator('.document-loading .skeleton-first-block').boundingBox();
    await page.evaluate(() => window.releaseWorkspace());
    await expect(page.locator('.markdown-editor-skeleton')).toBeVisible();
    await expect(page.locator('.breadcrumb-loading')).toHaveCount(0);
    expect(await header.evaluate(element => element.isConnected)).toBe(true);
    if (rail) {
      expect(await rail.evaluate(element => element.isConnected)).toBe(true);
      await expect(page.locator('.desktop-tabs-loading')).toHaveCount(0);
    }
    const after = await page.locator('.workspace-page-content > header').boundingBox();
    expect(after.y).toBe(before.y);
    expect(after.height).toBe(before.height);
    const content = await page.locator('.document-main > .editor-scroll').boundingBox();
    expect(content.y).toBe(origin.y);
    releaseEditor();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    const titleAfter = await page.locator('textarea.document-title-input').boundingBox();
    const bodyAfter = await page.locator('.ProseMirror > :first-child').boundingBox();
    expect(titleAfter.x).toBeCloseTo(titleBefore.x, 0);
    expect(titleAfter.y).toBeCloseTo(titleBefore.y, 0);
    expect(titleAfter.height).toBeCloseTo(titleBefore.height, 0);
    expect(bodyAfter.x).toBeCloseTo(bodyBefore.x, 0);
    expect(bodyAfter.y).toBeCloseTo(bodyBefore.y, 0);
  } finally { releaseEditor(); }
});

}
