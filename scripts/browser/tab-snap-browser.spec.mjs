import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('tab activation waits for a completed click across panes and cancelled drags', async ({ page }) => {
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.desktop-tab').first()).toBeVisible();
  const ids = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    store.createBlankTab();
    const first = store.activeId;
    store.createBlankTab();
    return { first, second: store.activeId };
  });
  const activeId = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').activeId);
  const first = page.locator(`.desktop-tab[data-id="${ids.first}"] .desktop-tab-switch`);
  const second = page.locator(`.desktop-tab[data-id="${ids.second}"] .desktop-tab-switch`);
  await first.hover();
  await page.mouse.down();
  expect(await activeId()).toBe(ids.second);
  await page.mouse.up();
  await expect.poll(activeId).toBe(ids.first);

  await second.click();
  await first.hover();
  await page.mouse.down();
  await page.mouse.move(500, 350, { steps: 10 });
  await expect(page.locator('.desktop-tab-drag-preview')).toBeVisible();
  expect(await activeId()).toBe(ids.second);
  await page.mouse.up();
  await expect(page.locator('.desktop-tab-drag-preview')).toHaveCount(0);
  expect(await activeId()).toBe(ids.second);

  await first.hover();
  await page.mouse.down();
  await page.mouse.move(500, 350, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.desktop-tab-drag-preview')).toHaveCount(0);
  expect(await activeId()).toBe(ids.second);

  await page.evaluate(ids => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    store.dockTab(ids.second, { paneId: store.activePaneId, side: 'right' });
  }, ids);
  await first.hover();
  await page.mouse.down();
  expect(await activeId()).toBe(ids.second);
  await page.mouse.up();
  await expect.poll(activeId).toBe(ids.first);
});

for (const count of [0, 2, 10]) test(`incoming auxiliary tab reserves track space (${count} existing tabs)`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.route('**/DesktopTabs.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace(/const nativeTabDrag = [^;]+;/, 'const nativeTabDrag = true;').replace('detachable: !!props.detachable', 'detachable: true')
      .replace('const windowContext = useWindowContext();', 'const windowContext = { ...useWindowContext(), native: { listen: async () => () => {} } };') });
  });
  await page.goto('http://127.0.0.1:43845');
  const strip = page.locator('.desktop-tab-strip').first();
  await expect(strip).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').workspace?.id)).toBeTruthy();
  await page.evaluate(async count => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    for (const tab of [...store.tabs]) await store.close(tab.id);
    for (let index = 0; index < count; index++) store.createBlankTab();
    store.createBlankTab();
    window.__incomingTab = store.activeId;
    store.moveTabToAuxiliaryWindow(store.activeId, 'source');
    const metadata = { sourceLabel: 'aux-source', workspaceId: store.workspace.id, tabId: window.__incomingTab, width: 180, centerOffset: 0 };
    window.__incomingType = 'application/x-tano-tab-meta-' + [...new TextEncoder().encode(JSON.stringify(metadata))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
  }, count);
  await expect(strip.locator('.desktop-tab')).toHaveCount(count);
  await expect.poll(() => strip.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  const before = await strip.boundingBox();
  const hover = (middle = false) => strip.evaluate((node, middle) => {
    window.__trackMotion = [];
    const started = performance.now();
    const sample = () => {
      window.__trackMotion.push(node.getBoundingClientRect().width);
      if (performance.now() - started < 500) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const bar = node.closest('.workspace-tabbar');
    const tabs = [...node.querySelectorAll('.desktop-tab')];
    const last = tabs.at(-1)?.getBoundingClientRect();
    const bounds = node.getBoundingClientRect();
    const x = middle && tabs.length ? tabs[Math.floor(tabs.length / 2)].getBoundingClientRect().left + 2
      : last ? last.right - 2 : bounds.left + 5;
    window.__incomingPoint = { x, y: bounds.top + 18 };
    const transfer = new DataTransfer();
    transfer.setData(window.__incomingType, '');
    bar.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: bounds.top + 18, dataTransfer: transfer }));
  }, middle);
  await hover();
  await expect(strip.locator('.desktop-tab-incoming-slot')).toHaveCount(1);
  if (count < 10) await expect.poll(async () => (await strip.boundingBox()).width - before.width).toBeGreaterThan(170);
  if (count < 10) await expect.poll(() => page.evaluate(before => window.__trackMotion.some(width => width > before + 5 && width < before + 160), before.width)).toBe(true);
  await expect.poll(() => strip.evaluate(node => {
    const list = node.querySelector('.desktop-tab-list').getBoundingClientRect();
    const last = [...node.querySelectorAll('.desktop-tab')].at(-1);
    return list.right - (last?.getBoundingClientRect().right ?? list.left);
  })).toBeGreaterThan(170);
  await strip.evaluate(node => {
    window.__trackReturn = [];
    const started = performance.now();
    const sample = () => {
      window.__trackReturn.push(node.getBoundingClientRect().width);
      if (performance.now() - started < 650) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    node.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null }));
  });
  await expect(strip.locator('.desktop-tab-incoming-slot')).toHaveCount(0);
  await expect.poll(async () => Math.abs((await strip.boundingBox()).width - before.width)).toBeLessThan(1);
  if (count < 10) expect(await page.evaluate(before => window.__trackReturn.some(width => width > before + 5 && width < before + 160), before.width)).toBe(true);
  await expect.poll(() => strip.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  await hover(true);
  if (count) await expect.poll(() => strip.evaluate(node => {
    const tabs = [...node.querySelectorAll('.desktop-tab')];
    const index = Math.floor(tabs.length / 2);
    return tabs[index].getBoundingClientRect().left - tabs[index - 1].getBoundingClientRect().right;
  })).toBeGreaterThan(170);
  await strip.evaluate(node => {
    const transfer = new DataTransfer();
    transfer.setData(window.__incomingType, '');
    node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true,
      clientX: window.__incomingPoint.x, clientY: window.__incomingPoint.y, dataTransfer: transfer }));
  });
  await expect(strip.locator('.desktop-tab')).toHaveCount(count + 1);
  await expect(strip.locator('.desktop-tab-incoming-slot')).toHaveCount(0);
  expect(await strip.locator('.desktop-tab').nth(Math.floor(count / 2)).getAttribute('data-id')).toBe(await page.evaluate(() => window.__incomingTab));
  await expect.poll(() => strip.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  expect(await strip.evaluate(node => {
    const boxes = [...node.querySelectorAll('.desktop-tab')].map(tab => tab.getBoundingClientRect());
    return boxes.slice(1).every((box, index) => Math.abs(box.left - boxes[index].right) < 1);
  })).toBe(true);
});

for (const direction of ['auxiliary-to-main', 'main-to-auxiliary']) test(`active cross-window drag preserves target snapping (${direction})`, async ({ page }) => {
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.route('**/DesktopTabs.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace(/const nativeTabDrag = [^;]+;/, 'const nativeTabDrag = true;').replace('detachable: !!props.detachable', 'detachable: true')
      .replace('const windowContext = useWindowContext();', 'const windowContext = { ...useWindowContext(), native: { listen: async () => () => {} } };') });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.desktop-tab').first()).toBeVisible();
  const result = await page.evaluate(async direction => {
    const component = document.querySelector('.desktop-tab-strip').__vueParentComponent;
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const moduleUrl = performance.getEntriesByType('resource').find(entry => /\/DesktopTabs\.vue(?:\?|$)/.test(entry.name)).name;
    const source = await (await fetch(moduleUrl)).text();
    const vueUrl = source.match(/from\s+["']([^"']*\/vue\.js[^"']*)["']/)[1];
    const contextUrl = source.match(/from\s+["']([^"']*\/windows\/context\.ts[^"']*)["']/)[1];
    const { h, render, nextTick, provide } = await import(vueUrl);
    const { windowContextKey } = await import(contextUrl);
    store.createBlankTab();
    store.createBlankTab();
    store.moveTabToAuxiliaryWindow(store.activeId, 'drag-test');
    const paneId = store.windowLayouts['drag-test'].activePaneId;
    const popup = window.open('about:blank', '_blank', 'width=900,height=700');
    for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) popup.document.head.append(style.cloneNode(true));
    const mount = popup.document.createElement('div');
    popup.document.body.append(mount);
    const context = { id: 'drag-test', label: 'aux-drag-test', window: popup, document: popup.document, overlays: popup.document.body };
    const vnode = h({ setup() {
      provide(windowContextKey, context);
      return () => h('div', { class: 'workspace-tabbar', 'data-tab-pane-id': paneId, style: 'height:36px' },
        [h(component.type, { paneId, detachable: true })]);
    } });
    vnode.appContext = component.appContext;
    render(vnode, mount);
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 600));
    let releaseNative;
    window.__TAURI_INTERNALS__ = { invoke: async command => {
      if (command === 'tab_drag_release') return new Promise(resolve => { releaseNative = resolve; });
    } };
    const sourceWindow = direction === 'auxiliary-to-main' ? popup : window;
    const targetWindow = direction === 'auxiliary-to-main' ? window : popup;
    const button = sourceWindow.document.querySelector('.desktop-tab-switch');
    const sourceBox = button.getBoundingClientRect();
    const transfer = new DataTransfer();
    button.dispatchEvent(new sourceWindow.DragEvent('dragstart', { bubbles: true, cancelable: true,
      clientX: sourceBox.left + 40, clientY: sourceBox.top + 12, dataTransfer: transfer }));
    sourceWindow.dispatchEvent(new sourceWindow.DragEvent('dragleave', { relatedTarget: null }));
    const targetStrip = targetWindow.document.querySelector('.desktop-tab-strip');
    const targetBar = targetStrip.closest('.workspace-tabbar');
    const targetBox = targetStrip.getBoundingClientRect();
    const before = targetBox.width;
    targetBar.dispatchEvent(new targetWindow.DragEvent('dragover', { bubbles: true, cancelable: true,
      clientX: targetBox.left + 10, clientY: targetBox.top + 18, dataTransfer: transfer }));
    const samples = [];
    const started = targetWindow.performance.now();
    await new Promise(resolve => {
      const sample = () => {
        samples.push({ width: targetStrip.getBoundingClientRect().width, paneId: store.paneDrop?.paneId });
        if (targetWindow.performance.now() - started < 500) targetWindow.requestAnimationFrame(sample);
        else resolve();
      };
      targetWindow.requestAnimationFrame(sample);
    });
    const targetPaneId = targetBar.dataset.tabPaneId;
    targetBar.dispatchEvent(new targetWindow.DragEvent('drop', { bubbles: true, cancelable: true,
      clientX: targetBox.left + 70, clientY: targetBox.top + 30, dataTransfer: transfer }));
    // Moving the auxiliary window's last tab closes that source immediately.
    if (direction === 'auxiliary-to-main') { render(null, mount); popup.close(); }
    await nextTick();
    // The source observes the native release after the target has accepted it.
    releaseNative({ x: 0, y: 0, overSource: false });
    const landing = [];
    const released = targetWindow.performance.now();
    await new Promise(resolve => {
      const sample = () => {
        const preview = targetWindow.document.querySelector('.desktop-tab-drag-preview-settling');
        landing.push(preview ? { left: preview.getBoundingClientRect().left, top: preview.getBoundingClientRect().top } : null);
        if (targetWindow.performance.now() - released < 650) targetWindow.requestAnimationFrame(sample);
        else resolve();
      };
      targetWindow.requestAnimationFrame(sample);
    });
    if (direction === 'main-to-auxiliary') { render(null, mount); popup.close(); }
    return { before, samples, targetPaneId, landing };
  }, direction);
  expect(result.samples.some(sample => sample.width > result.before + 5 && sample.width < result.before + 180)).toBe(true);
  expect(result.samples.at(-1).width).toBeGreaterThan(result.before + 190);
  expect(result.samples.every(sample => sample.paneId === result.targetPaneId)).toBe(true);
  const landingFrames = result.landing.filter(Boolean);
  expect(landingFrames.length).toBeGreaterThan(2);
  expect(landingFrames.some(frame => Math.abs(frame.left - landingFrames[0].left) > 2 || Math.abs(frame.top - landingFrames[0].top) > 2)).toBe(true);
  expect(result.landing.at(-1)).toBeNull();
});

test('auxiliary window returns an invalid drag using its own animation clock', async ({ page }) => {
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.desktop-tab').first()).toBeVisible();
  // The popup starts later than the host, as it does in the desktop product.
  await page.waitForTimeout(1000);
  const result = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').find(entry => /\/DesktopTabs\.vue(?:\?|$)/.test(entry.name)).name;
    const source = await (await fetch(moduleUrl)).text();
    const vueUrl = source.match(/from\s+["']([^"']*\/vue\.js[^"']*)["']/)[1];
    const contextUrl = source.match(/from\s+["']([^"']*\/windows\/context\.ts[^"']*)["']/)[1];
    const { h, render, nextTick, provide } = await import(vueUrl);
    const { windowContextKey } = await import(contextUrl);
    const component = document.querySelector('.desktop-tab-strip').__vueParentComponent;
    const popup = window.open('about:blank', '_blank', 'width=900,height=700');
    for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) popup.document.head.append(style.cloneNode(true));
    const mount = popup.document.createElement('div');
    mount.style.height = '36px';
    popup.document.body.append(mount);
    const context = { id: 'animation-test', label: 'aux-animation-test', window: popup,
      document: popup.document, overlays: popup.document.body, native: undefined };
    const vnode = h({ setup() {
      provide(windowContextKey, context);
      return () => h(component.type, { paneId: component.props.paneId });
    } });
    vnode.appContext = component.appContext;
    render(vnode, mount);
    await nextTick();
    await new Promise(resolve => popup.requestAnimationFrame(resolve));
    const button = popup.document.querySelector('.desktop-tab-switch');
    button.setPointerCapture = () => {};
    const box = button.getBoundingClientRect();
    const pointer = (target, type, x, y) => target.dispatchEvent(new popup.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: y,
    }));
    pointer(button, 'pointerdown', box.left + 40, box.top + 12);
    pointer(button, 'pointermove', box.left + 140, 300);
    await nextTick();
    const draggedTop = popup.document.querySelector('.desktop-tab-drag-preview')?.getBoundingClientRect().top;
    pointer(button, 'pointercancel', box.left + 140, 300);
    await nextTick();
    const samples = [];
    const started = popup.performance.now();
    await new Promise(resolve => {
      const sample = () => {
        const preview = popup.document.querySelector('.desktop-tab-drag-preview');
        samples.push(preview?.getBoundingClientRect().top ?? null);
        if (popup.performance.now() - started < 650) popup.requestAnimationFrame(sample);
        else resolve();
      };
      popup.requestAnimationFrame(sample);
    });
    render(null, mount);
    popup.close();
    return { samples, draggedTop };
  });
  expect(result.draggedTop).toBeGreaterThan(270);
  expect(result.samples.some(top => top !== null && top > 20 && top < 270)).toBe(true);
  expect(result.samples.filter(top => top !== null).every(top => top >= 0 && top <= result.draggedTop + 1)).toBe(true);
  expect(result.samples.at(-1)).toBeNull();
});

for (const [count, mode] of [[5, 'pointer'], [9, 'pointer'], [9, 'external'], [9, 'reduce']]) test(`closing a middle tab moves only the right neighbors (${count} tabs, ${mode})`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.emulateMedia({ reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference' });
  await page.route('**/use-workbench.ts*', async route => {
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
    while (performance.now() - start < 650) {
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
    for (const sample of result.samples) {
      expect(Math.abs(sample[index].width - before.width)).toBeLessThan(0.2);
      if (index < 2) expect(Math.abs(sample[index].x - before.x)).toBeLessThan(0.2);
      else {
        // The existing snappy spring overshoots by about 4% before settling.
        // Keep the established motion while bounding its entire travel.
        expect(sample[index].x).toBeLessThanOrEqual(before.x + 0.2);
        expect(sample[index].x).toBeGreaterThanOrEqual(target - result.removedWidth * 0.045 - 0.2);
      }
    }
    if (index >= 2 && mode !== 'reduce') expect(result.samples.some(sample => sample[index].x > target + 1 && sample[index].x < before.x - 1)).toBe(true);
  }
});

test('rapid middle-tab closes continue from the current positions', async ({ page }) => {
  await page.route('**/use-workbench.ts*', async route => {
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
    while (performance.now() - start < 650) {
      await new Promise(requestAnimationFrame);
      samples.push(tabs.filter((_, index) => index !== 2 && index !== 3).map(tab => tab.getBoundingClientRect().x));
    }
    return { before, width, intermediate, samples, transforms: [...strip.querySelectorAll('.desktop-tab')].map(tab => tab.style.transform) };
  });
  expect(result.intermediate).toBeGreaterThan(result.before.at(-1) - result.width);
  for (const sample of result.samples) {
    expect(Math.abs(sample[0] - result.before[0])).toBeLessThan(0.2);
    expect(Math.abs(sample[1] - result.before[1])).toBeLessThan(0.2);
    expect(sample.at(-1)).toBeLessThanOrEqual(result.intermediate + 0.2);
    expect(sample.at(-1)).toBeGreaterThanOrEqual(result.before.at(-1) - result.width * 2.09 - 0.2);
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
  await page.route('**/use-workbench.ts*', async route => {
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
    while (performance.now() - start < 650) {
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
      expect(result.entryWidths[index]).toBeGreaterThanOrEqual(0);
      expect(result.entryWidths[index]).toBeLessThanOrEqual(result.entryWidths.at(-1) * 1.045 + 0.2);
      expect(result.stripWidths[index]).toBeGreaterThanOrEqual(result.stripWidths[0] - 0.2);
      expect(result.stripWidths[index]).toBeLessThanOrEqual(result.stripWidths.at(-1) * 1.045 + 0.2);
    }
  }
});

test('new-tab expansion continues through rapid opens and an interrupted close', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 940 });
  await page.route('**/use-workbench.ts*', async route => {
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
  await page.route('**/use-workbench.ts*', async route => {
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
  await expect.poll(() => page.locator('.desktop-tab-drag-preview').evaluate(node => node.getBoundingClientRect().top)).toBe(first.y + 12);
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
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.route('**/DesktopTabs.vue', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace(/const nativeTabDrag = [^;]+;/, 'const nativeTabDrag = true;').replace('detachable: !!props.detachable', 'detachable: true')
      .replace('const windowContext = useWindowContext();', `const windowContext = { ...useWindowContext(), native: {
        label: 'main', innerPosition: async () => ({ x: 0, y: 0 }), scaleFactor: async () => 1,
        listen: async () => () => {},
      } };`) });
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
          window.__nativeSourceLabel = args.windowLabel;
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
  expect(await page.evaluate(() => window.__nativeSourceLabel)).toBe('main');
  await expect(tabs.first().locator('.desktop-tab-switch')).toBeVisible();
  // The native bitmap owns the floating preview throughout this drag.
  await expect(page.locator('.desktop-tab-drag-preview')).toBeHidden();
  expect(await tabs.first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect.poll(() => page.locator('.desktop-tab-drag-preview').evaluate(node => getComputedStyle(node).boxShadow)).toContain('8px 22px');
  expect(await page.locator('.desktop-tab-drag-preview').evaluate(node => getComputedStyle(node).borderRadius)).toBe('8px');
  const close = tabs.first().locator('.desktop-tab-close');
  await expect(close).toBeHidden();
  expect(await close.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  // Native cursor coordinates model an OS-level release beyond the WebView.
  await page.mouse.move(1100, 80, { steps: 5 });
  await page.mouse.move(1101, 80);
  await page.mouse.move(1100, 80);
  // The native bitmap owns the floating preview throughout this drag.
  await expect(page.locator('.desktop-tab-drag-preview')).toBeHidden();
  await expect.poll(() => page.locator('.desktop-tab-drag-preview').evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.left < 1100 && box.right > 1100 && box.top < 80 && box.bottom > 80;
  })).toBe(true);
  await expect.poll(() => tabs.evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').length)).toBe(0);
  const positions = await page.evaluate(async () => {
    const neighbor = document.querySelectorAll('.desktop-tab')[1];
    const sample = () => neighbor.getBoundingClientRect().x;
    const record = async (event, duration = 450) => {
      const before = sample();
      window.dispatchEvent(event);
      const samples = [];
      const started = performance.now();
      while (performance.now() - started < duration) {
        await new Promise(requestAnimationFrame);
        samples.push(sample());
      }
      return { before, samples, after: sample() };
    };
    const leave = await record(new DragEvent('dragleave', { bubbles: true }));
    const enter = await record(new DragEvent('dragover', { bubbles: true, clientX: 1100, clientY: 80 }));
    const leaveAgain = await record(new DragEvent('dragleave', { bubbles: true }));
    const partialEnter = await record(new DragEvent('dragover', { bubbles: true, clientX: 1100, clientY: 80 }), 80);
    const reversed = await record(new DragEvent('dragleave', { bubbles: true }));
    return { leave, enter, leaveAgain, partialEnter, reversed };
  });
  for (const motion of [positions.leave, positions.enter, positions.leaveAgain]) {
    const lower = Math.min(motion.before, motion.after), upper = Math.max(motion.before, motion.after);
    expect(upper - lower).toBeGreaterThan(first.width - 1);
    expect(motion.samples.some(x => x > lower + 1 && x < upper - 1)).toBe(true);
  }
  expect(positions.enter.after).toBeCloseTo(positions.leave.before, 2);
  expect(positions.partialEnter.after).toBeGreaterThan(positions.leave.after + 1);
  expect(positions.partialEnter.after).toBeLessThan(positions.enter.after - 1);
  expect(positions.reversed.before).toBeCloseTo(positions.partialEnter.after, 2);
  expect(positions.reversed.samples.some(x => x > positions.reversed.after + 1 && x < positions.reversed.before - 1)).toBe(true);
  await expect(tabs.first()).toHaveClass(/desktop-tab-away/);
  expect((await tabs.first().boundingBox()).width).toBeCloseTo(first.width, 2);
  await expect.poll(() => tabs.nth(1).evaluate(node => node.getBoundingClientRect().x)).toBeCloseTo(first.x, 2);
  await page.mouse.up();
  await page.evaluate(() => window.__releaseNativeDrag({ x: 1500, y: 1000 }));
  await expect.poll(() => page.evaluate(() => window.__detached.length)).toBe(1);
  expect(await page.evaluate(() => window.__detached[0][1])).toMatchObject({ x: 1500, y: 1000, insideSourceWindow: false });
});

test('tab widths animate when adding a tab to a full strip', async ({ page }) => {
  await page.route('**/use-workbench.ts*', async route => {
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
    while (performance.now() - start < 650) {
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
  await page.route('**/use-workbench.ts*', async route => {
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

for (const theme of ['light', 'dark']) for (const layout of ['default', 'document'])
for (const active of [true, false]) for (const destination of ['return', 'end'])
test(`tab release hands off smoothly (${theme}, ${layout}, ${active ? 'active' : 'inactive'}, ${destination})`, async ({ page }) => {
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  const tab = destination === 'end' ? page.locator('.desktop-tab').first() : page.locator('.desktop-tab').last();
  await expect(tab).toBeVisible();
  await page.locator('.desktop-tab-add').first().click();
  if (destination === 'end') await page.locator('.desktop-tab-add').first().click();
  await expect.poll(() => page.locator('.desktop-tab-strip').first().evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.evaluate(({ layout, theme }) => {
    document.documentElement.dataset.layout = layout;
    document.documentElement.dataset.theme = theme;
  }, { layout, theme });
  if (active) await tab.locator('.desktop-tab-switch').click();
  else if (destination === 'return') await page.locator('.desktop-tab').first().locator('.desktop-tab-switch').click();
  const id = await tab.getAttribute('data-id');
  const source = await tab.boundingBox();
  await page.mouse.move(source.x + 60, source.y + 12);
  await page.mouse.down();
  const end = await page.locator('.desktop-tab').last().boundingBox();
  await page.mouse.move(destination === 'end' ? end.x + end.width - 4 : 500,
    destination === 'end' ? end.y + 12 : 300, { steps: 8 });
  await expect(tab).toHaveClass(/desktop-tab-dragging/);
  const before = await page.locator('.desktop-tab-drag-preview').boundingBox();
  const beforeColors = await page.locator('.desktop-tab-drag-preview').evaluate(node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color };
  });
  await page.mouse.up();
  const samples = await page.evaluate(async id => {
    const result = [];
    const tab = [...document.querySelectorAll('.desktop-tab')].find(node => node.dataset.id === id);
    const started = performance.now();
    while (performance.now() - started < 800) {
      const preview = document.querySelector('.desktop-tab-drag-preview');
      const style = getComputedStyle(tab);
      const previewStyle = preview && getComputedStyle(preview);
      const previewIcon = preview?.querySelector('.desktop-tab-icon')?.getBoundingClientRect();
      const tabIcon = tab.querySelector('.desktop-tab-icon')?.getBoundingClientRect();
      const previewLabel = preview?.querySelector('.desktop-tab-label')?.getBoundingClientRect();
      const tabLabel = tab.querySelector('.desktop-tab-label')?.getBoundingClientRect();
      result.push({ y: preview?.getBoundingClientRect().y, preview: !!preview,
        previewOpacity: preview ? Number(getComputedStyle(preview).opacity) : 0,
        tabOpacity: Number(style.opacity), background: style.backgroundColor, color: style.color,
        previewBackground: previewStyle?.backgroundColor, previewColor: previewStyle?.color,
        iconOffset: previewIcon && tabIcon ? Math.hypot(previewIcon.x - tabIcon.x, previewIcon.y - tabIcon.y) : 0,
        labelOffset: previewLabel && tabLabel ? Math.hypot(previewLabel.x - tabLabel.x, previewLabel.y - tabLabel.y) : 0 });
      await new Promise(requestAnimationFrame);
    }
    return result;
  }, id);
  if (destination === 'return') expect(samples.some(sample => sample.y > source.y + 1 && sample.y < before.y - 1)).toBe(true);
  else await expect(page.locator('.desktop-tab').last()).toHaveAttribute('data-id', id);
  const handoff = samples.filter(sample => sample.preview && sample.tabOpacity === 1);
  expect(handoff.length).toBeGreaterThan(0);
  if (!active && destination === 'return') {
    expect(samples.some(sample => sample.preview && sample.tabOpacity === 0 &&
      sample.previewBackground !== beforeColors.background && sample.previewBackground !== sample.background)).toBe(true);
    expect(samples.some(sample => sample.preview && sample.tabOpacity === 0 &&
      sample.previewColor !== beforeColors.color && sample.previewColor !== sample.color)).toBe(true);
  }
  for (const sample of handoff) {
    expect(sample.previewOpacity).toBe(0);
    expect(sample.previewBackground).toBe(sample.background);
    expect(sample.previewColor).toBe(sample.color);
    // A compositor-driven strip can advance a fraction of a pixel between reads.
    expect(sample.iconOffset).toBeLessThan(0.5);
    expect(sample.labelOffset).toBeLessThan(0.5);
  }
  for (const sample of samples) {
    // Source-over coverage, not the sum of two layers' opacity values.
    const coverage = sample.previewOpacity + sample.tabOpacity * (1 - sample.previewOpacity);
    expect(coverage).toBe(1);
    expect([sample.previewOpacity, sample.tabOpacity].sort()).toEqual([0, 1]);
  }
  const landed = samples.filter(sample => !sample.preview);
  expect(landed.length).toBeGreaterThan(1);
  expect(landed.every(sample => sample.tabOpacity === 1 && sample.background === landed.at(-1).background)).toBe(true);
  await expect(page.locator('.desktop-tab-drag-preview')).toHaveCount(0);
  await expect(tab).not.toHaveClass(/desktop-tab-dragging/);
  expect((await page.locator(`.desktop-tab[data-id="${id}"]`).boundingBox()).width).toBeCloseTo(source.width, 2);
});


for (const layout of ['default', 'document']) for (const active of [true, false])
test(`landed tab pixels stay stable when the preview is removed (${layout}, ${active})`, async ({ page }, testInfo) => {
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.desktop-tab').first()).toBeVisible();
  await page.locator('.desktop-tab-add').first().click();
  await page.evaluate(layout => { document.documentElement.dataset.layout = layout; }, layout);
  const tab = page.locator('.desktop-tab').last();
  if (!active) await page.locator('.desktop-tab').first().locator('.desktop-tab-switch').click();
  await tab.locator('.desktop-tab-switch').hover();
  await page.mouse.down();
  await page.mouse.move(500, 300, { steps: 8 });
  await expect(tab).toHaveClass(/desktop-tab-dragging/);
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window);
    const pending = [];
    window.__landingHeld = false;
    window.requestAnimationFrame = callback => original(time => {
      if (window.__landingHeld) { pending.push(callback); return; }
      callback(time);
      queueMicrotask(() => {
        const preview = document.querySelector('.desktop-tab-drag-preview-settling');
        const target = document.querySelector('.desktop-tab-settling');
        if (preview && target && getComputedStyle(preview).opacity === '0' && getComputedStyle(target).opacity === '1') {
          window.__landingHeld = true;
        }
      });
    });
    window.__resumeLanding = () => {
      window.requestAnimationFrame = original;
      window.__landingHeld = false;
      for (const callback of pending) original(callback);
    };
  });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__landingHeld)).toBe(true);
  const handedOff = await tab.screenshot();
  await page.evaluate(() => window.__resumeLanding());
  await expect(page.locator('.desktop-tab-drag-preview')).toHaveCount(0);
  const cleanedUp = await tab.screenshot();
  const [beforePixels, afterPixels] = await Promise.all([
    sharp(handedOff).raw().toBuffer({ resolveWithObject: true }),
    sharp(cleanedUp).raw().toBuffer({ resolveWithObject: true }),
  ]);
  let maxChannelDelta = 0;
  for (let index = 0; index < beforePixels.data.length; index++) {
    maxChannelDelta = Math.max(maxChannelDelta, Math.abs(beforePixels.data[index] - afterPixels.data[index]));
  }
  if (maxChannelDelta > 1) {
    await sharp(handedOff).toFile(testInfo.outputPath('handoff.png'));
    await sharp(cleanedUp).toFile(testInfo.outputPath('cleanup.png'));
    await testInfo.attach('handoff', { path: testInfo.outputPath('handoff.png'), contentType: 'image/png' });
    await testInfo.attach('cleanup', { path: testInfo.outputPath('cleanup.png'), contentType: 'image/png' });
  }
  expect(beforePixels.info).toEqual(afterPixels.info);
  // Removing an opacity layer can round an antialiased edge by one 8-bit level.
  expect(maxChannelDelta).toBeLessThanOrEqual(1);
});

for (const mode of ['reference', 'split', 'top']) test(`tab release applies ${mode} semantics in the workspace`, async ({ page }) => {
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  await page.goto('http://127.0.0.1:43845');
  const tab = page.locator('.desktop-tab').first();
  await expect(tab).toBeVisible();
  await page.locator('.desktop-tab-add').first().click();
  await expect.poll(() => page.locator('.desktop-tab-strip').first().evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await tab.locator('.desktop-tab-switch').click();
  const id = await tab.getAttribute('data-id');
  const source = await tab.boundingBox();
  await page.evaluate(() => {
    window.__insertions = 0;
    window.addEventListener('tano-entry-reference-inserted', () => window.__insertions++);
  });
  await page.mouse.move(source.x + 60, source.y + 12);
  await page.mouse.down();
  await expect(page.locator('.ProseMirror').first()).toBeVisible();
  const area = await page.locator(mode === 'reference' ? '.ProseMirror' : '.workspace-pane').first().boundingBox();
  const contentTop = await page.locator('.workspace-tabbar').first().evaluate(node => node.getBoundingClientRect().bottom);
  await page.mouse.move(mode === 'split' ? area.x + area.width - 3 : area.x + area.width / 2,
    mode === 'top' ? contentTop + 2 : area.y + Math.min(200, area.height / 2), { steps: 8 });
  if (mode === 'split') {
    await expect(tab).toHaveClass(/desktop-tab-away/);
    expect((await tab.boundingBox()).width).toBeCloseTo(source.width, 2);
  } else expect((await tab.boundingBox()).width).toBeCloseTo(source.width, 2);
  await page.mouse.up();
  await expect(page.locator('.desktop-tab-drag-preview')).toHaveCount(0);
  if (mode === 'reference') {
    expect(await page.evaluate(() => window.__insertions)).toBe(1);
    await expect(page.locator(`.desktop-tab[data-id="${id}"]`)).not.toHaveClass(/desktop-tab-dragging|desktop-tab-outgoing/);
    await expect(page.locator('.workspace-pane')).toHaveCount(1);
  } else if (mode === 'top') {
    await expect(page.locator('.workspace-pane')).toHaveCount(1);
  } else {
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await expect(page.locator('.desktop-tab-outgoing')).toHaveCount(0);
  }
});
