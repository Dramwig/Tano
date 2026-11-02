import { test, expect } from '@playwright/test';

test('tab snap preview moves neighbors without committing and restores on Escape', async ({ page }) => {
  // Expose the desktop tab strip in the browser demo; use its real store and pointer flow.
  await page.route('**/App.vue', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;');
    await route.fulfill({ response, body });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.desktop-tab').first()).toBeVisible();
  await page.locator('.desktop-tab-add').first().click();
  await page.locator('.desktop-tab-add').first().click();
  const tabs = page.locator('.desktop-tab');
  const ids = await tabs.evaluateAll(nodes => nodes.map(node => node.dataset.id));
  expect(ids.length).toBeGreaterThanOrEqual(3);
  expect(await tabs.first().evaluate(node => {
    const style = getComputedStyle(node, '::before');
    return { width: style.borderRightWidth, style: style.borderRightStyle, color: style.borderRightColor };
  })).toMatchObject({ width: '1px', style: 'solid' });
  expect(await tabs.first().evaluate(node => getComputedStyle(node, '::before').borderRightColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect.poll(() => page.locator('.desktop-tab-strip').first().evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  const first = await tabs.first().boundingBox();
  const last = await tabs.last().boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + 12);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 8, last.y + 12, { steps: 10 });
  await expect(tabs.first()).toHaveClass(/desktop-tab-dragging/);
  await page.mouse.move(last.x + last.width - 8, last.y + 24);
  await expect.poll(() => page.locator('.desktop-tab-drag-preview').evaluate(node => node.getBoundingClientRect().top)).toBe(first.y);
  await expect.poll(() => tabs.nth(1).evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41)).toBeLessThan(-20);
  await expect.poll(() => tabs.nth(1).evaluate(node => Math.round(new DOMMatrix(getComputedStyle(node).transform).m41))).toBe(-Math.round(first.width));
  await expect.poll(() => tabs.evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').length)).toBe(0);
  const positions = await tabs.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
  await page.waitForTimeout(250);
  const settled = await tabs.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
  settled.forEach((x, i) => expect(Math.abs(x - positions[i])).toBeLessThan(2));
  expect(await tabs.evaluateAll(nodes => nodes.map(node => node.dataset.id))).toEqual(ids);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.desktop-tab-drag-preview')).toHaveCount(0);
  expect(await tabs.evaluateAll(nodes => nodes.map(node => node.dataset.id))).toEqual(ids);
  await page.mouse.move(first.x + first.width / 2, first.y + 12);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 8, last.y + 12, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => tabs.last().getAttribute('data-id')).toBe(ids[0]);
});

test('native tab drag stays alive through snapping and hands an outside release to detach', async ({ page }) => {
  await page.route('**/App.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.route('**/DesktopTabs.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(/const nativeTabDrag = [^;]+;/, 'const nativeTabDrag = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.desktop-tab').first()).toBeVisible();
  await page.locator('.desktop-tab-add').first().click();
  await page.evaluate(() => {
    window.__dragEnds = 0;
    window.__detached = [];
    const setDragImage = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function(image, x, y) {
      window.__dragImage = image instanceof HTMLCanvasElement ? {
        bitmap: true, width: image.width, height: image.height,
        alpha: image.getContext('2d').getImageData(0, 0, 1, 1).data[3], x, y,
      } : { bitmap: false };
      return setDragImage.call(this, image, x, y);
    };
    window.addEventListener('dragend', () => window.__dragEnds++);
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      invoke: async (command, args) => {
        if (command === 'tab_drag_release') {
          window.__nativePreview = args.preview;
          return new Promise(resolve => { window.__releaseNativeDrag = resolve; });
        }
        if (command.endsWith('cursor_position')) return { x: 1500, y: 1000 };
        if (command.endsWith('inner_position')) return { x: 0, y: 0 };
        if (command.endsWith('scale_factor')) return 1;
      },
    };
    const component = document.querySelector('.desktop-tab-strip').__vueParentComponent;
    const emit = component.emit;
    component.emit = (event, ...args) => {
      if (event === 'detach-tab') window.__detached.push(args.slice(0, 2));
      else emit(event, ...args);
    };
  });
  const tabs = page.locator('.desktop-tab');
  await expect.poll(() => page.locator('.desktop-tab-strip').first().evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  const first = await tabs.first().boundingBox();
  const last = await tabs.last().boundingBox();
  await page.mouse.move(first.x + 50, first.y + 12);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + 12, { steps: 15 });
  await expect(tabs.first()).toHaveClass(/desktop-tab-dragging/);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__dragImage)).toMatchObject({
    bitmap: true, width: 1, height: 1, alpha: 0,
  });
  expect(await page.evaluate(() => {
    const preview = window.__nativePreview;
    return !!preview && atob(preview.rgba).length === preview.width * preview.height * 4;
  })).toBe(true);
  expect(await page.evaluate(() => window.__dragEnds)).toBe(0);
  await expect(tabs.first().locator('.desktop-tab-switch')).toBeVisible();
  await expect(page.locator('.desktop-tab-drag-preview')).toBeVisible();
  expect(await tabs.first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('.desktop-tab-drag-preview').evaluate(node => getComputedStyle(node).boxShadow)).toBe('none');
  const close = tabs.first().locator('.desktop-tab-close');
  await expect(close).toBeHidden();
  expect(await close.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  // Native cursor coordinates model an OS-level release beyond the WebView.
  await page.mouse.move(1100, 80, { steps: 5 });
  await page.mouse.move(1101, 80);
  await page.mouse.move(1100, 80);
  await expect(page.locator('.desktop-tab-drag-preview')).toBeVisible();
  await expect.poll(() => page.locator('.desktop-tab-drag-preview').evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.left < 1100 && box.right > 1100 && box.top < 80 && box.bottom > 80;
  })).toBe(true);
  await page.mouse.up();
  await page.evaluate(() => window.__releaseNativeDrag({ x: 1500, y: 1000 }));
  await expect.poll(() => page.evaluate(() => window.__detached.length)).toBe(1);
  expect(await page.evaluate(() => window.__detached[0][1])).toMatchObject({ x: 1500, y: 1000, insideSourceWindow: false });
});

test('tab widths animate when adding a tab to a full strip', async ({ page }) => {
  await page.route('**/App.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.desktop-tab').first()).toBeVisible();
  for (let index = 0; index < 6; index++) await page.locator('.desktop-tab-add').first().click();
  await expect.poll(() => page.locator('.desktop-tab').first().evaluate(node => node.getAnimations().length)).toBe(0);
  const widths = await page.evaluate(async () => {
    const tab = document.querySelector('.desktop-tab');
    const before = tab.getBoundingClientRect().width;
    document.querySelector('.desktop-tab-add').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const during = tab.getBoundingClientRect().width;
    await new Promise(resolve => setTimeout(resolve, 250));
    return { before, during, after: tab.getBoundingClientRect().width };
  });
  expect(widths.during).toBeLessThan(widths.before);
  expect(widths.during).toBeGreaterThan(widths.after + 0.1);
});
