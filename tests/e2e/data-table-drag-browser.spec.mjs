import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';

test('column previews follow pointer frames without rerendering the table', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    const id = await store.createDataTable();
    store.editDataTable(id, table => {
      table.fields = ['name', 'tags', 'done', 'status'].map(id => ({ id, name: id, type: 'text' }));
      table.rows = Array.from({ length: 100 }, (_, index) => ({ id: `row${index}`, values: { name: `记录 ${index}`, tags: '标签' } }));
      table.views[0].widths = { name: 230, tags: 110 };
    });
  });
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    return store.dataTableRecords.every(record => !record.saving && JSON.stringify(record.draft) === JSON.stringify(record.table));
  })).toBe(true);
  const grid = page.locator('.data-grid').first();
  const heading = grid.locator('th[data-field="name"] .data-field-heading');
  const source = await heading.boundingBox();
  const target = await grid.locator('th[data-field="done"]').boundingBox();
  const y = source.y + source.height / 2;
  await page.mouse.move(source.x + 30, y);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 20, y, { steps: 10 });
  const preview = page.locator('.data-column-drag-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('textarea').first()).toHaveValue('记录 0');
  // A long table must not be copied into an offscreen drag surface.
  expect(await preview.locator('textarea').count()).toBeLessThan(await grid.locator('tbody textarea[aria-label="name"]').count());
  await page.evaluate(() => {
    let component = document.querySelector('.data-page').__vueParentComponent;
    while (!component.type.__file?.endsWith('/DataTablePage.vue')) component = component.parent;
    window.columnDragUpdates = 0;
    (component.u ??= []).push(() => window.columnDragUpdates++);
    window.columnCellMutations = 0;
    window.columnObserver = new MutationObserver(changes => window.columnCellMutations += changes.length);
    window.columnObserver.observe(document.querySelector('.data-grid'), { subtree: true, childList: true, attributes: true });
  });
  let previous;
  for (let step = 0; step < 12; step++) {
    await page.mouse.move(target.x + target.width - 20 + step, y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const transform = await preview.evaluate(element => element.style.transform);
    expect(transform).not.toBe(previous);
    previous = transform;
  }
  expect(await page.evaluate(() => ({ updates: window.columnDragUpdates, mutations: window.columnCellMutations })))
    .toEqual({ updates: 0, mutations: 0 });
  await page.evaluate(() => window.columnObserver.disconnect());
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect.poll(() => grid.locator('th[data-field]').evaluateAll(cells => cells.map(cell => cell.dataset.field)))
    .toEqual(['tags', 'done', 'name', 'status']);
  await expect(page.locator('.field-menu')).toHaveCount(0);

  // Cancellation restores the cells without persisting a different order.
  const cancelSource = await grid.locator('th[data-field="tags"] .data-field-heading').boundingBox();
  await page.mouse.move(cancelSource.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(cancelSource.x + 80, y, { steps: 5 });
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  expect(await grid.locator('[data-field]').evaluateAll(cells => cells.some(cell => cell.style.transform || cell.style.opacity || cell.style.transition))).toBe(false);
  await expect.poll(() => grid.locator('th[data-field]').evaluateAll(cells => cells.map(cell => cell.dataset.field)))
    .toEqual(['tags', 'done', 'name', 'status']);
  // A normal click still opens field settings.
  await grid.locator('th[data-field="tags"] .data-field-heading').click();
  await expect(page.locator('.field-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('row previews animate vertically, cancel cleanly, and respect groups and sorting', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    window.rowTableId = await store.createDataTable();
    store.editDataTable(window.rowTableId, table => {
      table.fields = [{ id: 'name', name: '名称', type: 'text' }, { id: 'group', name: '分组', type: 'text' }];
      table.rows = Array.from({ length: 6 }, (_, index) => ({ id: `row${index}`, values: { name: `记录 ${index}`, group: index < 4 ? 'A' : 'B' } }));
    });
  });
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    return store.dataTableRecords.every(record => !record.saving && JSON.stringify(record.draft) === JSON.stringify(record.table));
  })).toBe(true);
  const grid = page.locator('.data-grid').first();
  const preview = page.locator('.data-row-drag-preview');
  const order = () => grid.locator('tr[data-row]').evaluateAll(rows => rows.map(row => row.dataset.row));
  async function drag(from, to, after = true) {
    const handle = await grid.locator(`tr[data-row="${from}"] .data-row-drag`).boundingBox();
    const target = await grid.locator(`tr[data-row="${to}"]`).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, target.y + target.height * (after ? .8 : .2), { steps: 12 });
    await expect(preview).toBeVisible();
    return handle.x + handle.width / 2;
  }
  const x = await drag('row0', 'row2');
  await expect(preview).toHaveCSS('background-color', await grid.locator('th[data-field]').first()
    .evaluate(cell => getComputedStyle(cell).backgroundColor));
  await expect(preview.locator('textarea').first()).toHaveValue('记录 0');
  await expect(preview.locator('textarea').nth(1)).toHaveValue('A');
  await expect.poll(() => grid.locator('tr[data-row="row1"]').evaluate(row => getComputedStyle(row).transform)).not.toBe('none');
  await page.screenshot({ path: `${tmpdir()}/tano-row-drag-preview.png`, clip: { x: 230, y: 210, width: 1190, height: 330 } });
  // Moving within one insertion slot must only animate the floating row.
  await page.evaluate(() => {
    window.rowMutations = 0;
    window.rowObserver = new MutationObserver(changes => {
      // Tooltip accessibility metadata does not rerender or reposition the grid.
      window.rowMutations += changes.filter(change => change.attributeName !== 'aria-describedby').length;
    });
    window.rowObserver.observe(document.querySelector('.data-grid'), { subtree: true, childList: true, attributes: true });
  });
  const slot = await grid.locator('tr[data-row="row3"]').boundingBox();
  // Use the original slot from the preview's current offset, independent of shifted row bounds.
  const y = slot.y - 3;
  await page.mouse.move(x, y);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { window.rowMutations = 0; });
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(x, y + i * .2);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  expect(await page.evaluate(() => window.rowMutations)).toBe(0);
  await page.evaluate(() => window.rowObserver.disconnect());
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect.poll(order).toEqual(['row1', 'row2', 'row0', 'row3', 'row4', 'row5']);
  await drag('row0', 'row1', false);
  await page.mouse.up();
  await expect.poll(order).toEqual(['row0', 'row1', 'row2', 'row3', 'row4', 'row5']);
  await drag('row0', 'row2');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect.poll(order).toEqual(['row0', 'row1', 'row2', 'row3', 'row4', 'row5']);
  expect(await grid.locator('tr[data-row]').evaluateAll(rows => rows.some(row => row.style.transform || row.style.opacity || row.style.transition))).toBe(false);
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    store.editDataTable(window.rowTableId, table => { table.views[0].groupBy = 'group'; });
  });
  await drag('row0', 'row4');
  await page.mouse.up();
  await expect.poll(order).toEqual(['row0', 'row1', 'row2', 'row3', 'row4', 'row5']);
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    store.editDataTable(window.rowTableId, table => { table.views[0].sorts = [{ field: 'name', direction: 'asc' }]; });
  });
  await expect(grid.locator('.data-row-drag').first()).toBeDisabled();
  expect(errors).toEqual([]);
});
