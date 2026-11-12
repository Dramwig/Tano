import { expect, test } from '@playwright/test';

// Browser plugin not available. Exercise the product's normal @ and send controls with Playwright.
test('dispatches document and discussion mentions in the background and preserves replies on reload', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { if (window.top === window) localStorage.setItem('tano.preference.locale', 'zh-CN'); });
  await page.goto('http://127.0.0.1:43845');
  await expect(page).toHaveTitle(/Tano|同页/);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const workspace = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await workspace.create('机器人测试.md', false, '# 机器人测试\n\n请总结这段内容。\n');
  });
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').objects
    .some(item => item.object.properties.memberKind === 'agent'));
  const editor = page.locator('.milkdown-host .ProseMirror').first();
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' @');
  await page.getByRole('option').filter({ hasText: '浏览器模拟' }).click();
  await page.keyboard.press('ControlOrMeta+s');
  const inboxTasks = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('tano.assistant-demo.v1.inbox.'));
    return key ? JSON.parse(localStorage.getItem(key)).tasks : [];
  });
  await expect.poll(async () => (await inboxTasks()).find(task => task.event.source.kind === 'document')?.status, { timeout: 30000 }).toBe('succeeded');
  await expect(page.locator('.annotation-card, .annotation-count').first()).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await page.getByRole('button', { name: '发起讨论', exact: true }).click();
  const input = page.getByRole('textbox', { name: '添加评论', exact: true });
  await input.fill('@');
  await page.locator('.comment-people button').filter({ hasText: '浏览器模拟' }).click();
  await input.press('End');
  await input.pressSequentially('请总结本文');
  await input.press('Enter');
  await expect.poll(async () => (await inboxTasks()).find(task => task.event.source.kind === 'discussion')?.status, { timeout: 30000 }).toBe('succeeded');
  await expect(page.locator('.document-discussion-messages')).toContainText('浏览器模拟', { timeout: 10000 });
  await page.locator('.document-discussion-messages .comment-message').first().hover();
  await page.locator('.document-discussion-messages .comment-message').first().getByRole('button', { name: '更多评论操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  const editing = page.getByRole('textbox', { name: '编辑评论', exact: true });
  await editing.fill('@');
  await page.locator('.comment-people button').filter({ hasText: '浏览器模拟' }).click();
  await editing.press('End'); await editing.pressSequentially('继续总结本文');
  await page.getByRole('button', { name: '确认编辑', exact: true }).click();
  await expect.poll(async () => (await inboxTasks()).filter(task => task.event.source.kind === 'discussion' && task.status === 'succeeded').length,
    { timeout: 30000 }).toBe(2);
  const ids = (await inboxTasks()).map(task => task.id);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '打开同页助手', exact: true }).click();
  const inbox = page.locator('.agent-inbox');
  await inbox.locator(':scope > summary').click();
  await expect(inbox.locator('ol > li')).toHaveCount(3);
  await inbox.getByRole('button', { name: '执行记录', exact: true }).first().click();
  await expect(inbox.getByRole('region', { name: '执行记录' })).toContainText('机器人');
  await page.screenshot({ path: testInfo.outputPath('agent-mentions.png'), fullPage: false });
  await page.reload();
  await expect(page.locator('.ProseMirror').first()).toBeVisible();
  await expect.poll(async () => (await inboxTasks()).map(task => task.id)).toEqual(ids);
  expect(errors).toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
