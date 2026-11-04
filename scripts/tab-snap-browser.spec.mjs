import { test, expect } from '@playwright/test';

for (const [count, mode] of [[5, 'pointer'], [9, 'pointer'], [9, 'external'], [9, 'reduce']]) test(`closing a middle tab moves only the right neighbors (${count} tabs, ${mode})`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.emulateMedia({ reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference' });
  await page.route('**/App.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  const strip = page.locator('.desktop-tab-strip').first();
  await expect(strip.locator('.desktop-tab').first()).toBeVisible();
  await page.evaluate(count => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    for (let index = 1; index < count; index++) store.createBlankTab();
  }, count);
  await expect(strip.locator('.desktop-tab')).toHaveCount(count);
  if (mode === 'external') await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    store.activeId = store.tabs[2].id;
  });
  await expect.poll(() => strip.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  const close = await strip.locator('.desktop-tab').nth(2).locator('.desktop-tab-close').boundingBox();
  if (mode !== 'external') await page.mouse.move(close.x + close.width / 2, close.y + close.height / 2);
  const result = await strip.evaluate(async (strip, mode) => {
    const tabs = [...strip.querySelectorAll('.desktop-tab')];
    const before = tabs.map(tab => ({ x: tab.getBoundingClientRect().x, width: tab.getBoundingClientRect().width }));
    if (mode === 'external') {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      void store.close(tabs[2].dataset.id);
    } else tabs[2].querySelector('.desktop-tab-close').click();
    const samples = [];
    const clipped = [];
    // Closing the active tab may mount an editor before the first animation frame.
    await new Promise(requestAnimationFrame);
    const start = performance.now();
    while (performance.now() - start < 350) {
      await new Promise(requestAnimationFrame);
      samples.push(tabs.filter((_, index) => index !== 2).map(tab => ({
        x: tab.getBoundingClientRect().x, width: tab.getBoundingClientRect().width,
      })));
      clipped.push(tabs.at(-1).getBoundingClientRect().right - strip.querySelector('.desktop-tab-list').getBoundingClientRect().right);
    }
    return { before: before.filter((_, index) => index !== 2), removedWidth: before[2].width, samples, clipped: Math.max(...clipped) };
  }, mode);
  expect(result.clipped).toBeLessThan(0.2);
  const final = result.samples.at(-1);
  for (let index = 0; index < final.length; index++) {
    const before = result.before[index];
    const target = before.x - (index < 2 ? 0 : result.removedWidth);
    expect(Math.abs(final[index].x - target)).toBeLessThan(0.2);
    for (const [frame, sample] of result.samples.entries()) {
      expect(Math.abs(sample[index].width - before.width)).toBeLessThan(0.2);
      if (index < 2) expect(Math.abs(sample[index].x - before.x)).toBeLessThan(0.2);
      else expect(sample[index].x).toBeLessThanOrEqual((result.samples[frame - 1]?.[index].x ?? before.x) + 0.2);
    }
    if (index >= 2 && mode !== 'reduce') expect(result.samples.some(sample => sample[index].x > target + 1 && sample[index].x < before.x - 1)).toBe(true);
  }
});

test('rapid middle-tab closes continue from the current positions', async ({ page }) => {
  await page.route('**/App.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  const strip = page.locator('.desktop-tab-strip').first();
  await expect(strip.locator('.desktop-tab').first()).toBeVisible();
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    for (let index = 1; index < 9; index++) store.createBlankTab();
  });
  await expect.poll(() => strip.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  const close = await strip.locator('.desktop-tab').nth(2).locator('.desktop-tab-close').boundingBox();
  await page.mouse.move(close.x + close.width / 2, close.y + close.height / 2);
  const result = await strip.evaluate(async strip => {
    const tabs = [...strip.querySelectorAll('.desktop-tab')];
    const before = tabs.map(tab => tab.getBoundingClientRect().x);
    const width = tabs[2].getBoundingClientRect().width;
    tabs[2].querySelector('.desktop-tab-close').click();
    await new Promise(requestAnimationFrame);
    const intermediate = tabs.at(-1).getBoundingClientRect().x;
    tabs[3].querySelector('.desktop-tab-close').click();
    const samples = [];
    const start = performance.now();
    while (performance.now() - start < 350) {
      await new Promise(requestAnimationFrame);
      samples.push(tabs.filter((_, index) => index !== 2 && index !== 3).map(tab => tab.getBoundingClientRect().x));
    }
    return { before, width, intermediate, samples, transforms: [...strip.querySelectorAll('.desktop-tab')].map(tab => tab.style.transform) };
  });
  expect(result.intermediate).toBeGreaterThan(result.before.at(-1) - result.width);
  for (const [index, sample] of result.samples.entries()) {
    expect(Math.abs(sample[0] - result.before[0])).toBeLessThan(0.2);
    expect(Math.abs(sample[1] - result.before[1])).toBeLessThan(0.2);
    expect(sample.at(-1)).toBeLessThanOrEqual((result.samples[index - 1]?.at(-1) ?? result.intermediate) + 0.2);
  }
  expect(Math.abs(result.samples.at(-1).at(-1) - (result.before.at(-1) - 2 * result.width))).toBeLessThan(0.2);
  expect(result.transforms.every(value => !value)).toBe(true);
  // Pointer exit must release the pinned widths even after an interrupted move.
  await page.mouse.move(10, 500);
  await expect.poll(() => strip.locator('.desktop-tab-list').getAttribute('class')).not.toContain('desktop-tab-list-frozen');
});

for (const reducedMotion of ['no-preference', 'reduce']) test(`appending a tab leaves existing tabs still (${reducedMotion})`, async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 940 });
  await page.emulateMedia({ reducedMotion });
  await page.route('**/App.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  const strip = page.locator('.desktop-tab-strip').first();
  await expect(strip.locator('.desktop-tab').first()).toBeVisible();
  await strip.locator('.desktop-tab-add').click();
  await expect.poll(() => strip.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  const result = await strip.evaluate(async strip => {
    const tabs = [...strip.querySelectorAll('.desktop-tab')];
    const before = tabs.map(tab => tab.getBoundingClientRect());
    const samples = [];
    const opacity = [];
    const entryWidths = [];
    const stripWidths = [];
    strip.querySelector('.desktop-tab-add').click();
    const start = performance.now();
    while (performance.now() - start < 350) {
      await new Promise(requestAnimationFrame);
      opacity.push(Number(getComputedStyle(strip.querySelector('.desktop-tab:last-child')).opacity));
      entryWidths.push(strip.querySelector('.desktop-tab:last-child').getBoundingClientRect().width);
      stripWidths.push(strip.getBoundingClientRect().width);
      samples.push(tabs.map(tab => {
        const box = tab.getBoundingClientRect();
        return { x: box.x, width: box.width };
      }));
    }
    return {
      count: strip.querySelectorAll('.desktop-tab').length,
      preserved: tabs.every((tab, index) => tab === strip.querySelectorAll('.desktop-tab')[index]),
      minOpacity: Math.min(...opacity),
      finalOpacity: opacity.at(-1),
      remainingAnimations: strip.getAnimations({ subtree: true }).length,
      entryWidths,
      stripWidths,
      drift: Math.max(...samples.flatMap(sample => sample.flatMap((box, index) => [
        Math.abs(box.x - before[index].x), Math.abs(box.width - before[index].width),
      ]))),
    };
  });
  expect(result.count).toBe(3);
  expect(result.preserved).toBe(true);
  expect(result.drift).toBeLessThan(0.1);
  expect(result.finalOpacity).toBe(1);
  expect(result.remainingAnimations).toBe(0);
  if (reducedMotion === 'reduce') {
    expect(result.minOpacity).toBe(1);
    expect(Math.min(...result.entryWidths)).toBe(result.entryWidths.at(-1));
  } else {
    expect(result.minOpacity).toBeLessThan(1);
    expect(Math.min(...result.entryWidths)).toBeLessThan(result.entryWidths.at(-1) - 1);
    expect(Math.min(...result.stripWidths)).toBeLessThan(result.stripWidths.at(-1) - 1);
    for (let index = 1; index < result.entryWidths.length; index++) {
      expect(result.entryWidths[index]).toBeGreaterThanOrEqual(result.entryWidths[index - 1] - 0.2);
      expect(result.stripWidths[index]).toBeGreaterThanOrEqual(result.stripWidths[index - 1] - 0.2);
    }
  }
});

test('new-tab expansion continues through rapid opens and an interrupted close', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 940 });
  await page.route('**/App.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  const strip = page.locator('.desktop-tab-strip').first();
  await expect(strip.locator('.desktop-tab').first()).toBeVisible();
  await strip.locator('.desktop-tab-add').click();
  await expect.poll(() => strip.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  const result = await strip.evaluate(async strip => {
    const original = [...strip.querySelectorAll('.desktop-tab')];
    const before = original.map(tab => tab.getBoundingClientRect());
    const add = () => strip.querySelector('.desktop-tab-add').click();
    add();
    await new Promise(requestAnimationFrame);
    const expanding = strip.querySelector('.desktop-tab:last-child');
    const widths = [expanding.getBoundingClientRect().width];
    add();
    await new Promise(requestAnimationFrame);
    widths.push(expanding.getBoundingClientRect().width);
    strip.querySelector('.desktop-tab:last-child .desktop-tab-close').click();
    await new Promise(requestAnimationFrame);
    widths.push(expanding.getBoundingClientRect().width);
    add();
    const drift = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise(requestAnimationFrame);
      widths.push(expanding.getBoundingClientRect().width);
      drift.push(...original.flatMap((tab, index) => {
        const box = tab.getBoundingClientRect();
        return [Math.abs(box.x - before[index].x), Math.abs(box.width - before[index].width)];
      }));
    }
    return {
      widths, drift: Math.max(...drift), count: strip.querySelectorAll('.desktop-tab').length,
      pinned: strip.querySelector('.desktop-tab-list').classList.contains('desktop-tab-list-frozen'),
      clipped: [...strip.querySelectorAll('.desktop-tab')].some(tab => !!tab.style.overflow),
    };
  });
  expect(result.count).toBe(4);
  expect(result.drift).toBeLessThan(0.1);
  expect(result.widths[0]).toBeLessThan(result.widths.at(-1) - 1);
  for (let index = 1; index < result.widths.length; index++) expect(result.widths[index]).toBeGreaterThanOrEqual(result.widths[index - 1] - 0.2);
  expect(result.pinned).toBe(false);
  expect(result.clipped).toBe(false);
});

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
    const list = tab.parentElement;
    const before = tab.getBoundingClientRect().width;
    const x = tab.getBoundingClientRect().x;
    document.querySelector('.desktop-tab-add').click();
    const samples = [];
    const start = performance.now();
    while (performance.now() - start < 350) {
      await new Promise(requestAnimationFrame);
      const box = tab.getBoundingClientRect();
      samples.push({ ms: performance.now() - start, width: box.width, x: box.x, scroll: list.scrollLeft });
    }
    return { before, x, samples, during: samples.find(sample => sample.ms >= 60).width, after: tab.getBoundingClientRect().width };
  });
  expect(widths.during).toBeLessThan(widths.before);
  expect(widths.during).toBeGreaterThan(widths.after + 0.1);
  for (const [index, sample] of widths.samples.entries()) {
    expect(sample.scroll).toBe(0);
    expect(Math.abs(sample.x - widths.x)).toBeLessThan(0.1);
    expect(sample.width).toBeLessThanOrEqual((widths.samples[index - 1]?.width ?? widths.before) + 0.1);
  }
});

test('overflow scroll follows the latest active tab after rapid additions', async ({ page }) => {
  await page.route('**/App.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  const strip = page.locator('.desktop-tab-strip').first();
  await expect(strip.locator('.desktop-tab').first()).toBeVisible();
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const first = store.activeId;
    for (let index = 0; index < 45; index++) store.createBlankTab();
    await new Promise(requestAnimationFrame);
    store.activeId = first;
  });
  await expect(strip.locator('.desktop-tab')).toHaveCount(46);
  await expect.poll(() => strip.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await strip.locator('.desktop-tab-list').evaluate(node => node.scrollLeft)).toBe(0);
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    store.activeId = store.tabs.at(-1).id;
  });
  await expect.poll(() => strip.locator('.desktop-tab-list').evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  const active = await strip.locator('.desktop-tab-active').boundingBox();
  const list = await strip.locator('.desktop-tab-list').boundingBox();
  expect(active.x + active.width).toBeLessThanOrEqual(list.x + list.width + 1);
});
