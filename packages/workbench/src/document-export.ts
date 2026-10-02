import { createApp, h } from 'vue';
import MarkdownEditor from '@tano/editor';
import type { WorkspaceCapabilities } from '@tano/editor/runtime';
import type { ReferenceTarget, TableLayout } from '@tano/protocol';
import { basename } from '@tano/protocol';

export type DocumentExportFormat = 'markdown' | 'pdf' | 'html' | 'png';
export interface DocumentExportOptions {
  id: string;
  path: string;
  content: string;
  title?: string;
  capabilities: WorkspaceCapabilities;
  referenceTargets: readonly ReferenceTarget[];
  tableLayouts?: readonly TableLayout[];
  resolveImage: (reference: string) => string | null;
  fontFamily: string;
  fontSize: number;
}

export function exportFilename(path: string, format: DocumentExportFormat) {
  const name = basename(path);
  return format === 'markdown' ? name : `${name.replace(/\.(md|markdown)$/i, '')}.${format}`;
}

function stylesheetText(rules: CSSRuleList): string {
  return [...rules].flatMap(rule => {
    if (rule instanceof CSSFontFaceRule) return [];
    if (rule instanceof CSSImportRule) return rule.styleSheet ? [stylesheetText(rule.styleSheet.cssRules)] : [];
    return [rule.cssText];
  }).join('\n');
}

export function cleanExportContent(root: HTMLElement) {
  // Export all panels and folded content, without the editor's controls.
  root.querySelectorAll<HTMLElement>('.tano-enhanced-content[hidden], .tano-enhanced[hidden]').forEach(element => { element.hidden = false; });
  root.querySelectorAll('.tano-code-language').forEach(element => element.remove());
  root.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])').forEach(input => {
    const label = document.createElement('span');
    label.className = input.className;
    label.textContent = input.value;
    input.replaceWith(label);
  });
  root.querySelectorAll('button, .tano-editor-panel, .tano-tab-list, .tano-block-handle, .tano-table-scrollbar, .ProseMirror-gapcursor, .tano-image-caption:empty').forEach(element => element.remove());
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
    input.toggleAttribute('checked', input.checked);
    input.disabled = true;
  });
  root.querySelectorAll<HTMLElement>('[contenteditable], [tabindex]').forEach(element => {
    element.removeAttribute('contenteditable');
    element.removeAttribute('tabindex');
  });
  root.querySelectorAll<HTMLElement>('.tano-table-viewport, .tableWrapper').forEach(element => {
    element.style.width = '100%';
    element.style.marginLeft = '0';
  });
  root.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    const columns = [...table.querySelectorAll<HTMLTableColElement>('col')];
    const widths = columns.map(column => Number.parseFloat(column.style.width) || 1);
    const total = widths.reduce((sum, width) => sum + width, 0);
    columns.forEach((column, index) => { column.style.width = `${widths[index] / total * 100}%`; });
    table.style.width = '100%';
    table.style.minWidth = '0';
    table.style.marginLeft = '0';
    table.style.marginRight = '0';
  });
}

export function exportPageSlices(height: number, pageHeight: number, boxes: readonly { top: number; bottom: number }[]) {
  const slices: { top: number; bottom: number }[] = [];
  let top = 0;
  while (top < height) {
    let bottom = Math.min(height, top + pageHeight);
    if (bottom < height) {
      while (true) {
        const crossing = boxes.filter(box => box.top > top + 1 && box.top < bottom && box.bottom > bottom && box.bottom - box.top < pageHeight);
        if (!crossing.length) break;
        bottom = Math.max(top + 1, Math.floor(Math.min(...crossing.map(box => box.top)) - 1));
      }
    }
    slices.push({ top, bottom });
    top = bottom;
  }
  return slices;
}

function exportLayoutBoxes(root: HTMLElement) {
  const origin = root.getBoundingClientRect().top;
  const boxes = [...root.querySelectorAll('img, svg, tr')].map(element => element.getBoundingClientRect());
  const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = text.nextNode(); node; node = text.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    boxes.push(...range.getClientRects());
  }
  return boxes.filter(box => box.height > 0 && box.width > 0).map(box => ({ top: box.top - origin, bottom: box.bottom - origin }));
}

async function inlineImages(root: HTMLElement) {
  await Promise.all([...root.querySelectorAll<HTMLImageElement>('img')].map(async image => {
    image.loading = 'eager';
    if (!image.src || image.src.startsWith('data:')) return;
    const response = await fetch(image.src, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`无法导出图片：${image.alt || response.status}`);
    const imageBlob = await response.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('无法读取导出图片'));
      reader.readAsDataURL(imageBlob);
    });
    image.src = data;
    image.removeAttribute('srcset');
  }));
}

async function waitForDiagrams(root: HTMLElement) {
  const pending = () => [...root.querySelectorAll('.tano-mermaid-preview')].some(preview =>
    !preview.querySelector('svg') && !preview.classList.contains('tano-mermaid-preview-empty') && !preview.classList.contains('tano-mermaid-preview-stale'));
  if (!pending()) return;
  await new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!pending()) { clearTimeout(timer); observer.disconnect(); resolve(); }
    });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('图表渲染超时，请重试')); }, 30000);
    observer.observe(root, { subtree: true, childList: true, attributes: true });
  });
}

export async function renderDocumentExport(options: DocumentExportOptions, format: DocumentExportFormat): Promise<Blob> {
  if (format === 'markdown') return new Blob([options.content], { type: 'text/markdown;charset=utf-8' });
  const host = document.createElement('div');
  host.className = 'document-export-renderer';
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.style.setProperty('--tano-prose-font-family', options.fontFamily);
  host.style.setProperty('--tano-prose-font-size', `${options.fontSize}px`);
  // Use light paper even when the workbench is in dark mode.
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
        for (const property of rule.style) if (property.startsWith('--')) host.style.setProperty(property, rule.style.getPropertyValue(property));
      }
    }
  }
  document.body.append(host);
  const mount = document.createElement('div');
  host.append(mount);
  let ready!: () => void, fail!: (error: Error) => void;
  const initialized = new Promise<void>((resolve, reject) => { ready = resolve; fail = reject; });
  const timer = setTimeout(() => fail(new Error('导出渲染超时，请重试')), 30000);
  const app = createApp({ render: () => h(MarkdownEditor, {
    documentId: options.id, modelValue: options.content, readonly: true, revealMarkdown: false,
    capabilities: options.capabilities, referenceTargets: options.referenceTargets,
    tableLayouts: options.tableLayouts, resolveImage: options.resolveImage,
    onReady: ready, onError: (message: string) => fail(new Error(message)),
  }) });
  try {
    app.mount(mount);
    await initialized;
    clearTimeout(timer);
    const prose = mount.querySelector<HTMLElement>('.tano-prose');
    if (!prose) throw new Error('无法渲染导出内容');
    await waitForDiagrams(prose);
    const snapshot = document.createElement('main');
    snapshot.className = 'document-export-content';
    snapshot.style.cssText = host.style.cssText;
    if (options.title) {
      const title = document.createElement('h1');
      title.className = 'document-export-title';
      title.textContent = options.title;
      snapshot.append(title);
    }
    snapshot.append(prose.cloneNode(true));
    cleanExportContent(snapshot);
    host.append(snapshot);
    mount.style.display = 'none';
    await inlineImages(snapshot);
    await Promise.all([...snapshot.querySelectorAll<HTMLImageElement>('img[src]')].map(image => image.decode()));
    await document.fonts.ready;
    const { getFontEmbedCSS, toCanvas } = await import('html-to-image');
    const fontEmbedCSS = await getFontEmbedCSS(snapshot, { preferredFontFormat: 'woff2' });
    if (format === 'html') {
      const html = document.implementation.createHTMLDocument(options.title ?? basename(options.path));
      html.documentElement.lang = 'zh-CN';
      const charset = html.createElement('meta');
      charset.setAttribute('charset', 'utf-8');
      const viewport = html.createElement('meta');
      viewport.name = 'viewport';
      viewport.content = 'width=device-width, initial-scale=1';
      const style = html.createElement('style');
      style.textContent = [...document.styleSheets].map(sheet => stylesheetText(sheet.cssRules)).join('\n') + '\n' + fontEmbedCSS
        + '\nhtml,body{height:auto;overflow:auto;background:#fff}body{padding:32px 16px}.document-export-content{width:100%;max-width:800px;margin:0 auto}';
      html.head.prepend(charset, viewport);
      html.head.append(style);
      html.body.append(html.importNode(snapshot, true));
      return new Blob(['<!DOCTYPE html>\n', html.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
    }
    const width = 800, height = Math.ceil(snapshot.scrollHeight);
    if (height * 2 > 32767 || width * height * 4 > 64 * 1024 * 1024) throw new Error('文档过长，请改用 HTML 或 Markdown 导出');
    const canvas = await toCanvas(snapshot, { backgroundColor: '#ffffff', pixelRatio: 2, width, height, fontEmbedCSS, skipAutoScale: true });
    if (format === 'png') return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成图片')), 'image/png'));
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const margin = 15, pageWidth = 180, pageHeight = 267;
    const scale = canvas.height / height;
    const slices = exportPageSlices(canvas.height, Math.floor(pageHeight / pageWidth * canvas.width), exportLayoutBoxes(snapshot).map(box => ({ top: box.top * scale, bottom: box.bottom * scale })));
    for (const slice of slices) {
      const page = document.createElement('canvas');
      page.width = canvas.width;
      page.height = slice.bottom - slice.top;
      const context = page.getContext('2d');
      if (!context) throw new Error('无法生成 PDF');
      context.drawImage(canvas, 0, slice.top, page.width, page.height, 0, 0, page.width, page.height);
      if (slice.top) pdf.addPage();
      pdf.addImage(page, 'PNG', margin, margin, pageWidth, page.height / page.width * pageWidth);
    }
    pdf.setProperties({ title: options.title ?? basename(options.path), creator: 'Tano' });
    return pdf.output('blob');
  } finally {
    clearTimeout(timer);
    app.unmount();
    host.remove();
  }
}

export function downloadExport(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
