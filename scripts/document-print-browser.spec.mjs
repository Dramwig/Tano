import { expect, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const url = process.env.TANO_PRINT_TEST_URL || 'http://127.0.0.1:43845';
const snapshot = '.document-print-root .document-export-content';
const image = 'https://print.example.test/diagram.svg';
const longContent = [
  '# 正文首标题',
  '正文起点 START-OF-DOCUMENT，支持 **粗体**、[链接](https://example.com) 和 $E=mc^2$。',
  '<details>\n<summary>折叠标题</summary>\n\n折叠正文 FOLDED-CONTENT\n\n</details>',
  '::::tabs\n\n:::panel "第一个标签"\n\nFIRST-TAB\n\n:::\n\n:::panel "第二个标签"\n\nSECOND-TAB\n\n:::\n\n::::',
  '| 表头 | 说明 |\n| --- | --- |\n| TABLE-FIRST | 一段较长的表格内容，应该在纸张宽度内自动换行。 |\n| TABLE-LAST | 末行内容 |',
  '- [x] 已完成任务\n- [ ] 待完成任务',
  '```ts\nconst printContent = "CODE-CONTENT ' + 'long-value-'.repeat(20) + '";\n```',
  `![打印图片](${image})`,
  '```mermaid\nflowchart LR\n  A[开始] --> B[完成]\n```',
  ...Array.from({ length: 100 }, (_, i) => `## Section ${i + 1}\n\nPARAGRAPH-${String(i + 1).padStart(3, '0')} ${'长文档分页检查，确保正文完整且可以正常阅读。'.repeat(8)}`),
  '| 长表表头 | 说明 |\n| --- | --- |\n' + Array.from({ length: 60 }, (_, i) => `| TABLE-ROW-${String(i + 1).padStart(3, '0')} | 跨页表格正文，保留整行并重复表头。 |`).join('\n'),
  'END-OF-DOCUMENT 最后一段正文。',
].join('\n\n');

async function prepare(page, content = '正文起点\n', preferences = {}) {
  await page.addInitScript(preferences => {
    if (window.top !== window) return;
    localStorage.setItem('tano.preference.locale', 'zh-CN');
    for (const [key, value] of Object.entries(preferences)) localStorage.setItem(`tano.preference.${key}`, typeof value === 'string' ? value : JSON.stringify(value));
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls++;
      window.dispatchEvent(new Event('beforeprint'));
    };
  }, preferences);
  await page.route(image, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="600" height="120" fill="#e0f2fe"/><text x="30" y="70" font-size="28">PRINT IMAGE</text></svg>' }));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('workspace')?.workspace);
  await page.evaluate(async content => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('workspace').create('打印验证.md', false, content);
  }, content);
  await expect(page.locator('#app .ProseMirror').first()).toContainText('正文');
}

async function cancel(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.document-print-root')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/document-printing/);
}

test('menu prints the full document on light paper, with selectable PDF text, hidden panels and no workbench UI', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page, longContent, { theme: 'dark' });
  await expect(page.locator('#app .tano-mermaid-preview svg')).toHaveCount(1);
  await page.evaluate(async () => {
    await Promise.all([...document.querySelectorAll('#app img[src]')].map(image => image.decode()));
    await document.fonts.ready;
  });
  const originalScroll = await page.locator('.document-layout').first().evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop; });
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  const print = page.getByRole('button', { name: /打印…/ });
  await expect(print).toHaveAttribute('aria-keyshortcuts', 'Control+P');
  await page.screenshot({ path: testInfo.outputPath('print-menu.png') });
  await print.click();
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);
  const content = page.locator(snapshot);
  await expect(content.locator('.document-export-title')).toHaveText('打印验证');
  await expect(content).toContainText('FOLDED-CONTENT');
  await expect(content).toContainText('SECOND-TAB');
  await expect(content).toContainText('END-OF-DOCUMENT');
  await expect(content.locator('button, [contenteditable], .tano-block-handle, .tano-table-scrollbar')).toHaveCount(0);
  await expect(content.locator('.tano-mermaid-preview svg')).toHaveCount(1);
  expect(await content.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const previousTitle = await page.title();
  expect(previousTitle).toBe('打印验证');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#app')).toBeHidden();
  const layout = await content.evaluate(root => {
    const bounds = root.getBoundingClientRect();
    const overflow = [...root.querySelectorAll('table, img, pre')].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && (box.left < bounds.left - 1 || box.right > bounds.right + 1);
    }).map(element => element.tagName);
    return { background: getComputedStyle(root).backgroundColor, overflow };
  });
  expect(layout).toEqual({ background: 'rgb(255, 255, 255)', overflow: [] });
  await page.screenshot({ path: testInfo.outputPath('print-paper.png'), fullPage: true });
  const pdf = await page.pdf({ path: testInfo.outputPath('printed-document.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  const pdfTask = getDocument({ data: new Uint8Array(pdf) });
  const doc = await pdfTask.promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const pdfPage = await doc.getPage(number);
    pages.push((await pdfPage.getTextContent()).items.map(item => item.str).join(''));
  }
  const printed = { count: pages.length, text: pages.join('\n') };
  await pdfTask.destroy();
  expect(printed.count).toBeGreaterThan(5);
  for (const text of ['打印验证', 'START-OF-DOCUMENT', 'FOLDED-CONTENT', '第一个标签', '第二个标签', 'FIRST-TAB', 'SECOND-TAB', 'TABLE-LAST', 'TABLE-ROW-060', 'CODE-CONTENT', 'PARAGRAPH-001', 'PARAGRAPH-100', 'END-OF-DOCUMENT']) expect(printed.text).toContain(text);
  expect(printed.text.split('长表表头').length).toBeGreaterThan(2);
  for (const text of ['页内搜索', '工作区选项', '移入回收站', '浏览器演示']) expect(printed.text).not.toContain(text);
  console.log(`Printed ${printed.count} A4 pages with complete selectable text.`);
  await page.emulateMedia({ media: 'screen' });
  await cancel(page);
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.locator('.document-layout').first().evaluate(element => element.scrollTop)).toBe(originalScroll);
  expect(errors).toEqual([]);
});

test('Ctrl+P prints the latest editor input, ignores repeats, and supports printing again after cancellation', async ({ page }) => {
  await prepare(page);
  const paragraph = page.locator('#app .ProseMirror p').first();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type('UNSAVED-LATEST');
  await page.keyboard.press('Control+p');
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);
  await expect(page.locator(snapshot)).toContainText('UNSAVED-LATEST');
  await page.keyboard.press('Control+p');
  expect(await page.evaluate(() => window.__printCalls)).toBe(1);
  await cancel(page);
  await paragraph.click();
  await page.keyboard.press('Control+p');
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(2);
  await cancel(page);
  await expect(paragraph).toContainText('UNSAVED-LATEST');
});

test('custom print shortcut works from source mode and prints rendered content', async ({ page }) => {
  await prepare(page, '正文 **粗体**\n', { shortcuts: { print: 'Alt+P' } });
  await page.getByRole('button', { name: '切换源码模式', exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type('SOURCE-LATEST');
  await page.keyboard.press('Alt+p');
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);
  await expect(page.locator(`${snapshot} strong`)).toHaveText('粗体');
  await expect(page.locator(snapshot)).toContainText('SOURCE-LATEST');
  await cancel(page);
  await expect(page.locator('.cm-content')).toContainText('SOURCE-LATEST');
});

test('command palette exposes printing in reading mode', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await page.getByRole('switch', { name: '锁定页面', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+p');
  await page.getByRole('dialog').getByRole('combobox').fill('打印');
  await page.getByRole('option', { name: /打印文档/ }).click();
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);
  await expect(page.locator(snapshot)).toContainText('正文起点');
  await cancel(page);
});
