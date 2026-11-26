import { expect, test } from '@playwright/test';
import sharp from 'sharp';

async function prepare(page) {
  await page.addInitScript(() => {
    if (location.origin === 'http://127.0.0.1:43845') localStorage.setItem('tano.preference.locale', 'zh-CN');
  });
  await page.route('**/DesktopWindow.vue*', async route => {
    const response = await route.fetch();
    // Browser popups have no OS chrome. Keep the real workbench and window manager.
    const body = (await response.text()).replace(
      'const appWindow = useWindowContext().native;',
      'const appWindow = useWindowContext().native ?? { isMaximized: async () => false, onResized: async () => () => {} };',
    );
    await route.fulfill({ response, body });
  });
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.workspace-layout')).toBeVisible();
  await page.evaluate(async () => {
    let component = document.querySelector('.workspace-layout').__vueParentComponent;
    while (component && !component.type.__file?.endsWith('/App.vue')) component = component.parent;
    const contexts = Reflect.ownKeys(component.provides)
      .filter(key => key.description?.startsWith('tano-workbench-'))
      .map(key => component.provides[key]);
    const owners = new Map(contexts.flatMap(context =>
      Object.keys(context).map(name => [name, context]),
    ));
    window.workbench = new Proxy({}, {
      get: (_target, name) => owners.get(name)?.[name],
      set(_target, name, value) {
        const owner = owners.get(name);
        if (!owner) throw new Error('Unknown workbench field ' + String(name));
        owner[name] = value;
        return true;
      },
    });
    window.workbench.native = true;
    window.workbench.tabsEnabled = true;
    await window.workbench.store.create('Main.md', false, 'Main document\n');
  });
}

async function openDocumentWindow(page, id, content) {
  const opened = page.waitForEvent('popup');
  await page.evaluate(async ({ id, content }) => {
    const { store, auxiliaryWindows } = window.workbench;
    await store.create(`${id}.md`, false, content);
    const tabId = store.activeId;
    await auxiliaryWindows.open(id, 'tab', id, undefined, () => store.moveTabToAuxiliaryWindow(tabId, id));
  }, { id, content });
  const popup = await opened;
  await expect(popup.locator('.ProseMirror')).toContainText(content.trim(), { useInnerText: true });
  return popup;
}

test('opening assistant history renders one fullscreen panel in the tab owner', async ({ page }) => {
  await prepare(page);
  const first = await openDocumentWindow(page, 'first', 'First document\n');
  const second = await openDocumentWindow(page, 'second', 'Second document\n');
  await page.evaluate(() => {
    const { assistant, store } = window.workbench;
    store.focusPane(store.windowLayouts.main.activePaneId);
    window.workbench.sidebarView = 'assistant';
    assistant.sessions = [{
      version: 1, id: 'history', workspaceId: store.workspace.id, title: '历史对话',
      createdAt: 1, updatedAt: 1, revision: 0,
      messages: Array.from({ length: 24 }, (_, index) => ({
        id: `message-${index}`, role: 'user', content: `历史消息正文 ${index}`, createdAt: 1,
      })),
    }];
  });
  const history = page.getByRole('button', { name: '历史对话', exact: true });
  await history.click();
  const mainPanel = page.locator('.assistant-fullscreen-host .assistant-panel-fullscreen');
  await expect(mainPanel).toHaveCount(1);
  await expect(mainPanel).toContainText('历史消息正文');
  const transcript = mainPanel.getByRole('log');
  const bounds = await transcript.evaluate(element => {
    const viewport = element.getBoundingClientRect();
    const panel = element.closest('.assistant-panel').getBoundingClientRect();
    const message = element.querySelector('.assistant-message').getBoundingClientRect();
    return {
      overflowing: element.scrollHeight > element.clientHeight,
      rightInset: panel.right - viewport.right,
      messageWidth: message.width,
      centerOffset: (message.left + message.right - panel.left - panel.right) / 2,
    };
  });
  expect(bounds.overflowing).toBe(true);
  expect(Math.abs(bounds.rightInset)).toBeLessThan(1);
  expect(bounds.messageWidth).toBeLessThanOrEqual(768);
  expect(Math.abs(bounds.centerOffset)).toBeLessThan(1);
  await transcript.hover({ position: { x: 32, y: 32 } });
  await page.mouse.wheel(0, -500);
  await expect(mainPanel.getByRole('button', { name: '滚动到最新消息' })).toBeVisible();
  await mainPanel.getByRole('button', { name: '滚动到最新消息' }).click();
  await expect(mainPanel.getByRole('button', { name: '滚动到最新消息' })).toBeHidden();
  await history.click();
  await expect(mainPanel).toHaveCount(1);
  await page.evaluate(() => {
    const { store } = window.workbench;
    const ASSISTANT_TAB_ID = 'view:assistant';
    store.moveTabToWindow(ASSISTANT_TAB_ID, 'first', {
      paneId: store.windowLayouts.first.activePaneId, side: 'center',
    });
  });
  const movedPanel = first.locator('.assistant-fullscreen-host .assistant-panel-fullscreen');
  await expect(movedPanel).toHaveCount(1);
  await expect(movedPanel).toContainText('历史消息正文');
  await expect(page.locator('.assistant-panel')).toHaveCount(0);
  await expect(second.locator('.assistant-panel')).toHaveCount(0);
});

test('real workbench windows preserve drafts through auxiliary splits and close empty sources', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  const first = await openDocumentWindow(page, 'first', Array.from({ length: 60 }, (_, index) => `Paragraph ${index}`).join('\n\n') + '\n');
  const second = await openDocumentWindow(page, 'second', 'Second document\n');
  const third = await openDocumentWindow(page, 'third', 'Third document\n');
  await second.setViewportSize({ width: 1100, height: 500 });
  await first.locator('.ProseMirror').click();
  await first.keyboard.press('Control+End');
  await first.keyboard.type(' pending draft');
  await expect(first.locator('.ProseMirror')).toContainText('pending draft');
  const beforeMove = await page.evaluate(() => {
    const paneId = window.workbench.store.windowLayouts.first.activePaneId;
    const editor = window.workbench.paneEditors.get(paneId);
    return { canUndo: editor.canUndo(), selection: editor.captureModeSelection(), scroll: window.workbench.paneScrolls.get(paneId).scrollTop };
  });
  expect(beforeMove.canUndo).toBe(true);
  expect(beforeMove.scroll).toBeGreaterThan(0);
  await page.evaluate(() => {
    const { store } = window.workbench;
    const source = store.windowLayouts.first;
    window.movedDocument = store.documentForTab(source.layout.activeId);
    store.moveTabToWindow(window.movedDocument.id, 'second', {
      paneId: store.windowLayouts.second.activePaneId, side: 'right',
    });
  });
  await expect.poll(() => first.isClosed()).toBe(true);
  await expect(second.locator('.ProseMirror')).toHaveCount(2);
  await expect(second.locator('.ProseMirror').filter({ hasText: 'pending draft' })).toBeVisible();
  expect(await page.evaluate(() => window.workbench.store.documentForTab(window.movedDocument.id) === window.movedDocument)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const paneId = window.workbench.store.windowLayouts.second.activePaneId;
    const editor = window.workbench.paneEditors.get(paneId);
    return { canUndo: editor.canUndo(), selection: editor.captureModeSelection() };
  })).toEqual({ canUndo: true, selection: beforeMove.selection });
  await expect.poll(() => page.evaluate(() => window.workbench.paneScrolls.get(window.workbench.store.windowLayouts.second.activePaneId).scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const paneId = window.workbench.store.windowLayouts.second.activePaneId;
    const scroll = window.workbench.paneScrolls.get(paneId);
    const caret = window.workbench.paneEditors.get(paneId).modeCursorTop() - scroll.getBoundingClientRect().top;
    return caret >= 0 && caret < scroll.clientHeight;
  })).toBe(true);
  const movedEditor = second.locator('.ProseMirror').filter({ hasText: 'pending draft' });
  await movedEditor.press('Control+z');
  await expect(second.locator('.ProseMirror').filter({ hasText: 'pending draft' })).toHaveCount(0);
  await second.keyboard.press('Control+Shift+z');
  await expect(movedEditor).toBeVisible();
  await page.evaluate(() => {
    const { store } = window.workbench;
    store.moveTabToWindow(window.movedDocument.id, 'main', {
      paneId: store.windowLayouts.main.activePaneId, side: 'center',
    });
  });
  await expect(page.locator('.ProseMirror')).toContainText('pending draft');
  await page.locator('.ProseMirror').press('Control+z');
  await expect(page.locator('.ProseMirror')).not.toContainText('pending draft');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.ProseMirror')).toContainText('pending draft');
  await expect(second.locator('.ProseMirror')).toHaveCount(1);
  await expect(second.locator('.ProseMirror')).toContainText('Second document');
  await expect(third.locator('.ProseMirror')).toContainText('Third document');
  await page.evaluate(() => window.workbench.auxiliaryWindows.closeAll());
  await expect.poll(() => second.isClosed() && third.isClosed()).toBe(true);
  expect(errors).toEqual([]);
});

test('the detached settings window fills its corners while island cards stay rounded', async ({ page }) => {
  await prepare(page);
  const selectPreset = id => page.evaluate(id => {
    const { appearance, appearanceController } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id });
  }, id);
  await selectPreset('builtin:islands');
  await page.evaluate(() => window.workbench.openSettings('appearance'));
  await expect(page.locator('.settings-dialog')).toHaveCSS('border-radius', '20px');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();

  const opened = page.waitForEvent('popup');
  await page.evaluate(() => window.workbench.auxiliaryWindows.open('settings', 'settings', '设置'));
  const settings = await opened;
  await settings.setViewportSize({ width: 1080, height: 780 });
  const dialog = settings.locator('.settings-windowed > .settings-dialog');
  const card = dialog.locator('.settings-main');
  for (const { preset, color, cardRadius } of [
    { preset: 'builtin:islands', color: 'builtin:mist', cardRadius: '16px' },
    { preset: 'builtin:frost', color: 'builtin:haze', cardRadius: '16px' },
    { preset: 'builtin:paper', color: 'builtin:ink', cardRadius: '0px' },
  ]) {
    await selectPreset(preset);
    await expect(settings.locator('html')).toHaveAttribute('data-color-theme', color);
    await expect(dialog).toHaveCSS('border-radius', '0px');
    await expect(dialog).toHaveCSS('border-top-width', '0px');
    await expect(dialog).toHaveCSS('box-shadow', 'none');
    await expect(card).toHaveCSS('border-radius', cardRadius);
  }
  await page.evaluate(() => window.workbench.auxiliaryWindows.close('settings'));
});

test('the glass settings modal keeps the same wallpaper framing when its zoom finishes', async ({ page }) => {
  await page.setViewportSize({ width: 1296, height: 944 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await prepare(page);
  await page.evaluate(() => {
    const { appearance, appearanceController, openSettings } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id: 'builtin:liquid' });
    openSettings('appearance');
  });
  const dialog = page.locator('.settings-dialog');
  const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
    <defs><pattern id="bands" width="300" height="300" patternUnits="userSpaceOnUse">
      <rect width="300" height="300" fill="#233563"/><path d="M0 0H300V50H0Z M0 0H50V300H0Z" fill="#ffc277"/>
    </pattern></defs><rect width="1600" height="1000" fill="url(#bands)"/>
  </svg>`)).png().toBuffer();
  await dialog.locator('.glass-wallpaper input[type=file]').setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('html')).toHaveAttribute('data-glass-wallpaper', '');
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.settings-backdrop, .settings-dialog')) {
        animation.pause();
        animation.currentTime = 60;
      }
      return animation;
    };
    window.workbench.openSettings('appearance');
  });
  const backdrop = page.locator('.settings-backdrop');
  await expect.poll(() => backdrop.evaluate(el => Number(getComputedStyle(el).opacity))).toBeLessThan(1);
  expect(await dialog.evaluate(el => Number(getComputedStyle(el).scale))).toBeLessThan(1);
  await backdrop.evaluate(el => {
    for (const animation of el.getAnimations({ subtree: true })) {
      if (animation.effect.target === el || animation.effect.target.matches('.settings-dialog')) {
        animation.currentTime = animation.effect.getComputedTiming().endTime;
      }
    }
  });
  // Compare an empty area of the sidebar in the last keyframe and after the
  // animator removes the transform. The two frames should use the same crop.
  await expect(dialog).toHaveCSS('scale', '1');
  const box = await dialog.boundingBox();
  const clip = { x: Math.round(box.x + 24), y: Math.round(box.y + box.height / 2), width: 160, height: 150 };
  const capture = async () => sharp(await page.screenshot({ clip })).removeAlpha().raw().toBuffer();
  const animated = await capture();
  await backdrop.evaluate(el => el.getAnimations()[0].finish());
  await expect(dialog).toHaveCSS('scale', 'none');
  const settled = await capture();
  const changed = settled.reduce((count, channel, index) => count + Number(Math.abs(channel - animated[index]) > 4), 0);
  expect(changed / settled.length).toBeLessThan(0.01);
});

test('wallpaper sliders share both track edges at wide and narrow widths', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const { appearance, appearanceController } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id: 'builtin:liquid' });
    window.workbench.openSettings('appearance');
  });
  const sliders = page.locator('.glass-wallpaper').getByRole('slider');
  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(sliders).toHaveCount(2);
    const [overlay, softness] = await sliders.evaluateAll(inputs => inputs.map(input => {
      const { left, right } = input.getBoundingClientRect();
      return { left, right };
    }));
    expect(overlay.right).toBeGreaterThan(overlay.left);
    expect(softness).toEqual(overlay);
  }
});

test('built-in glass wallpapers switch their thumbnail and bitmap with the display mode', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.workbench.openSettings('appearance'));
  const mode = page.getByRole('combobox', { name: '显示模式', exact: true });
  const root = page.locator('html');
  const readWallpaper = () => root.evaluate(element => element.style.getPropertyValue('--glass-wallpaper'));
  const readBrightness = cssImage => page.evaluate(async cssImage => {
    const url = cssImage.slice(5, -2);
    const image = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 1, 1);
    image.close();
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return (red + green + blue) / 3;
  }, cssImage);

  for (const [preset, wallpaper] of [['builtin:frost', '晨雾'], ['builtin:liquid', '暮光']]) {
    await page.evaluate(id => {
      const { appearance, appearanceController } = window.workbench;
      appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id });
    }, preset);
    await mode.selectOption('light');
    const sliders = page.locator('.glass-wallpaper').getByRole('slider');
    await expect(sliders).toHaveCount(2);
    const choice = page.getByRole('group', { name: '背景图片' }).getByRole('button', { name: wallpaper, exact: true });
    const swatch = choice.locator('.glass-wallpaper-swatch');
    const previousWallpaper = await readWallpaper();
    await choice.click();
    await expect.poll(readWallpaper).not.toBe(previousWallpaper);
    await expect(root).toHaveCSS('--glass-wallpaper-veil', '24%');
    const lightWallpaper = await readWallpaper();
    const lightSwatch = await swatch.evaluate(element => getComputedStyle(element).backgroundImage);

    await mode.selectOption('dark');
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(sliders).toHaveCount(2);
    await expect(swatch).not.toHaveCSS('background-image', lightSwatch);
    await expect.poll(readWallpaper).not.toBe(lightWallpaper);
    await expect(root).toHaveAttribute('data-glass-wallpaper', '');
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    const darkSwatch = await swatch.evaluate(element => getComputedStyle(element).backgroundImage);
    await expect(root).toHaveCSS('--glass-wallpaper-veil', preset === 'builtin:liquid' ? '91%' : '45%');
    await expect(page.locator('.glass-wallpaper')).toHaveAttribute('aria-busy', 'false');
    const darkWallpaper = await readWallpaper();
    const darkBrightness = await readBrightness(darkWallpaper);
    expect(await readBrightness(darkSwatch)).toBeLessThan(await readBrightness(lightSwatch) * 0.6);
    expect(darkBrightness).toBeLessThan(100);

    await page.emulateMedia({ colorScheme: 'dark' });
    await mode.selectOption('system');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(root).toHaveAttribute('data-theme', 'light');
    await expect(swatch).toHaveCSS('background-image', lightSwatch);
    await expect.poll(readWallpaper).not.toBe(darkWallpaper);
    await expect(root).toHaveCSS('--glass-wallpaper-veil', '24%');
  }
});

test('dark liquid glass shades a bright custom wallpaper across the desktop tab strip and settings page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1296, height: 944 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  const selectPreset = id => page.evaluate(id => {
    const { appearance, appearanceController } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id });
  }, id);
  await selectPreset('builtin:frost');
  await page.evaluate(() => window.workbench.openSettings('appearance'));
  const mode = page.getByRole('combobox', { name: '显示模式', exact: true });
  await mode.selectOption('dark');
  const white = await sharp({ create: { width: 512, height: 384, channels: 3, background: '#fff' } }).png().toBuffer();
  await page.locator('.glass-wallpaper input[type=file]').setInputFiles({ name: 'bright.png', mimeType: 'image/png', buffer: white });
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-glass-wallpaper', '');
  await page.getByRole('button', { name: '作为标签页打开', exact: true }).click();
  await expect(page.locator('.settings-tabbed')).toBeVisible();

  // Sample blank space above the file tree and inside the settings tab from the actual composite.
  const sample = async name => {
    const shot = await sharp(await page.screenshot({ path: testInfo.outputPath(name) })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return [{ left: 55, top: 5 }, { left: 495, top: 300 }].map(({ left, top }) => {
      const offset = (top * shot.info.width + left) * shot.info.channels;
      return Math.max(...shot.data.subarray(offset, offset + 3));
    });
  };
  const frost = await sample('dark-frost.png');
  await selectPreset('builtin:liquid');
  await expect(root).toHaveAttribute('data-liquid-refraction', '');
  const liquid = await sample('dark-liquid.png');
  for (const [i, brightness] of liquid.entries()) {
    expect(brightness).toBeLessThan(65);
    expect(brightness).toBeLessThanOrEqual(frost[i] + 18);
  }
  await mode.selectOption('light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  for (const brightness of await sample('light-liquid.png')) expect(brightness).toBeGreaterThan(180);

  const black = await sharp({ create: { width: 512, height: 384, channels: 3, background: '#000' } }).png().toBuffer();
  await page.locator('.glass-wallpaper input[type=file]').setInputFiles({ name: 'dark.png', mimeType: 'image/png', buffer: black });
  await expect(page.locator('.glass-wallpaper')).toHaveAttribute('aria-busy', 'false');
  const overlay = page.getByRole('slider', { name: '背景蒙版不透明度' });
  await overlay.press('Home');
  await expect(root).toHaveCSS('--glass-wallpaper-veil', '0%');
  const [bare] = await sample('light-liquid-bare.png');
  await overlay.press('End');
  await expect(root).toHaveCSS('--glass-wallpaper-veil', '100%');
  const [veiled] = await sample('light-liquid-veiled.png');
  expect(veiled - bare).toBeGreaterThan(100);
});

test('liquid glass keeps the docked toolbar transparent above both theme palettes', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const { appearance, appearanceController } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id: 'builtin:liquid' });
    window.workbench.toolbarMode = 'bottom';
  });
  const toolbar = page.locator('.selection-toolbar .selection-format-toolbar');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.locator('.ProseMirror').first().click();
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect.poll(() => toolbar.evaluate(el => getComputedStyle(el, '::before').backdropFilter)).toContain('#tano-liquid-');
    await toolbar.locator('button[aria-haspopup]').first().click();
    await expect(page.locator('.selection-toolbar .dropdown:visible').first()).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('liquid glass islands use the same single rim on the sidebar and tabbed page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1296, height: 944 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await page.evaluate(() => {
    const { appearance, appearanceController, openSettingsTab } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id: 'builtin:liquid' });
    window.workbench.developerMode = true;
    openSettingsTab('appearance');
  });
  const settings = page.locator('.settings-tabbed');
  const sidebar = page.locator('.sidebar-surface[data-liquid-glass]');
  const card = page.locator('.workspace-card[data-liquid-joined-card]');
  const rim = page.locator('.liquid-joined-outline path');
  for (const [mode, wallpaper] of [['light', '云层'], ['dark', '调试条纹']]) {
    await settings.getByRole('combobox', { name: '显示模式', exact: true }).selectOption(mode);
    await settings.getByRole('button', { name: wallpaper, exact: true }).click();
    await expect(settings.locator('.glass-wallpaper')).toHaveAttribute('aria-busy', 'false');
    await expect(rim).toHaveCSS('stroke-width', '1px');
    const color = await rim.evaluate(path => getComputedStyle(path).stroke);
    await expect(sidebar).toHaveCSS('box-shadow', `${color} 0px 0px 0px 1px inset`);
    await expect(card).toHaveCSS('box-shadow', 'none');
    for (const surface of [sidebar, card]) {
      const id = await surface.getAttribute('data-liquid-glass');
      const lens = page.locator(`.liquid-lens[style*="url(#tano-liquid-${id})"]`);
      await expect(lens).toHaveCSS('box-shadow', 'none');
      await expect(lens).toHaveCSS('backdrop-filter', 'none');
      await expect(lens.locator(':scope > svg > rect')).toHaveAttribute('filter', `url(#tano-liquid-${id})`);
    }
    await page.screenshot({ path: testInfo.outputPath(`island-rims-${mode}.png`) });
    const reused = await settings.locator('.settings-main').evaluate(async scroller => {
      const lenses = [...document.querySelectorAll('.liquid-lens[data-static-desk]')];
      const paints = lenses.map(lens => lens.firstElementChild);
      const initial = scroller.scrollTop;
      scroller.scrollTop = initial > 100 ? initial - 100 : initial + 100;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return scroller.scrollTop !== initial && lenses.every((lens, i) => lens.firstElementChild === paints[i]);
    });
    expect(reused).toBe(true);
  }
});

test('stationary glass paints the current theme gradient when no wallpaper is selected', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const { appearance, appearanceController, openSettingsTab } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id: 'builtin:liquid' });
    openSettingsTab('appearance');
  });
  await page.getByRole('button', { name: '光斑', exact: true }).click();
  const gradient = color => page.evaluate(color =>
    document.documentElement.style.setProperty('--workbench-back-paint',
      `repeating-linear-gradient(to right, ${color} 0 20px, white 20px 24px)`), color);
  const pane = page.locator('.workspace-card[data-liquid-joined-card]');
  const id = await pane.getAttribute('data-liquid-glass');
  const field = page.locator(`#tano-liquid-crop-${id} image`);
  await gradient('tomato');
  await expect(field).toHaveAttribute('href', /tomato|255%2C%2099%2C%2071/);
  const box = await pane.boundingBox();
  const clip = { x: Math.round(box.x + box.width - 250), y: Math.round(box.y + 3), width: 160, height: 24 };
  const capture = async () => sharp(await page.screenshot({ clip })).removeAlpha().raw().toBuffer();
  const bent = await capture();
  await page.locator(`#tano-liquid-${id} feDisplacementMap`).evaluateAll(nodes =>
    nodes.forEach(node => node.setAttribute('scale', '0')));
  const flat = await capture();
  expect(bent.reduce((sum, value, i) => sum + Math.abs(value - flat[i]), 0) / bent.length).toBeGreaterThan(2);
  await gradient('teal');
  await expect(field).toHaveAttribute('href', /teal|0%2C%20128%2C%20128/);
});

test('the selected liquid glass tab and its page share one surface', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await page.evaluate(async () => {
    const { appearance, appearanceController, openSettings, store } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id: 'builtin:liquid' });
    await store.create('Second.md', false, 'Second document\n');
    openSettings('appearance');
  });
  await page.getByRole('group', { name: '背景图片' }).getByRole('button', { name: '暮光', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const main = page.locator('.desktop-tab').filter({ hasText: 'Main' });
  const second = page.locator('.desktop-tab').filter({ hasText: 'Second' });
  const card = page.locator('.workspace-page-content:visible');
  const veil = page.locator('.liquid-joined-veil');
  await expect(second).toHaveAttribute('data-liquid-joined-tab', '');
  await expect(main).not.toHaveAttribute('data-liquid-joined-tab', '');
  await expect(card).toHaveAttribute('data-liquid-joined-card', '');
  await expect(veil).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-glass-wallpaper', '');
  await expect(page.locator('.liquid-pane')).toHaveCount(0);
  await expect(card).toHaveCSS('backdrop-filter', 'none');
  await expect(second).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const previousOutline = await veil.evaluate(element => element.style.clipPath);
  await main.getByRole('tab').click();
  await expect(main).toHaveAttribute('data-liquid-joined-tab', '');
  await expect(second).not.toHaveAttribute('data-liquid-joined-tab', '');
  await expect.poll(() => veil.evaluate(element => element.style.clipPath)).not.toBe(previousOutline);
  const [tab, body, glass] = await Promise.all([main.boundingBox(), card.boundingBox(), veil.boundingBox()]);
  expect(Math.abs(tab.y + tab.height - body.y)).toBeLessThan(1);
  expect(Math.abs(glass.y - tab.y)).toBeLessThan(1);
  expect(Math.abs(glass.y + glass.height - body.y - body.height)).toBeLessThan(1);

  const pixels = await sharp(await page.screenshot({ clip: {
    x: Math.round(tab.x + 74), y: Math.round(body.y - 2), width: 24, height: 4,
  } })).removeAlpha().raw().toBuffer();
  const rowBytes = 24 * 3;
  const seam = pixels.reduce((largest, channel, index) => Math.max(largest, Math.abs(channel - pixels[index % rowBytes])), 0);
  expect(seam).toBeLessThan(8);

  await second.getByRole('tab').click();
  await page.evaluate(() => {
    const { store } = window.workbench;
    store.moveTabToWindow(store.activeId, 'main', { paneId: store.windowLayouts.main.activePaneId, side: 'bottom' });
  });
  await expect(veil).toHaveCount(2);
  await expect(main).toHaveAttribute('data-liquid-joined-tab', '');
  await expect(second).toHaveAttribute('data-liquid-joined-tab', '');
  await expect(card).toHaveCount(2);
});

test('the settings tab meets the breadcrumb without a rounded dialog frame', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.workbench.openSettingsTab('appearance'));
  const settings = page.locator('.settings-tabbed .settings-dialog');
  const header = page.locator('.topbar:visible').filter({ has: page.locator('.breadcrumb-current', { hasText: '设置' }) });
  await expect(header.locator('.breadcrumb-menu-trigger + svg + .breadcrumb-current')).toHaveText('设置');
  for (const layout of ['builtin:tano', 'builtin:inset', 'builtin:islands', 'builtin:paper']) {
    await settings.getByRole('combobox', { name: '布局风格', exact: true }).selectOption(layout);
    await expect(settings).toHaveCSS('border-top-left-radius', '0px');
    await expect(settings).toHaveCSS('box-shadow', 'none');
    const bar = await header.boundingBox();
    const panel = await settings.boundingBox();
    expect(panel.x).toBeCloseTo(bar.x, 0);
    expect(panel.y).toBeCloseTo(bar.y + bar.height, 0);
  }
});

for (const [material, preset] of [['frosted glass', 'builtin:frost'], ['liquid glass', 'builtin:liquid']]) {
  test(`${material} settings tabs show the same wallpaper surface as document tabs`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(id => {
      const { appearance, appearanceController, openSettings } = window.workbench;
      appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id });
      openSettings('appearance');
    }, preset);
    await page.getByRole('group', { name: '背景图片' }).getByRole('button', { name: '晨雾', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-glass-wallpaper', '');
    const pageCard = page.locator('.workspace-page-content.workspace-card:visible');
    const documentBackground = await pageCard.evaluate(card => getComputedStyle(card).backgroundColor);

    await page.locator('.settings-main').evaluate(main => { main.scrollTop = 0; });
    await page.getByRole('button', { name: '作为标签页打开', exact: true }).click();
    const tab = page.locator('.settings-tabbed');
    await expect(tab).toBeVisible();
    await expect(pageCard).toHaveCSS('background-color', documentBackground);
    for (const surface of [tab, tab.locator('.settings-dialog'), tab.locator('.settings-nav'), tab.locator('.settings-main')]) {
      await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(surface).toHaveCSS('background-image', 'none');
    }
    if (preset === 'builtin:liquid') {
      await expect(pageCard).toHaveAttribute('data-liquid-joined-card', '');
      await expect(page.locator('.workspace-tabbar .desktop-tab-active')).toHaveAttribute('data-liquid-joined-tab', '');
    }
  });
}

test('switching glass material preserves the layout’s cards and docked tabs', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const { appearance, appearanceController, openSettingsTab } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: 'preset', id: 'builtin:frost' });
    openSettingsTab('appearance');
  });
  const settings = page.locator('.settings-tabbed');
  const layout = settings.getByRole('combobox', { name: '布局风格', exact: true });
  const material = settings.getByRole('combobox', { name: '材质', exact: true });
  const root = page.locator('html');
  const sidebarSurface = page.locator('.app-shell > .sidebar > .sidebar-surface');
  const sidebarBounds = () => sidebarSurface.evaluate(surface => {
    const { display, top, right, bottom, left, borderRadius } = getComputedStyle(surface);
    return { display, top, right, bottom, left, borderRadius };
  });
  const inactiveTab = page.locator('.desktop-tab:not(.desktop-tab-active)').first();
  await expect(inactiveTab).toBeVisible();

  for (const [id, structure] of [
    ['builtin:islands', 'islands'],
    ['builtin:inset', 'islands'],
    ['builtin:tano', 'continuous'],
    ['builtin:paper', 'document'],
  ]) {
    await layout.selectOption(id);
    await expect(root).toHaveAttribute('data-layout', structure);
    await expect(root).toHaveAttribute('data-layout-theme', id);
    await material.selectOption('builtin:frost');
    await expect(root).toHaveAttribute('data-material', 'builtin:frost');
    const frostedSidebar = await sidebarBounds();
    if (id === 'builtin:islands') {
      expect(parseFloat(frostedSidebar.top)).toBeGreaterThan(0);
    } else {
      expect(frostedSidebar.display).toBe('none');
    }

    await material.selectOption('builtin:liquid');
    await expect(root).toHaveAttribute('data-material', 'builtin:liquid');
    await expect(root).toHaveAttribute('data-layout', structure);
    expect(await sidebarBounds()).toEqual(frostedSidebar);
    if (id === 'builtin:islands') {
      await expect(sidebarSurface).toHaveAttribute('data-liquid-glass', /\d+/);
    } else {
      await expect(sidebarSurface).not.toHaveAttribute('data-liquid-glass', /.+/);
      const content = structure === 'islands' ? '.workspace-page-content.workspace-card' : '.workspace-pane-surface';
      await expect(page.locator(`${content}:visible`)).toHaveAttribute('data-liquid-glass', /\d+/);
    }
    await expect(inactiveTab).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await inactiveTab.evaluate(tab => getComputedStyle(tab, '::after').content)).toBe('none');
  }
});

test('opaque materials and layouts stay orthogonal across light/dark modes, geometry, colours and shapes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await page.evaluate(() => window.workbench.openSettingsTab('appearance'));
  await expect(page.locator('.desktop-tab-list-animating, .desktop-tab-list-slotting')).toHaveCount(0);
  const settings = page.locator('.settings-tabbed');
  const layout = settings.getByRole('combobox', { name: '布局风格', exact: true });
  const material = settings.getByRole('combobox', { name: '材质', exact: true });
  const shape = settings.getByRole('combobox', { name: '形态与密度', exact: true });
  const mode = settings.getByRole('combobox', { name: '显示模式', exact: true });
  const root = page.locator('html');
  const shell = page.locator('.app-shell');
  const sidebar = shell.locator('> .sidebar');
  const activeTab = page.locator('.workspace-tabbar .desktop-tab-active').first();
  const activeTabCorners = activeTab.locator('.desktop-tab-corners');

  for (const colorMode of ['light', 'dark']) {
    await mode.selectOption(colorMode);
    await expect(root).toHaveAttribute('data-theme', colorMode);
    await shape.selectOption('builtin:tano');
    await layout.selectOption('builtin:tano');
    await material.selectOption('builtin:tano');
    const baselineDeskBg = await shell.evaluate(el => getComputedStyle(el).backgroundColor);

    for (const [id, structure] of [
      ['builtin:islands', 'islands'],
      ['builtin:inset', 'islands'],
      ['builtin:tano', 'continuous'],
      ['builtin:paper', 'document'],
    ]) {
      await layout.selectOption(id);
      await material.selectOption('builtin:tano');
      // Layout must never darken or alter the palette's desk background.
      await expect(shell).toHaveCSS('background-color', baselineDeskBg);
      const flatSidebarBg = await sidebar.evaluate(el => getComputedStyle(el).backgroundColor);
      const flatTab = await activeTab.boundingBox();
      const flatCornersDisplay = await activeTabCorners.evaluate(el => getComputedStyle(el).display);
      const flatCard = structure === 'islands'
        ? await page.locator('.workspace-page-content.workspace-card:visible').boundingBox()
        : null;
      const flatCardRadius = structure === 'islands'
        ? await page.locator('.workspace-page-content.workspace-card:visible').evaluate(el => getComputedStyle(el).borderTopLeftRadius)
        : null;

      for (const opaqueMaterial of ['builtin:raised', 'builtin:paper']) {
        await material.selectOption(opaqueMaterial);
        await expect(root).toHaveAttribute('data-material', opaqueMaterial);
        await expect(root).toHaveAttribute('data-layout', structure);
        await expect(settings.getByRole('group', { name: '背景图片' })).toHaveCount(0);
        // Opaque surface-only materials must never touch backdrop/sidebar colours, tab bounds or card geometry.
        await expect(shell).toHaveCSS('background-color', baselineDeskBg);
        await expect(sidebar).toHaveCSS('background-color', flatSidebarBg);
        expect(await activeTab.boundingBox()).toEqual(flatTab);
        expect(await activeTabCorners.evaluate(el => getComputedStyle(el).display)).toBe(flatCornersDisplay);
        if (structure === 'islands') {
          const card = page.locator('.workspace-page-content.workspace-card:visible');
          expect(await card.boundingBox()).toEqual(flatCard);
          await expect(card).toHaveCSS('border-top-left-radius', flatCardRadius);
          await expect(card).toHaveCSS('border-top-width', '1px');
          if (opaqueMaterial === 'builtin:raised') {
            const bevel = await card.evaluate(el => getComputedStyle(el, '::after').boxShadow);
            expect(bevel).toContain('inset');
          } else {
            const texture = await card.evaluate(el => getComputedStyle(el).backgroundImage);
            expect(texture).not.toBe('none');
          }
        } else if (opaqueMaterial === 'builtin:paper') {
          const surface = page.locator('.workspace-pane-surface:visible').first();
          const texture = await surface.evaluate(el => getComputedStyle(el).backgroundImage);
          expect(texture).not.toBe('none');
        }
      }
    }

    // Shape controls geometry only (radii) without altering palette backdrop colours or material shadows.
    await layout.selectOption('builtin:islands');
    await material.selectOption('builtin:raised');
    const card = page.locator('.workspace-page-content.workspace-card:visible');
    const raisedShadow = await card.evaluate(el => getComputedStyle(el).boxShadow);
    expect(raisedShadow).not.toBe('none');
    for (const [shapeId, expectedRadius] of [['builtin:rounded', '16px'], ['builtin:crisp', '0px'], ['builtin:tano', '10px']]) {
      await shape.selectOption(shapeId);
      await expect(card).toHaveCSS('border-top-left-radius', expectedRadius);
      await expect(shell).toHaveCSS('background-color', baselineDeskBg);
      await expect(card).toHaveCSS('box-shadow', raisedShadow);
    }
  }
});

test('document layout delegates radii to shape and paper tooth strictly to paper material', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  const apply = (kind, id) => page.evaluate(([k, v]) => {
    const { appearance, appearanceController } = window.workbench;
    appearanceController.select({ workspaceId: appearance.workspaceId, kind: k, id: v });
  }, [kind, id]);

  const shell = page.locator('.app-shell');
  const docSheet = page.locator('.document-main').first();
  const activeTab = page.locator('.workspace-tabbar .desktop-tab-active').first();
  await expect(docSheet).toBeVisible();

  await apply('layout', 'builtin:tano');
  await apply('material', 'builtin:tano');
  await apply('shape', 'builtin:tano');
  const baseDeskBg = await shell.evaluate(el => getComputedStyle(el).backgroundColor);

  await apply('layout', 'builtin:paper');
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'document');
  await expect(shell).toHaveCSS('background-color', baseDeskBg);
  // Flat material on document layout must not draw paper grain from legacy data-surface="paper".
  await expect(docSheet).toHaveCSS('background-image', 'none');

  // Corner radii on document sheet and detached slip tab must obey Shape, never hardcoded 4px/6px.
  for (const [shapeId, cardRadius, tabRadius] of [
    ['builtin:rounded', '16px', '10px'],
    ['builtin:crisp', '0px', '0px'],
    ['builtin:print', '2px', '3px'],
  ]) {
    await apply('shape', shapeId);
    await expect(docSheet).toHaveCSS('border-top-left-radius', cardRadius);
    await expect(activeTab).toHaveCSS('border-top-left-radius', tabRadius);
  }

  // Enabling the independent paper grain material adds subtle tooth without darkening the desk.
  await apply('material', 'builtin:paper');
  await expect(shell).toHaveCSS('background-color', baseDeskBg);
  expect(await docSheet.evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe('none');
  await expect(docSheet).toHaveCSS('border-top-left-radius', '2px');
});

test('inset layout keeps the island content bounds and puts the sidebar on the desk', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.workbench.openSettingsTab('appearance'));
  const layout = page.getByRole('combobox', { name: '布局风格', exact: true });
  const sidebar = page.locator('.app-shell > .sidebar');
  const sidebarSurface = sidebar.locator('.sidebar-surface');
  const card = page.locator('.workspace-page-content.workspace-card:visible');
  await layout.selectOption('builtin:islands');
  await expect(sidebarSurface).toBeVisible();
  await expect(card).toHaveCSS('border-top-left-radius', '10px');
  const islandBounds = await card.boundingBox();

  await layout.selectOption({ label: '留边布局' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(sidebarSurface).toBeHidden();
  await expect(card).toHaveCSS('border-top-left-radius', '10px');
  expect(await card.boundingBox()).toEqual(islandBounds);
  const preview = page.locator('.theme-preset-quick-row [aria-pressed="true"] .theme-preview');
  await expect(preview).toHaveAttribute('data-preview-structure', 'islands');
  await expect(preview.locator('.theme-preview-sidebar').first()).toHaveCSS('border-right-width', '0px');
});

test('inset layout preserves the edge-to-edge background in light and dark mode', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.workbench.openSettingsTab('appearance'));
  const root = page.locator('html');
  const shell = page.locator('.app-shell');
  const sidebar = shell.locator('> .sidebar');
  const layout = page.getByRole('combobox', { name: '布局风格', exact: true });
  const mode = page.getByRole('combobox', { name: '显示模式', exact: true });

  for (const colorMode of ['light', 'dark']) {
    await mode.selectOption(colorMode);
    await expect(root).toHaveAttribute('data-theme', colorMode);
    await layout.selectOption('builtin:tano');
    const background = await sidebar.evaluate(element => getComputedStyle(element).backgroundColor);
    await expect(shell).toHaveCSS('background-color', background);

    await layout.selectOption('builtin:inset');
    await expect(shell).toHaveCSS('background-color', background);
    await expect(sidebar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
});

test('liquid glass and its default wallpaper become visible together', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    window.workbench.openSettingsTab('appearance');
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type !== 'image/webp' || Math.max(this.width, this.height) < 1000) {
        return encode.call(this, callback, type, quality);
      }
      window.releaseWallpaperEncode = () => encode.call(this, callback, type, quality);
    };
  });
  const root = page.locator('html');
  const shell = page.locator('.app-shell');
  const background = await shell.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.getByRole('combobox', { name: '材质', exact: true }).selectOption('builtin:liquid');
  await page.waitForFunction(() => typeof window.releaseWallpaperEncode === 'function');
  await expect(root).not.toHaveAttribute('data-material', 'builtin:liquid');
  await expect(shell).toHaveCSS('background-color', background);
  await page.evaluate(() => window.releaseWallpaperEncode());
  await expect(root).toHaveAttribute('data-material', 'builtin:liquid');
  await expect(root).toHaveAttribute('data-glass-wallpaper', '');
  await expect(shell).toHaveCSS('background-image', /blob:/);
});

for (const [layout, id] of [['continuous', 'builtin:tano'], ['document', 'builtin:paper']]) {
  test(`liquid glass refracts the visible ${layout} settings and document surfaces`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await prepare(page);
    await page.evaluate(() => window.workbench.openSettingsTab('appearance'));
    const settings = page.locator('.settings-tabbed');
    await settings.getByRole('combobox', { name: '布局风格', exact: true }).selectOption(id);
    await settings.getByRole('combobox', { name: '材质', exact: true }).selectOption('builtin:liquid');
    await settings.getByRole('group', { name: '背景图片' }).getByRole('button', { name: '云层', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-glass-wallpaper', '');
    const sidebar = page.locator('.app-shell > .sidebar > .sidebar-surface');
    await expect(sidebar).toBeHidden();
    await expect(sidebar).not.toHaveAttribute('data-liquid-glass', /.+/);
    await expect(page.locator('.app-shell > .sidebar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const previewSidebar = settings.locator(`[data-preview-surface="liquid"][data-preview-structure="${layout}"] .theme-preview-sidebar`).first();
    await expect(previewSidebar).toHaveCSS('box-shadow', 'none');
    await expect(previewSidebar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    for (const view of ['settings', 'editor']) {
      if (view === 'editor') await page.locator('.tree-row[title="Main.md"]').click();
      const target = page.locator(layout === 'document' && view === 'editor' ? '.document-main:visible' : '.workspace-pane-surface:visible');
      await expect(target).toHaveAttribute('data-liquid-glass', /\d+/);
      const surfaceId = await target.getAttribute('data-liquid-glass');
      const box = await target.boundingBox();
      const clip = { x: Math.ceil(box.x + 2), y: Math.ceil(box.y + 60), width: 22, height: 200 };
      const capture = async () => sharp(await page.screenshot({ clip })).removeAlpha().raw().toBuffer();
      const glass = await capture();
      await page.screenshot({ path: testInfo.outputPath(`${layout}-${view}.png`) });
      // Keep tint, blur and shadows identical; neutralize just the displacement.
      const channels = page.locator(`#tano-liquid-${surfaceId} feDisplacementMap`);
      await expect(channels).toHaveCount(3);
      const scales = await channels.evaluateAll(nodes => nodes.map(node => {
        const scale = node.getAttribute('scale');
        node.setAttribute('scale', '0');
        return scale;
      }));
      const flat = await capture();
      await channels.evaluateAll((nodes, original) => nodes.forEach((node, i) => node.setAttribute('scale', original[i])), scales);
      const difference = glass.reduce((sum, value, i) => sum + Math.abs(value - flat[i]), 0) / glass.length;
      expect(difference).toBeGreaterThan(0.5);
    }
    // The browser has no native title bar to host the compact desktop toggle.
    await page.evaluate(() => { window.workbench.native = false; });
    await page.setViewportSize({ width: 640, height: 720 });
    await expect(page.locator('html')).toHaveClass(/compact-layout/);
    await expect(page.locator('.app-shell > .sidebar')).toHaveAttribute('aria-hidden', 'true');
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await expect(page.locator('.app-shell > .sidebar')).toBeVisible();
    await expect(sidebar).toHaveCSS('display', 'none');
    await expect(sidebar).not.toHaveAttribute('data-liquid-glass', /.+/);
  });
}

test('continuous glass bends wallpaper stripes at the exposed top and keeps window seams flat', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1296, height: 944 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await prepare(page);
  await page.evaluate(() => {
    window.workbench.developerMode = true;
    window.workbench.openSettingsTab('appearance');
  });
  const settings = page.locator('.settings-tabbed');
  await settings.getByRole('combobox', { name: '布局风格', exact: true }).selectOption('builtin:tano');
  await settings.getByRole('combobox', { name: '材质', exact: true }).selectOption('builtin:liquid');
  await settings.getByRole('button', { name: '调试条纹', exact: true }).click();
  await expect(settings.locator('.glass-wallpaper')).toHaveAttribute('aria-busy', 'false');
  const pane = page.locator('.workspace-pane-surface:visible');
  await expect(pane).toHaveAttribute('data-liquid-joined-card', '');
  const box = await pane.boundingBox();
  const tab = await page.locator('[data-liquid-joined-tab]').boundingBox();
  const x = Math.floor(box.x + box.width - 215);
  expect(x).toBeGreaterThan(tab.x + tab.width);
  // On the unbent wallpaper these vertical stripes have the same horizontal
  // profile in every row. At the rim they curve as they enter the sheet.
  const clip = { left: x, top: Math.round(box.y) + 2, width: 155, height: 32 };
  const sample = (image, region) => sharp(image).extract(region).removeAlpha().raw().toBuffer();
  const rowVariation = async image => {
    const pixels = await sample(image, clip);
    const stride = clip.width * 3;
    return pixels.subarray(0, stride).reduce((sum, value, i) =>
      sum + Math.abs(value - pixels[(clip.height - 1) * stride + i]), 0) / stride;
  };
  const glass = await page.screenshot({ path: testInfo.outputPath('continuous-top-stripes.png') });
  const id = await pane.getAttribute('data-liquid-glass');
  await page.locator(`#tano-liquid-${id} feDisplacementMap`).evaluateAll(nodes =>
    nodes.forEach(node => node.setAttribute('scale', '0')));
  const flat = await page.screenshot();
  expect(await rowVariation(glass) - await rowVariation(flat)).toBeGreaterThan(2);
  const right = Math.round(box.x + box.width), bottom = Math.round(box.y + box.height);
  for (const region of [
    { left: right - 8, top: Math.round(box.y + 130), width: 8, height: 460 },
    { left: x, top: bottom - 8, width: 155, height: 8 },
  ]) {
    const original = await sample(flat, region);
    expect((await sample(glass, region)).equals(original)).toBe(true);
  }
});

test('continuous liquid glass extends only the pane edges that reach the window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await page.evaluate(() => window.workbench.openSettingsTab('appearance'));
  const settings = page.locator('.settings-tabbed');
  await settings.getByRole('combobox', { name: '布局风格', exact: true }).selectOption('builtin:tano');
  await settings.getByRole('combobox', { name: '材质', exact: true }).selectOption('builtin:liquid');
  const panes = page.locator('.workspace-pane-surface:visible');
  const extensions = () => panes.evaluateAll(elements => elements.map(el => {
    const box = el.getBoundingClientRect();
    const lens = document.querySelector(`.liquid-lens[style*="url(#tano-liquid-${el.dataset.liquidGlass})"]`)?.getBoundingClientRect();
    return {
      right: lens?.right > box.right + 1,
      bottom: lens?.bottom > box.bottom + 1,
      x: box.left, y: box.top,
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x).map(({ right, bottom }) => [right, bottom]));
  await expect.poll(extensions).toEqual([[true, true]]);
  const split = side => page.evaluate(side => {
    const { store } = window.workbench;
    store.moveTabToWindow(store.activeId, 'main', { paneId: store.windowLayouts.main.activePaneId, side });
  }, side);
  await split('right');
  await expect.poll(extensions).toEqual([[false, true], [true, true]]);
  await page.evaluate(() => window.workbench.store.create('Split.md', false, 'Split document'));
  await split('bottom');
  await expect.poll(extensions).toEqual([[false, true], [true, false], [true, true]]);
});

test('settings edits update the actual main and auxiliary editors immediately', async ({ page }) => {
  await prepare(page);
  const child = await openDocumentWindow(page, 'settings-target', 'Auxiliary document\n');
  await page.locator('.tree-row[title="Main.md"]').click();
  const opened = page.waitForEvent('popup');
  await page.evaluate(() => window.workbench.auxiliaryWindows.open('settings', 'settings', '设置'));
  const settings = await opened;
  await expect(settings.locator('.settings-windowed')).toBeVisible();
  const actions = settings.locator('.desktop-window-actions');
  await expect(actions.getByRole('button')).toHaveCount(3);
  await expect(actions).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(settings.locator('.desktop-window-titlebar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const closeWindow = actions.getByRole('button', { name: '关闭窗口', exact: true });
  await expect(closeWindow).toBeVisible();
  await closeWindow.hover();
  await expect(closeWindow).toHaveCSS('background-color', 'rgb(217, 45, 32)');
  await expect(settings.getByRole('button', { name: '关闭设置', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: '作为标签页打开', exact: true })).toHaveCount(0);
  await settings.getByRole('combobox', { name: '显示模式', exact: true }).selectOption('dark');
  for (const target of [page, child, settings]) {
    await expect(target.locator('html')).toHaveAttribute('data-theme', 'dark');
  }
  await settings.getByRole('button', { name: '增大可视化编辑字号', exact: true }).click();
  for (const target of [page, child]) {
    await expect(target.locator('.ProseMirror')).toHaveCSS('font-size', '17px');
  }
  await settings.locator('.settings-nav button').filter({ hasText: /^基本设置$/ }).click();
  await settings.getByRole('textbox', { name: '工作区名称', exact: true }).fill('Shared window settings');
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开文件夹：Shared window settings', exact: true })).toBeVisible();
  await settings.locator('.settings-nav button').filter({ hasText: /^编辑器$/ }).click();
  await settings.getByRole('combobox', { name: '默认复制格式', exact: true }).selectOption('text');
  expect(await page.evaluate(() => [...window.workbench.paneEditors.values()].map(editor => editor.$props.preferences.copyFormat))).toEqual(['text', 'text']);
  await settings.locator('.settings-nav button').filter({ hasText: /^快捷键$/ }).click();
  const sourceBinding = settings.getByRole('button', { name: '设置切换源码模式快捷键', exact: true });
  await sourceBinding.click();
  await sourceBinding.press('Alt+e');
  await expect(sourceBinding).toContainText('Alt+E');
  await page.evaluate(() => window.workbench.auxiliaryWindows.close('settings'));
  await page.evaluate(() => {
    window.workbench.activeWindow = window.workbench.auxiliaryWindows.entries.get('settings-target').context;
    window.workbench.openSettings('workspace');
  });
  await expect(child.getByRole('textbox', { name: '工作区名称', exact: true })).toHaveValue('Shared window settings');
  await child.getByRole('button', { name: '关闭设置', exact: true }).click();
  for (const target of [page, child]) {
    await target.locator('.ProseMirror').click();
    await target.keyboard.press('Alt+e');
    await expect(target.locator('.cm-content')).toBeVisible();
    await target.keyboard.press('Alt+e');
    await expect(target.locator('.ProseMirror')).toBeVisible();
  }
  const reopened = page.waitForEvent('popup');
  await page.evaluate(() => window.workbench.auxiliaryWindows.open('settings', 'settings', '设置'));
  const settingsAgain = await reopened;
  await page.evaluate(() => window.workbench.auxiliaryWindows.open('settings', 'settings', '设置'));
  expect(await page.evaluate(() => [...window.workbench.auxiliaryWindows.entries.values()].filter(entry => entry.kind === 'settings').length)).toBe(1);
  await page.evaluate(() => window.workbench.auxiliaryWindows.closeAll());
  await expect.poll(() => child.isClosed() && settingsAgain.isClosed()).toBe(true);
});

test('source history and selection survive a window move', async ({ page }) => {
  await prepare(page);
  const child = await openDocumentWindow(page, 'source-state', 'Source original\n');
  await child.getByRole('button', { name: '切换源码模式', exact: true }).click();
  const source = child.locator('.cm-content');
  await source.click();
  await child.keyboard.press('Control+End');
  await child.keyboard.type('source draft');
  await expect(source).toContainText('source draft');
  const selection = await page.evaluate(() => {
    const paneId = window.workbench.store.windowLayouts['source-state'].activePaneId;
    return window.workbench.paneSourceEditors.get(paneId).captureModeSelection();
  });
  await page.evaluate(() => {
    const { store } = window.workbench;
    const tab = store.windowLayouts['source-state'].layout.activeId;
    store.moveTabToWindow(tab, 'main', { paneId: store.windowLayouts.main.activePaneId, side: 'center' });
  });
  await expect(page.locator('.cm-content')).toContainText('source draft');
  await expect.poll(() => page.evaluate(() => window.workbench.paneSourceEditors.get(window.workbench.store.windowLayouts.main.activePaneId)?.captureModeSelection())).toEqual(selection);
  await page.locator('.cm-content').press('Control+z');
  await expect(page.locator('.cm-content')).not.toContainText('source draft');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.cm-content')).toContainText('source draft');
  await expect.poll(() => child.isClosed()).toBe(true);
});

for (const kind of ['table', 'graph', 'calendar', 'settings']) {
  test(`${kind} tabs render in the shared auxiliary workbench and return to main`, async ({ page }) => {
    await prepare(page);
    const opened = page.waitForEvent('popup');
    await page.evaluate(async kind => {
      const { store, auxiliaryWindows } = window.workbench;
      if (kind === 'table') await store.createDataTable();
      if (kind === 'graph') await store.openGraphTab();
      if (kind === 'calendar') store.openCalendarTab();
      if (kind === 'settings') store.openViewTab('view:settings');
      window.movedViewId = store.activeId;
      await auxiliaryWindows.open(`view-${kind}`, 'tab', kind, undefined, () =>
        store.moveTabToAuxiliaryWindow(window.movedViewId, `view-${kind}`));
    }, kind);
    const child = await opened;
    const selectors = { table: '.data-grid', graph: '.relation-graph', calendar: '.calendar-view', settings: '.settings-tabbed' };
    await expect(child.locator(selectors[kind]).first()).toBeVisible();
    await page.evaluate(() => {
      const { store } = window.workbench;
      store.moveTabToWindow(window.movedViewId, 'main', { paneId: store.windowLayouts.main.activePaneId, side: 'center' });
    });
    await expect(page.locator(selectors[kind]).first()).toBeVisible();
    await expect.poll(() => child.isClosed()).toBe(true);
  });
}
