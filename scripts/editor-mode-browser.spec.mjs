import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:43845';
const markdown = '---\ntitle: 模式切换\n---\n\n' + Array.from({ length: 90 }, (_, index) =>
  `## 第 ${index + 1} 节\n\n第 ${index + 1} 段：重复内容与光标位置测试，包含 **加粗文字** 和普通文字。\n\n`).join('');

async function state(page) {
  return page.evaluate(() => {
    const element = document.querySelector('.source-editor, .milkdown-host');
    let component = element?.__vueParentComponent;
    while (component && !component.exposed?.captureModeSelection) component = component.parent;
    const editor = component?.exposed;
    return editor ? { selection: editor.captureModeSelection(), top: editor.modeCursorTop(),
      focus: element.contains(document.activeElement) } : null;
  });
}

async function open(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async markdown => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace');
    await store.create('mode-switch.md', false, markdown);
  }, markdown);
  await expect(page.getByRole('textbox', { name: 'Markdown 文档编辑器', exact: true })).toBeVisible();
}

test('keeps the caret and its viewport height through both mode switches in a long document', async ({ page }) => {
  await open(page);
  const offset = markdown.indexOf('第 48 段') + 12;
  await page.evaluate(offset => {
    const host = document.querySelector('.milkdown-host');
    let component = host.__vueParentComponent;
    while (!component.exposed?.restoreModeSelection) component = component.parent;
    const editor = component.exposed;
    editor.restoreModeSelection({ anchor: offset, head: offset });
    const scroll = host.closest('.document-layout');
    scroll.scrollTop += editor.modeCursorTop() - 360;
  }, offset);
  const before = await state(page);
  expect(before.top).toBeCloseTo(360, 0);
  await page.getByRole('button', { name: '切换源码模式', exact: true }).first().click();
  await expect.poll(async () => (await state(page))?.selection).toEqual({ anchor: offset, head: offset });
  await expect.poll(async () => Math.abs((await state(page)).top - before.top)).toBeLessThan(3);
  expect((await state(page)).focus).toBe(true);
  await page.getByRole('button', { name: '返回编辑', exact: true }).first().click();
  await expect.poll(async () => (await state(page))?.selection).toEqual({ anchor: offset, head: offset });
  await expect.poll(async () => Math.abs((await state(page)).top - before.top)).toBeLessThan(3);
  expect((await state(page)).focus).toBe(true);
  await page.keyboard.type('INSERTED');
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').active.content))
    .toContain(markdown.slice(offset - 8, offset) + 'INSERTED' + markdown.slice(offset, offset + 8));
});

test('keeps a backward selection and handles immediate repeated toggles', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '切换源码模式', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Markdown 源码', exact: true })).toBeVisible();
  const selection = { anchor: markdown.indexOf('第 32 段') + 12, head: markdown.indexOf('第 31 段') + 5 };
  await page.evaluate(selection => {
    let component = document.querySelector('.source-editor').__vueParentComponent;
    while (!component.exposed?.restoreModeSelection) component = component.parent;
    component.exposed.restoreModeSelection(selection);
  }, selection);
  await page.getByRole('button', { name: '返回编辑', exact: true }).first().click();
  await expect.poll(async () => (await state(page))?.selection).toEqual(selection);
  await page.getByRole('button', { name: '切换源码模式', exact: true }).first().click();
  await expect.poll(async () => (await state(page))?.selection).toEqual(selection);
  await page.evaluate(() => {
    const button = document.querySelector('.source-mode-button');
    button.click();
    button.click();
  });
  await expect.poll(async () => (await state(page))?.selection).toEqual(selection);
});
