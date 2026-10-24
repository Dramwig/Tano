import { test, expect } from '@playwright/test';

for (const kind of ['task', 'event']) test(`selection creates ${kind} and returns to source after reload`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (kind === 'event') await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.TANO_PLAN_TEST_URL || 'http://127.0.0.1:43845');
  const editor = page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Follow up the meeting');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '更多格式', exact: true }).click();
  await page.getByRole('button', { name: '从选区创建任务或事件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从选区创建任务或事件', exact: true });
  await expect(dialog).toContainText('归属工作区：');
  if (kind === 'event') {
    await dialog.getByRole('combobox', { name: '类型' }).selectOption('event');
    await dialog.getByRole('button', { name: '时间安排', exact: true }).click();
    await dialog.getByRole('menuitemradio', { name: '计划日期', exact: true }).click();
    await dialog.locator('input[type=date]').fill('2026-10-23');
  }
  await page.screenshot({ path: process.env.TEMP + `/tano-selection-${kind}-dialog.png` });
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(editor.locator('.tano-reference')).toHaveCount(1);
  await page.reload();
  await expect(editor).toBeVisible();
  await editor.locator('.tano-reference button').click({ modifiers: ['Control'] });
  const detail = page.getByRole('dialog', { name: kind === 'task' ? '任务详情' : '事件详情', exact: true });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '返回原文选区', exact: true }).click();
  await expect(detail).toBeHidden();
  await expect(editor.locator('.tano-reference-flash')).toHaveText('Follow up the meeting');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: process.env.TEMP + `/tano-selection-${kind}.png` });
});
