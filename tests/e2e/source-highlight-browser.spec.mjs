import { test, expect } from '@playwright/test';

test('source highlighting runs in the real worker and applies patches, rapid edits and undo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.sourceWorkerState = { errors: [], replies: 0, patches: 0, partialReplies: 0 };
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('error', event => window.sourceWorkerState.errors.push(event.message));
        this.addEventListener('message', event => {
          if (event.data?.update) {
            window.sourceWorkerState.replies++;
            if (!event.data.update.full) window.sourceWorkerState.partialReplies++;
          }
        });
      }
      postMessage(data, ...args) {
        if (data?.changes && data.text === undefined) window.sourceWorkerState.patches++;
        return super.postMessage(data, ...args);
      }
    };
  });
  await page.goto(process.env.TANO_TEST_URL ?? 'http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  const text = '# 长文档\n\n输入位置\n\n' + '段落包含 **加粗**、==高亮==、&amp; 实体与 $x^2$。\n\n'.repeat(2000);
  await page.evaluate(async text => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('source-incremental.md', false, text);
  }, text);
  await expect(page.locator('.ProseMirror')).toContainText('输入位置');
  await page.getByRole('button', { name: '切换源码模式', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.sourceWorkerState.replies)).toBeGreaterThan(0);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.insertText('==新增高亮==');
  await expect(page.locator('.cm-source-highlight').filter({ hasText: '新增高亮' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.sourceWorkerState.patches)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.sourceWorkerState.partialReplies)).toBeGreaterThan(0);
  await page.keyboard.press('Control+z');
  const content = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content);
  await expect.poll(content).toBe(text);
  await expect(page.locator('.cm-source-highlight').filter({ hasText: '新增高亮' })).toHaveCount(0);
  await page.keyboard.type('==rapid== **bold**', { delay: 2 });
  await expect(page.locator('.cm-source-highlight').filter({ hasText: 'rapid' })).toBeVisible();
  await expect(page.locator('.cm-source-strong').filter({ hasText: 'bold' })).toBeVisible();
  expect(await page.evaluate(() => window.sourceWorkerState.errors)).toEqual([]);
  expect(errors).toEqual([]);
});
