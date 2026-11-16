import { test, expect } from '@playwright/test';

test('keeps drafts and document navigation working after workbench hot reloads', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toBeVisible();

  for (let iteration = 0; iteration < 2; iteration++) {
    const draft = `热更新后保留的草稿 ${iteration}`;
    await page.evaluate(draft => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      store.edit(`${store.active.content}\n\n${draft}\n`);
      let component = document.querySelector('.workspace-layout').__vueParentComponent;
      while (component && !component.type.__file?.endsWith('/App.vue')) component = component.parent;
      window.__VUE_HMR_RUNTIME__.reload(component.type.__hmrId, component.type);
    }, draft);
    await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toContainText(draft);
    await page.locator('.tree-row[title="01-基础块与行内.md"]').click();
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active?.path,
    )).toBe('01-基础块与行内.md');
    await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toContainText('行内');
    await page.locator('.tree-row[title="00-从这里开始.md"]').click();
    await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toContainText(draft);
  }
  expect(errors).toEqual([]);
});
