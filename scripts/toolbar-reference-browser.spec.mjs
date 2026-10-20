import { expect, test } from '@playwright/test';

const selected = '选中文字';
const markdown = `# 工具栏测试\n\n前文${selected}后文。\n`;

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
  await toolbar.getByRole('button', { name: '更多格式', exact: true }).click();
  return toolbar;
}

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
