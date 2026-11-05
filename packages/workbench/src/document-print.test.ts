// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultCapabilities } from '@tano/editor/runtime';
import { preparePrintContent, printDocument } from './document-print';

vi.mock('@tano/editor', async () => {
  const { defineComponent, h, onMounted } = await import('vue');
  return { default: defineComponent({
    props: ['modelValue'], emits: ['ready', 'error'],
    setup(props, { emit }) {
      onMounted(() => props.modelValue === 'broken' ? emit('error', '渲染失败') : emit('ready'));
      return () => h('div', { class: 'tano-prose', innerHTML: '<p>完整正文</p><section class="tano-enhanced" hidden><div class="tano-enhanced-content" hidden>折叠正文</div></section><span class="tano-reference"><button>引用目标</button></span><input type="checkbox" checked><button>编辑操作</button>' });
    },
  }) };
});

const options = {
  id: 'a00001', path: 'folder/打印验证.md', title: '文档标题', content: 'current unsaved Markdown',
  capabilities: defaultCapabilities, referenceTargets: [], resolveImage: () => null,
  fontFamily: 'sans-serif', fontSize: 16,
};
let media: MediaQueryList;

beforeEach(() => {
  document.title = 'Tano 工作台';
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  media = Object.assign(new EventTarget(), { matches: false, media: 'print', onchange: null }) as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});
afterEach(async () => {
  window.dispatchEvent(new Event('afterprint'));
  await vi.waitFor(() => expect(document.querySelector('.document-print-root')).toBeNull());
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('keeps the complete clean document alive through an asynchronous preview and restores it on cancellation', async () => {
  const open = vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('beforeprint')));
  const printing = printDocument(options);
  await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
  const root = document.querySelector('.document-print-root .document-export-content')!;
  expect(root.textContent).toContain('文档标题完整正文折叠正文引用目标');
  expect(root.querySelector('button, [contenteditable], .tano-enhanced[hidden]')).toBeNull();
  expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  expect(document.title).toBe('文档标题');
  expect(document.documentElement.classList.contains('document-printing')).toBe(true);
  await printDocument(options);
  expect(open).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('afterprint'));
  await printing;
  expect(document.querySelector('.document-export-renderer')).toBeNull();
  expect(document.documentElement.classList.contains('document-printing')).toBe(false);
  expect(document.title).toBe('Tano 工作台');
});

it('releases the document when the print media query exits and allows another print', async () => {
  const open = vi.spyOn(window, 'print').mockImplementation(() => {});
  const printing = printDocument({ ...options, title: undefined });
  await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
  expect(document.title).toBe('打印验证');
  media.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
  media.dispatchEvent(Object.assign(new Event('change'), { matches: false }));
  await printing;
  expect(document.querySelector('.document-print-root')).toBeNull();
  open.mockImplementation(() => window.dispatchEvent(new Event('afterprint')));
  await printDocument(options);
  expect(open).toHaveBeenCalledTimes(2);
});

it('reports printing errors, restores the workbench, and permits retrying', async () => {
  const open = vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('打印机不可用'); });
  await expect(printDocument(options)).rejects.toThrow('打印机不可用');
  expect(document.querySelector('.document-export-renderer')).toBeNull();
  expect(document.documentElement.classList.contains('document-printing')).toBe(false);
  expect(document.title).toBe('Tano 工作台');
  open.mockImplementation(() => window.dispatchEvent(new Event('afterprint')));
  await printDocument(options);
  expect(open).toHaveBeenCalledTimes(2);
});

it('cleans up failed document rendering without opening an empty print dialog', async () => {
  const open = vi.spyOn(window, 'print');
  await expect(printDocument({ ...options, content: 'broken' })).rejects.toThrow('渲染失败');
  expect(open).not.toHaveBeenCalled();
  expect(document.querySelector('.document-export-renderer')).toBeNull();
});

it('prints tabs as named sections and repeats Markdown table headers across pages', () => {
  const root = document.createElement('div');
  root.innerHTML = '<section class="tano-tabs"><div class="tano-enhanced-header"></div><div class="tano-enhanced-content"><section class="tano-panel"><div class="tano-enhanced-header"><details><span>标签名称</span></details></div><p>标签正文</p></section></div></section><table><tbody><tr><th>表头</th></tr><tr><td>正文</td></tr></tbody></table>';
  preparePrintContent(root);
  expect(root.querySelector('h3')?.textContent).toBe('标签名称');
  expect(root.querySelector('.tano-tabs > .tano-enhanced-header')).toBeNull();
  expect(root.querySelector('thead')?.textContent).toBe('表头');
  expect(root.querySelector('tbody')?.textContent).toBe('正文');
  expect(root.textContent).toBe('标签名称标签正文表头正文');
});
