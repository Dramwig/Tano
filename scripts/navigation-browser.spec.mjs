import { test, expect } from '@playwright/test';

test('workspace browsing preserves content and assistant drafts across entry points', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  const editor = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  await expect(editor).toBeVisible();
  const original = page.url();
  await page.getByRole('button', { name: '切换侧边栏视图：文件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '事件与任务', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(page.url()).toBe(original);
  await expect(page.getByRole('button', { name: '计划范围', exact: true })).toBeDisabled();
  await page.locator('.sidebar-navigation').getByRole('button', { name: '计划', exact: true }).click();
  await expect(page.locator('.plan-view-trigger')).toHaveText('个人');
  await expect(editor).toBeVisible();
  expect(page.url()).toBe(original);
  await expect(page.locator('.sidebar-view-header')).toBeHidden();
  await page.locator('.sidebar-navigation').getByRole('button', { name: '工作区', exact: true }).click();
  await page.getByRole('button', { name: '切换侧边栏视图：事件与任务', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '助手', exact: true }).click();
  await page.locator('.assistant-navigation-new').click();
  await page.locator('.assistant-panel textarea').fill('尚未发送的助手草稿');
  await page.getByRole('button', { name: '切换侧边栏视图：助手', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '文件', exact: true }).click();
  await page.locator('.tree-row[title^="01-"]').click();
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: '切换侧边栏视图：文件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '助手', exact: true }).click();
  await page.locator('.assistant-navigation-session').first().click();
  await expect(page.locator('.assistant-panel textarea')).toHaveValue('尚未发送的助手草稿');
  expect(errors).toEqual([]);
});

test('mobile assistant can reopen navigation and return to a document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换侧边栏视图：文件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '助手', exact: true }).click();
  await page.locator('.assistant-navigation-new').click();
  await expect(page.locator('.assistant-panel textarea')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '工作区侧栏', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换侧边栏视图：助手', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '文件', exact: true }).click();
  await page.locator('.tree-row[title^="01-"]').click();
  await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test('module navigation keeps the main content until a sidebar item is opened', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TANO_NAV_TEST_URL || 'http://127.0.0.1:43845');
  const nav = page.locator('.sidebar-navigation');
  const editor = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  await expect(editor).toBeVisible();
  const original = page.url();
  const messages = nav.getByRole('button', { name: '消息', exact: true });
  if (await messages.count()) {
    await messages.click();
    await expect(page.locator('.chat-sidebar')).toBeVisible();
    await expect(editor).toBeVisible();
    expect(page.url()).toBe(original);
  }
  await nav.getByRole('button', { name: '计划', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(page.url()).toBe(original);
  await page.locator('#sidebar-plan-panel .sidebar-calendar-day').first().click();
  const calendar = page.locator('.calendar-view');
  await expect(calendar).toBeVisible();
  const content = await calendar.textContent();
  const calendarUrl = page.url();
  await nav.getByRole('button', { name: '工作区', exact: true }).click();
  await page.getByRole('button', { name: '切换侧边栏视图：文件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '事件与任务', exact: true }).click();
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveText(content);
  if (await messages.count()) {
    await messages.click();
    await expect(calendar).toBeVisible();
    await expect(calendar).toHaveText(content);
  }
  expect(page.url()).toBe(calendarUrl);
  // Logged-out previews have no account conversations to open.
  if (await page.locator('.chat-list-item').count()) {
    await page.locator('.chat-list-item').first().click();
    await expect(calendar).toBeHidden();
    const chatUrl = page.url();
    await nav.getByRole('button', { name: '工作区', exact: true }).click();
    expect(page.url()).toBe(chatUrl);
    await expect(calendar).toBeHidden();
  }
  expect(errors).toEqual([]);
});
