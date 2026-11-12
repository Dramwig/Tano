import { test, expect } from '@playwright/test';

test('shows current guidance, respects demo limits, and preserves existing progress', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('tano.preference.locale', 'zh-CN');
    localStorage.setItem('tano.preference.helpChecklist.v2.document', '1');
    localStorage.setItem('tano.preference.helpLesson.v1.document', JSON.stringify({ stage: 'assistant', first: 'assistant' }));
  });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('帮助引导验收.md', false, '# 帮助引导\n\n记录一些想法。');
  });
  await page.getByRole('button', { name: '帮助与上手', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '帮助与上手', exact: true });
  await expect(panel).toContainText('与助手一起工作');
  await expect(panel).toContainText('带着参考内容提问');
  await expect(panel).not.toContainText('配置模型连接');
  // The demo has neither file duplication nor configurable model connections.
  await expect(panel.locator('.help-preview-heading')).toContainText('/54');
  await expect(panel.getByRole('link', { name: '打开同页助手', exact: true })).toHaveAttribute('href', /\/docs\/assistant$/);
  expect(await page.evaluate(() => localStorage.getItem('tano.preference.helpChecklist.v2.document'))).toBe('1');
  await page.screenshot({ path: testInfo.outputPath('help-guidance.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    store.workspace.readOnly = true;
    localStorage.setItem('tano.preference.helpLesson.v1.document', JSON.stringify({ stage: 'organize', first: 'create-folder' }));
  });
  await page.getByRole('button', { name: '帮助与上手', exact: true }).click();
  await expect(panel).toContainText('打开文件夹首页');
  await expect(panel).not.toContainText('新建子文档');
  await expect(panel).not.toContainText('创建分类文件夹');
  await expect(panel.locator('.help-preview-heading')).not.toContainText('/54');
});
