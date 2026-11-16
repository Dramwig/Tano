import { expect, test } from '@playwright/test';

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
    const key = Reflect.ownKeys(component.provides).find(key => key.description === 'tano-workbench');
    window.workbench = component.provides[key];
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

test('settings edits update the actual main and auxiliary editors immediately', async ({ page }) => {
  await prepare(page);
  const child = await openDocumentWindow(page, 'settings-target', 'Auxiliary document\n');
  await page.locator('.tree-row[title="Main.md"]').click();
  const opened = page.waitForEvent('popup');
  await page.evaluate(() => window.workbench.auxiliaryWindows.open('settings', 'settings', '设置'));
  const settings = await opened;
  await expect(settings.locator('.settings-windowed')).toBeVisible();
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
