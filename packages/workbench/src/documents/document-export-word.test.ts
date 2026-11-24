// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { renderDocumentExport } from './document-export';
import { defaultCapabilities } from '@tano/editor/runtime';

vi.mock('@tano/editor', async () => {
  const { defineComponent, h, onMounted } = await import('vue');
  return { default: defineComponent({
    emits: ['ready'],
    setup(_, { emit }) {
      onMounted(() => emit('ready'));
      return () => h('div', { class: 'tano-prose', innerHTML: '<p>正文<strong>粗体</strong><span class="tano-reference" data-tano-reference="inline" data-reference-url="tano://task/task01" data-reference-label="旧名称"><button><span>@当前名称</span><small>任务 · 已完成</small></button></span></p><section class="tano-enhanced" hidden><div class="tano-enhanced-header"><input value="折叠标题"><button>添加子块</button></div><div class="tano-enhanced-content" hidden><p>折叠正文</p></div></section><section class="tano-resource" data-title="附件" data-url="files/附件.pdf"><button class="tano-resource-row">附件</button></section>' });
    },
  }) };
});
vi.mock('html-to-image', () => ({ getFontEmbedCSS: vi.fn(() => { throw new Error('Text-only Word exports must not capture the page'); }) }));
afterEach(() => { vi.unstubAllGlobals(); });

it('exports the cleaned page snapshot to Word, retaining folded text and content inside reference buttons', async () => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  const blob = await renderDocumentExport({ id: 'a00001', path: '文档.md', content: 'Markdown 原文', title: '页面标题',
    capabilities: defaultCapabilities, referenceTargets: [], resolveImage: () => null, fontFamily: 'sans-serif', fontSize: 16,
  }, 'docx');
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  const files = unzipSync(new Uint8Array(buffer));
  const xml = new DOMParser().parseFromString(strFromU8(files['word/document.xml']), 'application/xml');
  const text = [...xml.getElementsByTagName('w:t')].map(element => element.textContent).join('');
  expect(text).toBe('页面标题正文粗体@当前名称任务 · 已完成折叠标题折叠正文附件');
  expect(text).not.toContain('添加子块');
  expect(document.querySelector('.document-export-renderer')).toBeNull();
  const mammoth = await import('mammoth/mammoth.browser');
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  expect(result.value).toContain('<strong>粗体</strong>');
  expect(result.value).toContain('折叠正文');
  expect(result.value).toContain('@当前名称');
});
