import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ locale: 'zh-CN' });

test('file tree switches between Markdown and Office previews in the current tab', async ({ page }) => {
  await page.route('**/use-workbench.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tabsEnabled = native && !mobile;', 'const tabsEnabled = true;') });
  });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto('http://127.0.0.1:43845');
  await expect(page.locator('.tree-row').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    ._s.get('workspace').pluginRuntime.filter(plugin =>
      ['word-preview', 'presentation-preview'].includes(plugin.id) && plugin.status === 'running').length)).toBe(2);
  const fixtures = {
    'report.docx': [...readFileSync(resolve('tests/fixtures/word-preview/fixture.docx'))],
    'legacy.doc': [...readFileSync(resolve('tests/fixtures/word-preview/fixture.doc'))],
    'slides.pptx': [...readFileSync(resolve('tests/fixtures/presentation-preview/fixture.pptx'))],
  };
  const ids = await page.evaluate(async ({ fixtures, runtimePath }) => {
    const app = document.querySelector('#app').__vue_app__;
    const store = app.config.globalProperties.$pinia._s.get('workspace');
    const { useWorkbenchRuntime } = await import(runtimePath);
    const runtime = app.runWithContext(() => useWorkbenchRuntime());
    runtime.attachments = { readAttachment: async (_workspaceId, path) => Uint8Array.from(fixtures[path]) };
    for (const path of Object.keys(fixtures)) await runtime.adapter.create(path, 'fixture');
    await runtime.adapter.create('navigation.md', '# Navigation test');
    await store.refresh();
    return Object.fromEntries(store.workspace.files.map(file => [file.path, file.id]));
  }, { fixtures, runtimePath: `/@fs/${resolve('packages/workbench/src/runtime.ts').replaceAll('\\', '/')}` });
  const tabs = page.locator('.desktop-tab');
  const entry = path => page.locator(`.tree-row[data-entry-id="${ids[path]}"]`);
  await entry('navigation.md').click();
  await expect(page.getByRole('heading', { name: 'Navigation test' })).toBeVisible();
  const tabCount = await tabs.count();
  expect(tabCount).toBeGreaterThan(0);

  const preview = plugin => page.locator(`.plugin-surface[data-plugin="${plugin}"]`)
    .frameLocator('iframe[title="插件界面隔离容器"]').frameLocator('iframe[title="插件自定义界面"]');
  const word = preview('word-preview').locator('#paper');
  const slide = preview('presentation-preview').locator('#paper svg');
  await entry('report.docx').click();
  await expect(word).toContainText('Original Word layout');
  await expect(tabs).toHaveCount(tabCount);
  await entry('legacy.doc').click();
  await expect(word).toContainText('This is a simple file created with Word 97-SR2.');
  await expect(tabs).toHaveCount(tabCount);
  await entry('slides.pptx').click();
  await expect(slide).toBeVisible();
  await expect(tabs).toHaveCount(tabCount);
  await entry('navigation.md').click();
  await expect(page.getByRole('heading', { name: 'Navigation test' })).toBeVisible();
  await expect(tabs).toHaveCount(tabCount);

  const navigate = direction => page.evaluate(direction =>
    document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').navigateHistory(direction), direction);
  await navigate(-1);
  await expect(slide).toBeVisible();
  await navigate(-1);
  await expect(word).toContainText('This is a simple file created with Word 97-SR2.');
  await navigate(-1);
  await expect(word).toContainText('Original Word layout');
  await navigate(1);
  await expect(word).toContainText('This is a simple file created with Word 97-SR2.');
  await navigate(1);
  await expect(slide).toBeVisible();
  await expect(tabs).toHaveCount(tabCount);

  await entry('navigation.md').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '在新标签页中打开' }).click();
  await expect(page.getByRole('heading', { name: 'Navigation test' })).toBeVisible();
  await expect(tabs).toHaveCount(tabCount + 1);
  expect(pageErrors).toEqual([]);
});
