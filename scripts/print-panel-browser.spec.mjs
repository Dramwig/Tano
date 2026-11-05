import { expect, test } from '@playwright/test';
import { jsPDF } from 'jspdf';

const url = process.env.TANO_PRINT_TEST_URL || 'http://127.0.0.1:43845';
const document = new jsPDF();
document.text('Print preview verification', 20, 25);
document.addPage(); document.text('Page two', 20, 25);
const pdf = Buffer.from(document.output('arraybuffer')).toString('base64');

async function prepare(page) {
  await page.addInitScript(pdf => {
    if (window.top !== window) return;
    localStorage.setItem('tano.preference.locale', 'zh-CN');
    window.isTauri = true;
    window.__printCalls = [];
    const callbacks = new Map(), events = new Map(); let id = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'print-layout' }, currentWebview: { label: 'print-layout' } },
      transformCallback(callback) { callbacks.set(++id, callback); return id; },
      unregisterCallback(callback) { callbacks.delete(callback); },
      async invoke(command, args = {}) {
        window.__printCalls.push({ command, args });
        if (command === 'plugin:event|listen') { events.set(args.event, args.handler); return id; }
        if (command === 'plugin:event|emit_to' && args.event === 'tano-print-ready') {
          queueMicrotask(() => callbacks.get(events.get('tano-print-content'))?.({ payload: { title: '打印布局验证', html: '<main class="document-export-content"><p>完整正文</p></main>', lang: 'zh-CN', css: [], stylesheets: [] } }));
        }
        if (command === 'document_print_printers') return { nativeSettings: true, defaultPrinter: '测试打印机', printers: ['测试打印机'] };
        if (command === 'document_print_preview') return pdf;
        return null;
      },
    };
    window.print = () => { throw new Error('The custom panel must not open the system preview automatically'); };
  }, pdf);
  await page.goto(`${url}/index.html?tanoPrint=print-layout&printOpener=main`);
  await expect(page.getByRole('dialog', { name: '打印', exact: true })).toBeVisible();
  await expect(page.locator('.pdf-paper canvas').first()).toBeVisible();
}

test('print panel fills the frameless window and matches settings controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  const bounds = await page.locator('.document-print-panel').boundingBox();
  expect(bounds).toEqual({ x: 0, y: 0, width: 1100, height: 800 });
  expect(await page.locator('.document-print-options').evaluate(element => getComputedStyle(element).borderRightWidth)).toBe('1px');
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打印', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('print-panel.png') });
  await page.getByRole('combobox', { name: '纸张', exact: true }).selectOption('a3');
  await page.getByRole('radio', { name: '横向', exact: true }).check();
  await expect.poll(() => page.evaluate(() => window.__printCalls.filter(call => call.command === 'document_print_preview').at(-1)?.args.settings)).toMatchObject({ paper: 'a3', landscape: true });
  await page.getByRole('radio', { name: '指定页码', exact: true }).check();
  await page.getByLabel('页码范围', { exact: true }).fill('5-2');
  await expect(page.getByRole('button', { name: '打印', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('页码范围无效');
  await page.getByLabel('页码范围', { exact: true }).fill('1-2');
  await expect(page.getByRole('button', { name: '打印', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('small windows keep settings and preview inside the window with scrollable controls', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 520 });
  await prepare(page);
  await page.getByRole('button', { name: /更多设置/ }).click();
  await expect(page.getByRole('button', { name: '打印', exact: true })).toBeVisible();
  expect(await page.locator('.document-print-options-scroll').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(680);
});
