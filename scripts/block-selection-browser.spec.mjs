import { test, expect } from '@playwright/test';

const text = 'Prefix select these words suffix.';
const selected = 'select these words';

for (const [kind, block, target, backward] of [
  ['paragraph', text, '.ProseMirror > p'],
  ['paragraph backward', text, '.ProseMirror > p', true],
  ['heading', `## ${text}`, '.ProseMirror > h2'],
  ['list', `- ${text}\n- Another item`, '.ProseMirror li p'],
  ['table', `| Text |\n| --- |\n| ${text} |`, '.ProseMirror td p'],
]) {
  test(`dragging text in a selected ${kind} replaces the block selection`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://127.0.0.1:43845');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
    const markdown = `${block}\n\nOutside.\n`;
    await page.evaluate(async markdown => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
      await store.create('block-selection.md', false, markdown);
    }, markdown);
    const paragraph = page.locator(target).filter({ hasText: text }).first();
    await expect(paragraph).toBeVisible();
    await paragraph.hover();
    await page.locator('.tano-block-handle[data-block-depth="0"]').first().locator('.tano-block-handle-icon').click();
    await expect(page.locator('.block-context-menu')).toBeVisible();
    await expect(page.locator('.ProseMirror-selectednode')).toHaveCount(1);
    const points = await paragraph.evaluate((element, selected) => {
      const node = element.firstChild;
      const start = node.textContent.indexOf(selected);
      const point = offset => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y + rect.height / 2 };
      };
      return { start: point(start), end: point(start + selected.length) };
    }, selected);
    const from = backward ? points.end : points.start;
    const to = backward ? points.start : points.end;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
    await expect(page.locator('.ProseMirror-selectednode')).toHaveCount(0);
    await expect(page.locator('.block-context-menu')).toHaveCount(0);
    const content = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content);
    expect(await content()).toBe(markdown);
    await page.keyboard.type('replacement');
    await expect.poll(content).toContain(text.replace(selected, 'replacement'));
    expect(await content()).toContain('Outside.');
  });
}

const groupMarkdown = 'Before.\n\nFirst selected.\n\n> Quoted body.\n\n## Last selected\n\nAfter.\n';
const movedMarkdown = 'Before.\n\nAfter.\n\nFirst selected.\n\n> Quoted body.\n\n## Last selected\n';

async function openGroupDocument(page, markdown = groupMarkdown) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async markdown => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('block-group.md', false, markdown);
  }, markdown);
  const prose = page.locator('.ProseMirror');
  await expect(prose.locator(':scope > h2')).toHaveText('Last selected');
  return prose;
}

async function groupContent(page) {
  return page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content);
}

async function hoverGroupHandle(page, index) {
  const block = page.locator('.ProseMirror > *').nth(index);
  await block.scrollIntoViewIfNeeded();
  const bounds = await block.boundingBox();
  await page.mouse.move(bounds.x + 2, bounds.y + Math.min(2, bounds.height / 2));
  const handle = page.locator('.tano-block-handle[data-block-depth="0"]').nth(index);
  await expect(handle).toHaveClass(/is-visible/);
  return handle.locator('.tano-block-handle-icon');
}

async function clickGroupHandle(page, index, modifiers = []) {
  await (await hoverGroupHandle(page, index)).click({ modifiers });
}

for (const modifier of ['Control', 'Meta']) {
  test(`${modifier} toggles individual blocks, preserves Shift anchor, and can clear the selection`, async ({ page }) => {
    const prose = await openGroupDocument(page);
    await selectGroup(page, 'Shift');
    await clickGroupHandle(page, 2, [modifier]);
    await expect(prose.locator('.tano-block-selected')).toHaveCount(2);
    await expect(prose.locator(':scope > blockquote')).not.toHaveClass(/tano-block-selected/);
    expect(await prose.locator('blockquote p').evaluate(element => getComputedStyle(element, '::selection').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await clickGroupHandle(page, 2, [modifier]);
    await expect(prose.locator('.tano-block-selected')).toHaveCount(3);
    await clickGroupHandle(page, 4, ['Shift']);
    await expect(prose.locator('.tano-block-selected')).toHaveCount(4);
    for (const index of [2, 1, 4, 3]) await clickGroupHandle(page, index, [modifier]);
    await expect(prose.locator('.tano-block-selected, .ProseMirror-selectednode')).toHaveCount(0);
    await expect(page.locator('.block-context-menu')).toHaveCount(0);
    expect(await groupContent(page)).toBe(groupMarkdown);
    await clickGroupHandle(page, 1);
    await clickGroupHandle(page, 3, [modifier]);
    await expect(prose.locator('.tano-block-selected')).toHaveCount(2);
    await expect(page.locator('.block-context-menu')).toHaveCount(0);
    await clickGroupHandle(page, 1, [modifier]);
    await clickGroupHandle(page, 3, [modifier]);
    await clickGroupHandle(page, 2, [modifier]);
    await expect(prose.locator('.tano-block-selected')).toHaveCount(1);
    expect(await groupContent(page)).toBe(groupMarkdown);
  });
}

test('Ctrl selection drags only nonadjacent blocks and restores their gaps on undo', async ({ page }) => {
  const prose = await openGroupDocument(page);
  await selectGroup(page, 'Shift');
  await clickGroupHandle(page, 2, ['Control']);
  const handle = await (await hoverGroupHandle(page, 3)).boundingBox();
  const after = await prose.locator(':scope > p').filter({ hasText: 'After.' }).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(after.x + 100, after.y + after.height - 1, { steps: 20 });
  await expect(page.locator('.tano-block-drag-preview > *')).toHaveCount(2);
  await expect(prose.locator('.tano-block-drag-source')).toHaveCount(2);
  await page.mouse.up();
  await expect.poll(() => groupContent(page)).toBe('Before.\n\n> Quoted body.\n\nAfter.\n\nFirst selected.\n\n## Last selected\n');
  await page.keyboard.press('Control+z');
  await expect.poll(() => groupContent(page)).toBe(groupMarkdown);
});

test('deleting Ctrl-selected blocks preserves unselected blocks and undoes in one step', async ({ page }) => {
  await openGroupDocument(page);
  await clickGroupHandle(page, 1);
  await clickGroupHandle(page, 3, ['Control']);
  await page.keyboard.press('Backspace');
  await expect.poll(() => groupContent(page)).toBe('Before.\n\n> Quoted body.\n\nAfter.\n');
  await page.keyboard.press('Control+z');
  await expect.poll(() => groupContent(page)).toBe(groupMarkdown);
});

test('Ctrl can deselect a leaf block without selecting it again as the caret fallback', async ({ page }) => {
  await openGroupDocument(page);
  const markdown = '***\n\nOutside.\n';
  await page.evaluate(async markdown => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('block-atom.md', false, markdown);
  }, markdown);
  await expect(page.locator('.ProseMirror > hr')).toBeVisible();
  await page.locator('.ProseMirror > p').click();
  await clickGroupHandle(page, 0, ['Control']);
  await expect(page.locator('.tano-block-selected')).toHaveCount(1);
  await clickGroupHandle(page, 0, ['Control']);
  await expect(page.locator('.tano-block-selected, .ProseMirror-selectednode')).toHaveCount(0);
  expect(await groupContent(page)).toBe(markdown);
});

async function selectGroup(page, method) {
  const prose = page.locator('.ProseMirror');
  if (method === 'Shift') {
    await prose.locator(':scope > p').filter({ hasText: 'First selected.' }).hover();
    await page.locator('.tano-block-handle[data-block-depth="0"]').nth(1).locator('.tano-block-handle-icon').click();
    await prose.locator(':scope > h2').hover();
    await page.locator('.tano-block-handle[data-block-depth="0"]').nth(3).locator('.tano-block-handle-icon').click({ modifiers: ['Shift'] });
  } else {
    const first = await prose.locator(':scope > p').filter({ hasText: 'First selected.' }).boundingBox();
    const last = await prose.locator(':scope > h2').boundingBox();
    await page.mouse.move(first.x - 50, first.y - 3);
    await page.mouse.down();
    await page.mouse.move(first.x + 100, last.y + last.height - 1, { steps: 15 });
    await expect(page.locator('.tano-block-selection-box')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.tano-block-selection-box')).toBeHidden();
  }
  await expect(prose.locator('.tano-block-selected')).toHaveCount(3);
  await expect(page.locator('.block-context-menu')).toHaveCount(0);
  expect(await groupContent(page)).toBe(groupMarkdown);
  await page.mouse.move(10, 10);
  await expect(page.locator('.tano-block-handle.is-visible')).toHaveCount(0);
  await expect(prose.locator('.tano-block-selected')).toHaveCount(3);
}

for (const [kind, block] of [
  ['paragraph', 'Dragged paragraph.'],
  ['multiline paragraph', 'Dragged paragraph with enough words to wrap across several lines. '.repeat(12)],
  ['heading', '### Dragged heading'],
  ['quote', '> Dragged quote.'],
  ['table', '| Name | Value |\n| --- | --- |\n| A | 1 |'],
]) {
  test(`${kind} drag preview preserves the initial pointer offset`, async ({ page }) => {
    const markdown = `Before.\n\n${block}\n\n## Last selected\n\nAfter.\n`;
    const prose = await openGroupDocument(page, markdown);
    const handle = await (await hoverGroupHandle(page, 1)).boundingBox();
    const source = await prose.locator(':scope > *').nth(1).boundingBox();
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const copy = page.locator('.tano-block-drag-preview > *').first();
    for (const [dx, dy] of [[8, 6], [100, 80], [-10, 35]]) {
      await page.mouse.move(start.x + dx, start.y + dy);
      await expect(copy).toBeVisible();
      const preview = await copy.boundingBox();
      expect(preview.x - source.x).toBeCloseTo(dx, 0);
      expect(preview.y - source.y).toBeCloseTo(dy, 0);
      expect(await groupContent(page)).toBe(markdown);
    }
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.tano-block-drag-preview')).toHaveCount(0);
    expect(await groupContent(page)).toBe(markdown);
  });
}

for (const method of ['Shift', 'Control']) {
  test(`${method} group drag preserves the pointer offset of the grabbed block`, async ({ page }) => {
    const prose = await openGroupDocument(page);
    if (method === 'Shift') await selectGroup(page, method);
    else {
      await clickGroupHandle(page, 1);
      await clickGroupHandle(page, 3, ['Control']);
    }
    const index = method === 'Shift' ? 2 : 3;
    const handle = await (await hoverGroupHandle(page, index)).boundingBox();
    const source = await prose.locator(':scope > *').nth(index).boundingBox();
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const copy = page.locator('.tano-block-drag-preview > *').nth(1);
    for (const [dx, dy] of [[8, 6], [100, 80], [-10, 35]]) {
      await page.mouse.move(start.x + dx, start.y + dy);
      await expect(copy).toBeVisible();
      const preview = await copy.boundingBox();
      expect(preview.x - source.x).toBeCloseTo(dx, 0);
      expect(preview.y - source.y).toBeCloseTo(dy, 0);
      expect(await groupContent(page)).toBe(groupMarkdown);
    }
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.tano-block-drag-preview')).toHaveCount(0);
    expect(await groupContent(page)).toBe(groupMarkdown);
  });
}

for (const method of ['Shift', 'rectangle']) {
  test(`${method} selects heterogeneous blocks and drags them together in one undo step`, async ({ page }) => {
    const prose = await openGroupDocument(page);
    await selectGroup(page, method);
    const handle = await (await hoverGroupHandle(page, 2)).boundingBox();
    const after = await prose.locator(':scope > p').filter({ hasText: 'After.' }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(after.x + 100, after.y + after.height - 1, { steps: 20 });
    await expect(page.locator('.tano-block-drag-preview > *')).toHaveCount(3);
    await expect(prose.locator('.tano-block-drag-source')).toHaveCount(3);
    await page.mouse.up();
    await expect.poll(() => groupContent(page)).toBe(movedMarkdown);
    await expect(page.locator('.tano-block-drag-preview')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => groupContent(page)).toBe(groupMarkdown);
  });
}

for (const method of ['Shift', 'rectangle', 'Control', 'single']) {
  test(`${method} block selection clears on a blank gutter click without editing content`, async ({ page }) => {
    const prose = await openGroupDocument(page);
    if (method === 'Shift' || method === 'rectangle') await selectGroup(page, method);
    else {
      await clickGroupHandle(page, 1);
      if (method === 'Control') await clickGroupHandle(page, 3, ['Control']);
    }
    // A single block opens its menu to the left; use the blank area above it.
    const first = await prose.locator(':scope > p').filter({ hasText: method === 'single' ? 'Before.' : 'First selected.' }).boundingBox();
    await page.mouse.move(first.x - 80, first.y + first.height / 2);
    await page.mouse.down();
    // Tiny pointer jitter remains a click, not a rectangle selection.
    await page.mouse.move(first.x - 78, first.y + first.height / 2 + 1);
    await page.mouse.up();
    await expect(prose.locator('.tano-block-selected, .ProseMirror-selectednode')).toHaveCount(0);
    await expect(page.locator('.block-context-menu')).toHaveCount(0);
    await expect(page.locator('.tano-block-selection-box')).toBeHidden();
    expect(await groupContent(page)).toBe(groupMarkdown);
    await selectGroup(page, 'rectangle');
  });
}

for (const cover of [false, true]) {
  test(`marquee starts beside the page title and selects only body blocks${cover ? ' with a cover' : ''}`, async ({ page }) => {
    const markdown = (cover ? '---\ncover: tano:sky\n---\n' : '') + groupMarkdown;
    const prose = await openGroupDocument(page, markdown);
    const title = page.getByRole('textbox', { name: '文档标题', exact: true });
    const titleText = await title.inputValue();
    const bounds = await title.boundingBox();
    const first = await prose.locator(':scope > p').filter({ hasText: 'First selected.' }).boundingBox();
    await page.mouse.move(bounds.x - 80, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 120, bounds.y + bounds.height - 1, { steps: 10 });
    await expect(page.locator('.tano-block-selection-box')).toBeVisible();
    await expect(prose.locator('.tano-block-selected')).toHaveCount(0);
    await expect(title).not.toBeFocused();
    await page.mouse.move(first.x + 120, first.y + first.height - 1, { steps: 15 });
    await page.mouse.up();
    await expect(prose.locator('.tano-block-selected')).toHaveCount(2);
    await expect(page.locator('.document-title .tano-block-selected')).toHaveCount(0);
    await expect(page.locator('.tano-block-selection-box')).toBeHidden();
    await expect(title).toHaveValue(titleText);
    expect(await groupContent(page)).toBe(markdown);
    // Clicking the same title gutter clears the resulting selection.
    await page.mouse.click(bounds.x - 80, bounds.y + bounds.height / 2);
    await expect(prose.locator('.tano-block-selected')).toHaveCount(0);
    // The title remains an ordinary editable input, with native text selection.
    await title.dblclick();
    await expect(title).toBeFocused();
    expect(await title.evaluate(input => input.selectionEnd - input.selectionStart)).toBeGreaterThan(0);
    await expect(page.locator('.tano-block-selection-box')).toBeHidden();
    expect(await groupContent(page)).toBe(markdown);
  });
}

test('multi-block selection yields to text selection and Escape cancels a group drag', async ({ page }) => {
  const prose = await openGroupDocument(page);
  await selectGroup(page, 'Shift');
  const handle = await (await hoverGroupHandle(page, 1)).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 80, handle.y + 100, { steps: 10 });
  await expect(page.locator('.tano-block-drag-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.tano-block-drag-preview')).toHaveCount(0);
  expect(await groupContent(page)).toBe(groupMarkdown);
  await expect(prose.locator('.tano-block-selected')).toHaveCount(3);
  await prose.locator(':scope > p').filter({ hasText: 'First selected.' }).dblclick();
  await expect(prose.locator('.tano-block-selected')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).not.toBe('');
  expect(await groupContent(page)).toBe(groupMarkdown);
});

test('dropping a group inside itself or outside the editor leaves its content intact', async ({ page }) => {
  const prose = await openGroupDocument(page);
  await selectGroup(page, 'rectangle');
  for (const outside of [false, true]) {
    const handle = await (await hoverGroupHandle(page, 1)).boundingBox();
    const quote = await prose.locator('blockquote').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(outside ? 100 : quote.x + 100, quote.y + quote.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(page.locator('.tano-block-drag-preview')).toHaveCount(0);
    await expect(prose.locator('.tano-block-selected')).toHaveCount(3);
    expect(await groupContent(page)).toBe(groupMarkdown);
  }
  await page.keyboard.press('Escape');
  await expect(prose.locator('.tano-block-selected')).toHaveCount(0);
  expect(await groupContent(page)).toBe(groupMarkdown);
});
