import { expect, test } from '@playwright/test';

const selected = '选中文字';
const markdown = `# 工具栏测试\n\n前文${selected}后文。\n`;

test('restores selection toolbar on editor input when window focus was not delivered', async ({ page }) => {
  const toolbar = await prepare(page);
  await toolbar.getByRole('button', { name: '更多格式', exact: true }).click();
  // Model a desktop WebView returning input without the matching window.focus.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(toolbar).toBeHidden();
  const paragraph = page.locator('.ProseMirror p').first();
  const box = await paragraph.boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(toolbar).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).not.toBe('');
  await toolbar.getByRole('button', { name: '更多格式', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '脚注引用', exact: true })).toBeVisible();
});

async function prepare(page, mode = 'selection') {
  await page.addInitScript(mode => {
    localStorage.setItem('tano.preference.locale', 'zh-CN');
    localStorage.setItem('tano.preference.toolbarMode', mode);
  }, mode);
  await page.goto('http://127.0.0.1:43845');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async content => {
    const workspace = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await workspace.create('引用目标.md', false, '# 引用目标\n');
    await workspace.create('工具栏测试.md', false, content);
  }, markdown);
  const editor = page.locator('.milkdown-host').first();
  await expect(editor.locator('.ProseMirror')).toContainText(selected);
  await editor.evaluate((element, selection) => {
    let component = element.__vueParentComponent;
    while (!component.exposed?.restoreModeSelection) component = component.parent;
    component.exposed.restoreModeSelection(selection);
  }, { anchor: markdown.indexOf(selected), head: markdown.indexOf(selected) + selected.length });
  const toolbar = page.locator('.selection-toolbar');
  if (mode !== 'fixed') await toolbar.getByRole('button', { name: '更多格式', exact: true }).click();
  return toolbar;
}

for (const mode of ['selection', 'fixed', 'bottom', 'left', 'right']) {
  test(`${mode}: right click elsewhere preserves text and opens selection controls at pointer`, async ({ page }) => {
    const toolbar = await prepare(page, mode);
    const heading = page.locator('.ProseMirror h1').first();
    const box = await heading.boundingBox();
    const point = { x: box.x + box.width - 280, y: box.y + 10 };
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: '选区操作', exact: true });
    await expect(menu).toBeVisible();
    await expect(toolbar).toBeHidden();
    const rect = await menu.boundingBox();
    expect(Math.abs(rect.x - point.x)).toBeLessThan(2);
    expect(Math.abs(rect.y - point.y)).toBeLessThan(2);
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await expect(menu.locator('.menu-shortcut')).toHaveText(/Ctrl \+ C|⌘ \+ C/);
    await page.evaluate(() => { window.__copiedMarkdown = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedMarkdown = text; } } }); });
    if (mode === 'fixed') await menu.getByRole('menuitem', { name: '复制 Markdown', exact: true }).press('ControlOrMeta+c');
    else await menu.getByRole('menuitem', { name: '复制 Markdown', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__copiedMarkdown?.trim())).toBe(selected);
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content)).toBe(markdown);
  });
}

test('right click text menu only offers copy and Escape preserves content', async ({ page }) => {
  await prepare(page, 'fixed');
  const target = page.locator('.ProseMirror h1');
  await target.click({ button: 'right', position: { x: 300, y: 10 } });
  const menu = page.getByRole('menu', { name: '选区操作', exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await target.click({ button: 'right', position: { x: 300, y: 10 } });
  await expect(menu.getByRole('menuitem')).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: '复制 Markdown', exact: true })).toBeVisible();
  await expect(page.locator('.ProseMirror p')).toHaveText(`前文${selected}后文。`);
  await expect(target).toHaveText('工具栏测试');
});

test('right click page whitespace preserves a selected block', async ({ page }) => {
  const toolbar = await prepare(page);
  await page.locator('.ProseMirror p').first().click();
  await page.locator('.tano-block-handle').first().dispatchEvent('click');
  await page.keyboard.press('Escape');
  const selectedBlock = page.locator('.ProseMirror-selectednode');
  await expect(selectedBlock).toHaveCount(1);
  const before = await selectedBlock.textContent();
  const bounds = await page.locator('.editor-scroll').first().boundingBox();
  await page.mouse.click(bounds.x + bounds.width - 15, bounds.y + bounds.height - 20, { button: 'right' });
  await expect(toolbar).toBeHidden();
  await expect(selectedBlock).toHaveText(before);
  const menu = page.locator('.block-context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '创建副本' })).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height - 19);
  await menu.getByRole('menuitem', { name: '删除块' }).click();
  await expect(page.locator('.ProseMirror h1')).toHaveCount(0);
  await expect(page.locator('.ProseMirror p')).toContainText(selected);
});

for (const [action, expected, container = '折叠块'] of [
  ['创建副本', ['一', '二', '三', '二', '三', '四']],
  ['删除块', ['一', '四']],
  ['上移块', ['二', '三', '一', '四']],
  ['下移块', ['一', '四', '二', '三']],
  ['合并放入新块', ['一', '四']],
  ['合并放入新块', ['一', '四'], '引用块'],
  ['合并放入新块', ['一', '四'], '提示块'],
  ['合并放入新块', ['一', '四'], '标签页'],
  ['合并放入新块', ['一', '四'], '分栏'],
]) test(`selected block handle menu applies ${action} ${container} to the whole group`, async ({ page }) => {
  await prepare(page, 'fixed');
  await page.evaluate(async () => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace')
      .create('多选菜单.md', false, '一\n\n二\n\n三\n\n四\n');
  });
  const paragraphs = page.locator('.ProseMirror > p');
  await expect(paragraphs).toHaveText(['一', '二', '三', '四']);
  const handles = page.locator('.tano-block-handle');
  await handles.nth(1).dispatchEvent('click');
  await page.keyboard.press('Escape');
  await handles.nth(2).dispatchEvent('click', { shiftKey: true });
  await expect(page.locator('.tano-block-selected')).toHaveCount(2);
  await handles.nth(1).dispatchEvent('click');
  const menu = page.getByRole('menu', { name: '2 个块的操作', exact: true });
  await expect(menu).toBeVisible();
  await expect(page.locator('.tano-block-selected')).toHaveCount(2);
  await expect(menu.getByRole('menuitem', { name: '删除块', exact: true }).locator('.menu-shortcut')).toContainText('Backspace');
  if (action === '上移块') await menu.getByRole('menuitem', { name: action, exact: true }).press('Alt+ArrowUp');
  else await menu.getByRole('menuitem', { name: action, exact: true }).click();
  if (action === '合并放入新块') {
    const submenu = page.getByRole('menu', { name: '合并放入新块', exact: true });
    await expect(submenu).toBeVisible();
    await expect(submenu.getByRole('menuitem')).toHaveCount(5);
    await expect(paragraphs).toHaveText(['一', '二', '三', '四']);
    await submenu.getByRole('menuitem', { name: container, exact: true }).click();
  }
  await expect(paragraphs).toHaveText(expected);
  if (action === '合并放入新块') {
    await expect(page.locator('.ProseMirror')).toContainText('二');
    await expect(page.locator('.ProseMirror')).toContainText('三');
    await page.locator('.tano-block-handle').nth(1).dispatchEvent('click');
    await page.locator('.block-context-menu').getByRole('menuitem', { name: '展开', exact: true }).click();
    await expect(paragraphs).toHaveText(['一', '二', '三', '四']);
  }
});

for (const mode of ['selection', 'bottom', 'left', 'right']) {
for (const [button, label, value, result] of [
  ['脚注引用', '脚注内容', '脚注说明', '选中文字[^1]'],
  ['提及文档', '文档名称或路径', '引用目标', '[[引用目标|选中文字]]'],
]) test(`${mode}: opens and submits ${button} from More while preserving the selection`, async ({ page }) => {
  const toolbar = await prepare(page, mode);
  await toolbar.getByRole('button', { name: button, exact: true }).click();
  const input = toolbar.getByRole('textbox', { name: label, exact: true });
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill(value);
  await toolbar.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content)).toContain(result);
  await expect(page.locator('.ProseMirror').first()).toContainText('前文');
  await expect(page.locator('.ProseMirror').first()).toContainText('后文。');
});

test(`${mode}: opens the reference picker from More and inserts the chosen document`, async ({ page }) => {
  const toolbar = await prepare(page, mode);
  await toolbar.getByRole('button', { name: '引用对象或文档', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择引用对象或文档' });
  await expect(picker).toBeVisible();
  await picker.getByRole('textbox', { name: '搜索引用目标' }).fill('引用目标');
  await picker.getByRole('option').filter({ hasText: '引用目标' }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('.ProseMirror').first()).toContainText('引用目标');
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content)).toContain('object://document/');
});
}

for (const action of ['Escape', 'outside']) test(`closes the form with ${action} without modifying Markdown`, async ({ page }) => {
  const toolbar = await prepare(page);
  await toolbar.getByRole('button', { name: '脚注引用', exact: true }).click();
  const input = toolbar.getByRole('textbox', { name: '脚注内容', exact: true });
  await input.fill('不应保存');
  if (action === 'Escape') await input.press('Escape');
  else await page.locator('.sidebar-header').click({ position: { x: 1, y: 1 } });
  await expect(input).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content)).toBe(markdown);
});
