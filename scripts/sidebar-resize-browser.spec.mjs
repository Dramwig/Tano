import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:43845';
test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    if (!localStorage.getItem('tano.preference.sidebarWidth'))
      localStorage.setItem('tano.preference.sidebarWidth', '300');
  });
  await page.goto(origin);
  await expect(page).toHaveTitle(/Tano.*Markdown/);
  await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeVisible();
  return errors;
}

async function startDrag(page) {
  const bounds = await page.getByRole('separator', { name: '调整侧栏宽度' }).boundingBox();
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-resizing/);
  return width => page.mouse.move(point.x + width - 300, point.y, { steps: 8 });
}

async function expectWidth(page, width) {
  await expect.poll(async () => (await page.locator('.sidebar').boundingBox())?.width).toBe(width);
}

test('the resize edge stays above the editor toolbar and can be dragged there', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('tano.preference.toolbarMode', 'fixed'));
  const errors = await open(page);
  const handle = page.getByRole('separator', { name: '调整侧栏宽度' });
  const bounds = await handle.boundingBox();
  const toolbar = await page.locator('.editor-toolbar').first().boundingBox();
  const point = { x: bounds.x + bounds.width / 2 + 0.5, y: toolbar.y + toolbar.height / 2 };
  await page.mouse.move(point.x, point.y);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('sidebar-resize-handle'), point)).toBe(true);
  expect(await handle.evaluate(element => getComputedStyle(element, '::after').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: testInfo.outputPath('sidebar-edge-hover.png') });
  await page.mouse.down();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-resizing/);
  await page.mouse.move(point.x + 50, point.y, { steps: 8 });
  await page.mouse.up();
  await expectWidth(page, 350);
  expect(errors).toEqual([]);
});

test('dragging beyond the minimum snaps closed and the opener restores the starting width', async ({ page }) => {
  const errors = await open(page);
  const dragTo = await startDrag(page);
  await dragTo(240);
  await expectWidth(page, 240);
  await dragTo(160);
  await expectWidth(page, 180);
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-hidden/);
  await dragTo(140);
  await expectWidth(page, 180);
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-hidden/);
  await dragTo(101);
  await expectWidth(page, 180);
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-hidden/);
  await dragTo(100);
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect.poll(async () => (await page.locator('.main-column').boundingBox()).x).toBe(0);
  await page.mouse.up();
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-resizing/);
  expect(await page.evaluate(() => localStorage.getItem('tano.preference.sidebarWidth'))).toBe('300');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expectWidth(page, 300);
  await page.mouse.move(400, 400);
  await expectWidth(page, 300);
  expect(errors).toEqual([]);
});

test('a captured drag can reverse out of the snap without flickering at the threshold', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = await open(page);
  const dragTo = await startDrag(page);
  await dragTo(90);
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-hidden/);
  await dragTo(160);
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-hidden/);
  await dragTo(200);
  await expectWidth(page, 200);
  await dragTo(350);
  await expectWidth(page, 350);
  await page.mouse.up();
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-resizing/);
  expect(await page.evaluate(() => localStorage.getItem('tano.preference.sidebarWidth'))).toBe('350');
  await page.reload();
  await expectWidth(page, 350);
  expect(errors).toEqual([]);
});

test('keyboard minimum and maximum sizing and pointer cancellation leave resizing usable', async ({ page }) => {
  const errors = await open(page);
  const handle = page.getByRole('separator', { name: '调整侧栏宽度' });
  await handle.focus();
  await page.keyboard.press('Home');
  await expectWidth(page, 180);
  await page.keyboard.press('ArrowLeft');
  await expectWidth(page, 180);
  await page.keyboard.press('End');
  await expectWidth(page, 480);
  await page.keyboard.press('ArrowRight');
  await expectWidth(page, 480);
  await page.keyboard.press('ArrowLeft');
  await expectWidth(page, 470);
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(350, 400);
  await page.locator('.app-shell').dispatchEvent('pointercancel', { pointerId: 1 });
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-resizing/);
  const width = (await page.locator('.sidebar').boundingBox()).width;
  await page.mouse.move(100, 400);
  await page.mouse.up();
  await expectWidth(page, width);
  expect(errors).toEqual([]);
});
