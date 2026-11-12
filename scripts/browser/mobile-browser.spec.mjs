import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:43845';
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin);
  await expect(page).toHaveTitle(/Tano.*Markdown/);
  await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('.workspace-tabbar, .desktop-tabs')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新标签页', exact: true })).toHaveCount(0);
  return errors;
}
async function assertFits(page) {
  const bounds = await page.locator('.app-shell').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
}
async function longPressFile(page, row) {
  await row.scrollIntoViewIfNeeded();
  const rect = await row.boundingBox();
  const input = await page.context().newCDPSession(page);
  try {
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + 60, y: rect.y + rect.height / 2 }] });
    await expect(page.getByRole('menuitem', { name: /重命名/ })).toBeVisible();
  } finally {
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await input.detach();
  }
}

test('phone drawer, touch file actions, focus and outline work without covering the editor on load', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('.inspector-outline')).toHaveCount(0);
  const toggle = page.getByRole('button', { name: '展开侧栏', exact: true });
  await toggle.tap();
  const drawer = page.getByRole('dialog', { name: '工作区侧栏' });
  await expect(drawer).toBeVisible();
  expect(await page.locator('.main-column').evaluate(e => e.inert)).toBe(true);
  await expect(page.locator('.tree-entry-menu')).toHaveCount(0);
  await longPressFile(page, drawer.locator('.tree-row[title="01-基础块与行内.md"]'));
  await expect(page.getByRole('menuitem', { name: /重命名/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '在新标签页中打开', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();
  await drawer.locator('.tree-row[title="01-基础块与行内.md"]').tap();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: '切换文件：01-基础块与行内.md', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '文档大纲', exact: true }).tap();
  await expect(page.locator('.inspector-outline')).toBeVisible();
  await page.getByRole('button', { name: '关闭文档大纲', exact: true }).tap();
  await expect(page.locator('.inspector-outline')).toHaveCount(0);
  await toggle.tap();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await assertFits(page);
  expect(errors).toEqual([]);
});

test('phones and wide tablets keep one page without exposing restored desktop tabs or panes', async ({ page }) => {
  const errors = await open(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('html')).toHaveClass(/compact-layout/);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '工作区侧栏' })).toBeVisible();
  await page.locator('.sidebar-dismiss').tap({ position: { x: 820, y: 180 } });
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.locator('html')).not.toHaveClass(/compact-layout/);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const first = store.activeId;
    await store.openFileInNewTab(store.workspace.files.find(file => file.path === '01-基础块与行内.md'));
    store.dockTab(store.activeId, { paneId: store.activePaneId, side: 'right' });
    window.mobileLayoutFixture = { first, layout: JSON.stringify(store.layout) };
  });
  await expect(page.locator('.workspace-pane')).toHaveCount(1);
  await expect(page.locator('.workspace-tabbar, .pane-divider')).toHaveCount(0);
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('html')).toHaveClass(/compact-layout/);
  await expect(page.locator('.workspace-pane')).toHaveCount(1);
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.locator('.workspace-pane')).toHaveCount(1);
  await expect(page.locator('.workspace-tabbar, .pane-divider')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '切换文件：01-基础块与行内.md', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').layout))).toBe(await page.evaluate(() => window.mobileLayoutFixture.layout));
  await assertFits(page);
  expect(errors).toEqual([]);
});

test('keyboard viewport and safe areas keep settings reachable without changing pinch zoom', async ({ page }) => {
  await page.addInitScript(() => {
    const visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: visual });
  });
  const errors = await open(page);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).tap();
  await page.getByRole('button', { name: /^切换上下文：/ }).tap();
  await page.getByRole('button', { name: '设置', exact: true }).tap();
  await expect(page.locator('.settings-dialog')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-top', '47px');
    document.documentElement.style.setProperty('--app-safe-bottom', '34px');
    Object.assign(window.visualViewport, { height: 390, offsetTop: 32 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await page.locator('.app-shell').boundingBox()).height).toBe(390);
  const dialog = await page.locator('.settings-dialog').boundingBox();
  expect(dialog.y).toBeGreaterThanOrEqual(79);
  expect(dialog.y + dialog.height).toBeLessThanOrEqual(388);
  await expect(page.locator('.settings-close')).toBeVisible();
  await page.locator('.settings-search input').fill('外观');
  await page.evaluate(() => {
    Object.assign(window.visualViewport, { height: 195, scale: 2 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await page.locator('.app-shell').boundingBox()).height).toBe(390);
  await page.locator('.settings-close').tap();
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('small phones can edit and reload a saved document', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const errors = await open(page);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('移动端编辑.md', false, '# 手机写作\n\n保存之前\n');
  });
  await page.getByRole('button', { name: '切换源码模式', exact: true }).tap();
  const editor = page.getByRole('textbox', { name: 'Markdown 源码', exact: true });
  await editor.fill('# 手机写作\n\n手机和平板保存测试\n');
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').flush());
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toContainText('手机和平板保存测试');
  await assertFits(page);
  expect(errors).toEqual([]);
});

test('Android back closes surfaces before navigating or backgrounding', async ({ page }) => {
  const errors = await open(page);
  const back = () => page.evaluate(() => window.dispatchEvent(new Event('tano:back', { cancelable: true })));
  await page.getByRole('button', { name: '展开侧栏', exact: true }).tap();
  expect(await back()).toBe(false);
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: '文档大纲', exact: true }).tap();
  expect(await back()).toBe(false);
  await expect(page.locator('.inspector-outline')).toHaveCount(0);
  expect(await back()).toBe(true);
  expect(errors).toEqual([]);
});

test('a floating assistant fits the phone after a tablet drag', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const errors = await open(page);
  await page.evaluate(() => {
    const assistant = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('assistant');
    assistant.setDisplayMode('floating');
    assistant.opened = true;
  });
  const heading = page.locator('.assistant-panel-floating .assistant-heading');
  await expect(heading).toBeVisible();
  const rect = await heading.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 - 100, rect.y + rect.height / 2 + 40);
  await page.mouse.up();
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.locator('.assistant-panel-floating');
  await expect.poll(async () => Math.round((await panel.boundingBox()).width)).toBe(390);
  await expect.poll(async () => Math.round((await panel.boundingBox()).height)).toBe(844);
  await panel.getByRole('button', { name: '收起助手', exact: true }).tap();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('desktop keeps its sidebar and mouse layout', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });
  const page = await context.newPage();
  const errors = await open(page);
  await expect(page.locator('html')).not.toHaveClass(/touch-layout|compact-layout/);
  await expect(page.getByRole('complementary', { name: '工作区侧栏' })).toBeVisible();
  await expect(page.locator('.tree-entry-menu')).toHaveCount(0);
  await assertFits(page);
  expect(errors).toEqual([]);
  await context.close();
});
