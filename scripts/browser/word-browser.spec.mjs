import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('system Word viewer renders source layout offline and keeps controls in the breadcrumb', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [], network = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:43845');
  await expect.poll(() => page.evaluate(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.pluginRuntime.find(p => p.id === 'word-preview')?.status)).toBe('running');
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').openPluginView('word-preview', 'document'));
  const surface = page.locator('.plugin-surface[data-plugin="word-preview"]');
  const ui = surface.frameLocator('iframe[title="插件界面隔离容器"]').frameLocator('iframe[title="插件自定义界面"]');
  const toolbar = page.getByRole('toolbar', { name: 'Word 文档预览操作' });
  const more = toolbar.getByRole('button', { name: '预览操作', exact: true });
  const menu = page.getByRole('dialog', { name: '预览操作', exact: true });
  const openMenu = async () => { if (!await menu.isVisible()) await more.click(); };
  const choose = async file => { await openMenu(); await menu.getByLabel('打开 DOC/DOCX').setInputFiles(file); };
  await expect(toolbar).toBeVisible();
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:43845') && !/^(blob:|data:)/.test(request.url())) network.push(request.url()); });
  await expect(ui.locator('.preview-loading')).toBeHidden();
  await ui.locator('#app').evaluate(root => {
    window.previewLoadingPhases = [];
    new MutationObserver(() => {
      const text = root.querySelector('#status')?.textContent ?? '';
      if (text.startsWith('正在渲染')) window.previewLoadingPhases.push({ busy: root.getAttribute('aria-busy'), skeleton: !root.querySelector('.preview-loading').hidden });
    }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  });
  mkdirSync(resolve('artifacts/word-preview'), { recursive: true });
  for (const extension of ['doc', 'docx']) {
    await choose(resolve(`scripts/fixtures/word-preview/fixture.${extension}`));
    const headingText = extension === 'docx' ? 'Original Word layout' : 'This is a simple file created with Word 97-SR2.';
    await expect(ui.locator('#paper')).toContainText(headingText);
    await expect(ui.locator('#status')).toBeHidden({ timeout: 30000 });
    const statusIcon = page.locator('.breadcrumb .document-status-trigger');
    await expect(statusIcon).toBeVisible();
    const fileBounds = await page.locator('.breadcrumb-current').boundingBox();
    const iconBounds = await statusIcon.boundingBox();
    expect(iconBounds.x).toBeGreaterThanOrEqual(fileBounds.x + fileBounds.width - 1);
    expect(Math.abs(iconBounds.y + iconBounds.height / 2 - fileBounds.y - fileBounds.height / 2)).toBeLessThan(4);
    await expect(ui.locator('#app > footer')).toHaveCount(0);
    await statusIcon.hover();
    const infoPanel = page.locator('.document-status-panel');
    await expect(infoPanel).toContainText('渲染');
    await infoPanel.hover(); await expect(infoPanel).toBeVisible();
    await page.keyboard.press('Escape'); await expect(infoPanel).toBeHidden();
    await statusIcon.focus(); await expect(infoPanel).toBeVisible();
    await page.keyboard.press('Escape'); await expect(infoPanel).toBeHidden();

    const heading = ui.getByText(headingText, { exact: true });
    const style = await heading.evaluate(element => ({ color: getComputedStyle(element).color, fontStyle: getComputedStyle(element).fontStyle, fontSize: getComputedStyle(element).fontSize }));
    if (extension === 'docx') {
    expect(style.color).toBe('rgb(0, 128, 0)'); expect(style.fontStyle).toBe('italic'); expect(parseFloat(style.fontSize)).toBeCloseTo(32, 0);
    await expect(ui.locator('#paper table')).toHaveCount(1);
    await expect(ui.locator('#paper td[colspan="2"]')).toContainText('Merged cell');
    await expect(ui.locator('#paper img').first()).toBeVisible();
    } else { expect(await heading.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Times New Roman'); }
    const paperPage = ui.locator(extension === 'docx' ? 'section.docx' : '.word-legacy-page').first();
    const width = await paperPage.evaluate(element => element.offsetWidth);
    expect(width).toBeCloseTo(extension === 'docx' ? 800 : 816, 0);
    await expect(page.locator('.breadcrumb-current').filter({ hasText: `fixture.${extension}` })).toBeVisible();
    await openMenu();
    const before = await paperPage.boundingBox();
    await menu.getByRole('button', { name: '放大', exact: true }).click();
    await expect.poll(async () => (await paperPage.boundingBox()).width).toBeGreaterThan(before.width);
    await menu.getByRole('button', { name: '适应宽度' }).click();
    await page.keyboard.press('Escape'); await expect(more).toBeFocused();
    await page.screenshot({ animations: 'disabled', path: resolve(`artifacts/word-preview/${extension}-desktop.png`) });
  }
  await expect(ui.locator('section.docx')).toHaveCount(3);
  await expect(ui.locator('section.docx').first()).toContainText('Source header');
  await expect(ui.locator('section.docx').first()).toContainText('Source footer');
  expect(await ui.locator('section.docx').last().evaluate(element => element.offsetWidth)).toBeCloseTo(533, 0);
  await toolbar.getByRole('button', { name: '下一页' }).click();
  await expect(toolbar.locator('.plugin-view-position')).toHaveText('2 / 3');
  await ui.locator('main').focus(); await page.keyboard.press('End');
  await expect(toolbar.locator('.plugin-view-position')).toHaveText('3 / 3');
  await page.keyboard.press('Home');
  await expect(toolbar.locator('.plugin-view-position')).toHaveText('1 / 3');
  await page.locator('body').press('Control+b'); await page.setViewportSize({ width: 390, height: 844 });
  await expect(ui.locator('section.docx')).toHaveCount(3);
  await expect(ui.getByText('Original Word layout', { exact: true })).toBeVisible();
  await openMenu();
  const bounds = await menu.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ animations: 'disabled', path: resolve('artifacts/word-preview/docx-mobile.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(async ({ bytes, runtimePath }) => {
    const app = document.querySelector('#app').__vue_app__, store = app.config.globalProperties.$pinia._s.get('workspace');
    const { useWorkbenchRuntime } = await import(runtimePath);
    const runtime = app.runWithContext(() => useWorkbenchRuntime());
    runtime.attachments = { readAttachment: () => new Promise(resolve => { window.releasePreviewRead = () => resolve(new Uint8Array(bytes)); }) };
    await runtime.adapter.create('workspace.docx', 'fixture'); await store.refresh();
    void store.openAttachmentInNewTab(store.workspace.files.find(file => file.path === 'workspace.docx'));
  }, { bytes: [...readFileSync(resolve('scripts/fixtures/word-preview/fixture.docx'))], runtimePath: `/@fs/${resolve('packages/workbench/src/runtime.ts').replaceAll('\\', '/')}` });
  await expect(ui.locator('.preview-loading')).toBeVisible();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'true');
  await expect(ui.locator('#paper')).toBeEmpty();
  const viewportBefore = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ animations: 'disabled', path: resolve('artifacts/word-preview/loading-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  const skeletonBounds = await ui.locator('.loading-paper').first().boundingBox();
  expect(skeletonBounds.x).toBeGreaterThanOrEqual(0);
  expect(skeletonBounds.x + skeletonBounds.width).toBeLessThanOrEqual(390);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await ui.locator('.loading-title').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.screenshot({ animations: 'disabled', path: resolve('artifacts/word-preview/loading-mobile.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize(viewportBefore);

  await page.evaluate(() => window.releasePreviewRead());
  await expect(ui.locator('.preview-loading')).toBeHidden();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false');
  expect(await ui.locator('#app').evaluate(() => window.previewLoadingPhases.some(phase => phase.busy === 'true' && phase.skeleton))).toBe(true);

  await expect(ui.locator('#status')).toBeHidden();
  await expect(page.locator('.breadcrumb-current').filter({ hasText: 'workspace.docx' })).toBeVisible();
  await expect(ui.locator('#paper')).toContainText('Portrait section');
  if (process.env.TANO_WORD_SAMPLE) {
    await choose(process.env.TANO_WORD_SAMPLE);
    await expect(ui.locator('#status')).toBeHidden({ timeout: 30000 });
    await expect(ui.locator('section.docx').first()).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: resolve('artifacts/word-preview/local-sample.png') });
  }
  await choose({ name: 'broken.doc', mimeType: 'application/msword', buffer: Buffer.from('invalid') });
  await expect(ui.getByRole('status')).toContainText('不是有效');
  await expect(ui.locator('.preview-loading')).toBeHidden();
  await expect(ui.locator('#app')).toHaveAttribute('aria-busy', 'false'); await expect(ui.locator('#paper')).toBeEmpty();
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.changePlugin({ id: 'word-preview', enabled: false }, store.workspace.id);
    await store.openAttachmentInNewTab(store.workspace.files.find(file => file.path === 'workspace.docx'));
  });
  await expect(page.getByText('请在插件中启用系统插件「Word 文档预览」，然后重新打开文件。')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(network).toEqual([]); expect(errors).toEqual([]);
});
