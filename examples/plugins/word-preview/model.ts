import { unzipSync } from 'fflate';
import { renderAsync, disposeRenderedDocument } from '@file-viewer/docx';
import { createMsDocViewer } from '@file-viewer/doc';
import { legacyLayout } from './legacy-layout';

export const cancelWordRender = (container: HTMLElement) => disposeRenderedDocument(container);

export function validateWord(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('Word 文档必须小于 50 MiB');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let entries = 0, total = 0;
    const files = unzipSync(bytes, { filter(entry) {
      if (++entries > 2000 || entry.originalSize > 20 * 1024 * 1024 || (total += entry.originalSize) > 100 * 1024 * 1024) throw new Error('Word 文档展开后超过预览限制');
      if (entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..')) throw new Error('Word 文档路径无效');
      return /\.(xml|rels)$/i.test(entry.name);
    } });
    if (!files['word/document.xml']) throw new Error('不是有效的 DOCX 文件');
    for (const content of Object.values(files)) if (/<!DOCTYPE|<!ENTITY/i.test(new TextDecoder().decode(content))) throw new Error('Word 文档包含不支持的 XML 声明');
    return 'docx';
  }
  if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value)) return 'doc';
  throw new Error('不是有效的 DOC/DOCX 文件');
}

export async function renderWord(bytes: Uint8Array, container: HTMLElement) {
  const format = validateWord(bytes);
  if (format === 'docx') {
    await renderAsync(bytes, container, container, {
      useWorker: false, awaitLayout: true, strictWordCompatibility: true, maxDynamicPaginationPasses: 30,
      ignoreLastRenderedPageBreak: false, breakPages: true, ignoreWidth: false, ignoreHeight: false,
      renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
      renderAltChunks: false, externalResourcePolicy: 'block', externalLinkPolicy: 'block', useBase64URL: true,
      renderPageBatchSize: 4, renderYieldEveryMs: 12,
    });
    const pages = [...container.querySelectorAll<HTMLElement>('section.docx')];
    if (!pages.length || pages.length > 1000) { disposeRenderedDocument(container); throw new Error('Word 页数超出预览限制'); }
    return { pages, note: '按 DOCX 原始页面和样式渲染。缺少字体、复杂浮动对象或兼容模式可能导致与 Word 的分页存在差异。', dispose: () => disposeRenderedDocument(container) };
  }
  const geometry = legacyLayout(bytes);
  const viewer = createMsDocViewer(container, { parseOptions: { maxPictureBytes: 5 * 1024 * 1024 }, renderOptions: { externalLinkPolicy: 'block', externalResourcePolicy: 'block' } });
  await viewer.load(bytes);
  const root = container.querySelector<HTMLElement>('.msdoc-root')!;
  // Preserve native DOC run/paragraph/table styling; derive paper from SEPX instead of imposing A4.
  root.style.cssText = `width:${geometry.width / 15}px;min-height:${geometry.height / 15}px;padding:${geometry.top / 15}px ${geometry.right / 15}px ${geometry.bottom / 15}px ${geometry.left / 15}px;max-width:none`;
  root.classList.add('word-legacy-page');
  return { pages: [root], note: '旧版 DOC 按二进制字体、段落、表格和内嵌图片样式渲染，采用首节纸张及页边距。当前引擎不还原完整的分页、分节和页眉页脚；复杂文件建议另存为 DOCX 后查看。', dispose: () => viewer.destroy() };
}
