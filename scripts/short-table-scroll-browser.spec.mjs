import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser = unified().use(remarkParse).use(remarkGfm);
const meaning = markdown => JSON.stringify(parser.parse(markdown), (key, value) => key === 'position' ? undefined : value);

test('short QA document keeps table controls aligned while scrolling and preserves editing and undo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  const markdown = await readFile(new URL('../markdown-test-workspace/en-US/00-getting-started.md', import.meta.url), 'utf8');
  await page.evaluate(async markdown => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('short-table-scroll.md', false, markdown);
  }, markdown);
  const prose = page.locator('.ProseMirror');
  const table = prose.locator('table').first();
  await expect(prose.locator('table')).toHaveCount(2);
  await table.evaluate(table => {
    const scroll = table.closest('.document-layout');
    scroll.scrollTop += table.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 150;
  });
  await table.locator('tr').nth(2).locator('td').last().hover();
  const insertion = page.locator('.tano-table-insert.is-row[data-index="3"]');
  await expect(insertion).toBeVisible();
  const checkAlignment = () => expect.poll(async () => {
    const boundary = await table.locator('tr').nth(3).evaluate(row => row.getBoundingClientRect().top);
    const top = await insertion.evaluate(button => button.getBoundingClientRect().top);
    return Math.abs(top + 12 - boundary);
  }).toBeLessThan(1);
  for (const delta of [80, -40, 120, -160]) {
    await page.locator('.document-layout').evaluate((scroll, delta) => { scroll.scrollTop += delta; }, delta);
    await checkAlignment();
  }
  // A new width changes cell wrapping and row heights. The following scroll
  // must use a fresh layout snapshot, even without moving the pointer first.
  await page.setViewportSize({ width: 1050, height: 900 });
  await checkAlignment();
  await page.locator('.document-layout').evaluate(scroll => { scroll.scrollTop += 60; });
  await checkAlignment();
  const content = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content);
  expect(await content()).toBe(markdown);
  const rows = await table.locator('tr').count();
  await insertion.click();
  await expect(table.locator('tr')).toHaveCount(rows + 1);
  await expect.poll(content).not.toBe(markdown);
  await page.keyboard.press('Control+z');
  await expect(table.locator('tr')).toHaveCount(rows);
  // Editing serializes tables with aligned padding; undo restores their
  // complete contents and structure rather than their original whitespace.
  await expect.poll(async () => meaning(await content())).toBe(meaning(markdown));
  expect(errors).toEqual([]);
});

test('table row and column grips keep their drag targets after scrolling', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const markdown = '# Table handles\n\n| A | B | C |\n| --- | --- | --- |\n| alpha | beta | gamma |\n| one | two | three |\n| red | green | blue |\n\n' + '后续正文。\n\n'.repeat(50);
    await store.create('table-grip-scroll.md', false, markdown);
  });
  const table = page.locator('.ProseMirror table');
  await expect(table).toBeVisible();
  const matrix = () => table.evaluate(table => [...table.rows].map(row => [...row.cells].map(cell => cell.textContent)));
  const original = await matrix();
  await page.locator('.document-layout').evaluate(scroll => { scroll.scrollTop = 80; });
  await table.locator('tr').nth(1).locator('td').first().hover();
  const rowGrip = page.locator('.tano-table-grip.is-row');
  await expect(rowGrip).toBeVisible();
  const row = await rowGrip.boundingBox();
  const destination = await table.locator('tr').nth(3).boundingBox();
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x + row.width / 2, destination.y + destination.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(matrix).toEqual([original[0], original[2], original[3], original[1]]);
  await page.keyboard.press('Control+z');
  await expect.poll(matrix).toEqual(original);
  await table.locator('tr').nth(1).locator('td').first().hover();
  await rowGrip.click();
  await expect(page.locator('.tano-table-menu')).toBeVisible();
  await page.locator('.document-layout').evaluate(scroll => { scroll.scrollTop += 40; });
  await expect(page.locator('.tano-table-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tano-table-menu')).toBeHidden();
  await table.locator('tr').nth(1).locator('td').first().hover();
  const columnGrip = page.locator('.tano-table-grip.is-column');
  await expect(columnGrip).toBeVisible();
  const column = await columnGrip.boundingBox();
  const last = await table.locator('tr').first().locator('th').last().boundingBox();
  await page.mouse.move(column.x + column.width / 2, column.y + column.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, column.y + column.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(matrix).toEqual(original.map(row => [row[1], row[2], row[0]]));
  await page.keyboard.press('Control+z');
  await expect.poll(matrix).toEqual(original);
  expect(errors).toEqual([]);
});
