// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { renderWordDocument } from './word-document-export';

const options = { path: 'folder/标题.markdown', title: '标题', fontFamily: '"Inter", sans-serif', fontSize: 16 };
async function exported(html: string) {
  const root = globalThis.document.createElement('main');
  root.innerHTML = html;
  const blob = await renderWordDocument(root, options);
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  const files = unzipSync(new Uint8Array(buffer));
  const xml = (path: string) => new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml');
  const document = xml('word/document.xml');
  expect(document.querySelector('parsererror')).toBeNull();
  return { blob, buffer, files, xml, document };
}
function elements(node: Document | Element, name: string) { return [...node.getElementsByTagName(`w:${name}`)]; }
function text(node: Document | Element) { return elements(node, 't').map(element => element.textContent).join(''); }

it('creates a real DOCX with editable Chinese text, headings, formatting, links and line breaks', async () => {
  const { blob, document, xml } = await exported('<h1 class="document-export-title">标题</h1><div class="tano-prose"><h2>章节</h2><p>正文 <strong>粗体 <em>斜体</em></strong><u>下划线</u><del>删除线</del><mark>高亮</mark><sup>上标</sup><sub>下标</sub><span style="color:#e12">彩色</span><br><a href="https://example.com/中文?a=1&amp;b=2">链接</a></p><pre><code>const a = 1;\n  next();</code></pre><p hidden>隐藏源码</p></div>');
  expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  expect(elements(document, 'pStyle').map(element => element.getAttribute('w:val'))).toEqual(['Title', 'Heading2']);
  expect(text(document)).toContain('正文 粗体 斜体下划线删除线高亮上标下标彩色链接');
  expect(text(document)).not.toContain('隐藏源码');
  expect(elements(document, 'b').length).toBeGreaterThan(0);
  expect(elements(document, 'i').length).toBeGreaterThan(0);
  expect(elements(document, 'u').length).toBeGreaterThan(0);
  expect(elements(document, 'strike').length).toBeGreaterThan(0);
  expect(elements(document, 'highlight')[0].getAttribute('w:val')).toBe('yellow');
  expect(elements(document, 'color').some(element => element.getAttribute('w:val') === 'EE1122')).toBe(true);
  expect(elements(document, 'br')).toHaveLength(2);
  expect(text(document)).toContain('const a = 1;  next();');
  expect(xml('word/_rels/document.xml.rels').documentElement.textContent).not.toContain('隐藏源码');
  const links = [...xml('word/_rels/document.xml.rels').getElementsByTagName('Relationship')];
  expect(links.some(link => link.getAttribute('Target') === 'https://example.com/中文?a=1&b=2')).toBe(true);
  expect(xml('docProps/core.xml').getElementsByTagName('dc:title')[0].textContent).toBe('标题');
});

it('retains nested lists, independent numbering starts, task states and table structure', async () => {
  const { document, xml } = await exported('<ol start="3"><li><p>第三项</p><ul><li><p>嵌套项</p></li></ul><p>补充段落</p></li><li><p>第四项</p></li></ol><ol><li><p>重新编号</p></li></ol><ul><li data-item-type="task" data-checked="true"><p>已完成</p></li><li data-item-type="task" data-checked="false"><p>未完成</p></li></ul><table><colgroup><col style="width:25%"><col style="width:75%"></colgroup><thead><tr><th><p>名称</p></th><th><p>说明</p></th></tr></thead><tbody><tr><td><p>项目</p></td><td><p><strong>可编辑</strong></p></td></tr></tbody></table><p>表后正文</p>');
  expect(elements(document, 'numPr')).toHaveLength(4);
  expect(elements(document, 'ilvl').map(element => element.getAttribute('w:val'))).toContain('1');
  const starts = elements(xml('word/numbering.xml'), 'start').map(element => element.getAttribute('w:val'));
  expect(starts).toContain('3');
  expect(starts).toContain('1');
  expect(text(document)).toContain('☑ 已完成☐ 未完成');
  expect(elements(document, 'tbl')).toHaveLength(1);
  expect(elements(document, 'tr')).toHaveLength(2);
  expect(elements(document, 'tc')).toHaveLength(4);
  expect(elements(document, 'tblHeader')).toHaveLength(1);
  const widths = elements(document, 'gridCol').map(element => Number(element.getAttribute('w:w')));
  expect(widths[1] / widths[0]).toBeCloseTo(3, 2);
  expect(text(document)).toContain('名称说明项目可编辑表后正文');
});

it('embeds image bytes with their alternative text and constrains large images to the page', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
  const { files, document, xml } = await exported(`<p>本地附件<img width="2000" height="1000" alt="示意图" src="data:image/png;base64,${png}"></p>`);
  const image = Object.keys(files).find(path => path.startsWith('word/media/') && path.endsWith('.png'))!;
  expect(files[image]).toEqual(Uint8Array.from(atob(png), char => char.charCodeAt(0)));
  expect(elements(document, 'drawing')).toHaveLength(1);
  const extent = document.getElementsByTagName('wp:extent')[0];
  expect(Number(extent.getAttribute('cx')) / 9525).toBeLessThanOrEqual(681);
  expect(Number(extent.getAttribute('cx')) / Number(extent.getAttribute('cy'))).toBe(2);
  expect(document.getElementsByTagName('wp:docPr')[0].getAttribute('descr')).toBe('示意图');
  expect([...xml('word/_rels/document.xml.rels').getElementsByTagName('Relationship')].some(link => link.getAttribute('Target')?.startsWith('media/'))).toBe(true);
});

it('keeps quote and enhanced content in document order and exports an empty document', async () => {
  const { document } = await exported('<blockquote><p>引用</p></blockquote><section class="tano-enhanced"><div class="tano-enhanced-header"><span>折叠标题</span></div><div class="tano-enhanced-content"><p>展开正文</p><table><tr><td><p>单元格</p></td></tr></table></div></section><p><a href="javascript:alert(1)">文本链接</a></p>');
  expect(text(document)).toBe('引用折叠标题展开正文单元格文本链接');
  expect(elements(document, 'pBdr')).toHaveLength(1);
  expect(elements(document, 'hyperlink')).toHaveLength(0);
  expect(elements((await exported('')).document, 'p')).toHaveLength(1);
});

it('renders formulas and Mermaid diagrams as images without duplicating their rendered text', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 120, height: 40 } as DOMRect);
  const toPng = vi.fn().mockResolvedValue(png);
  vi.doMock('html-to-image', () => ({ getFontEmbedCSS: vi.fn().mockResolvedValue(''), toPng }));
  try {
    const { document } = await exported('<p>公式<span class="math-preview" title="x^2">重复的公式正文</span></p><div class="tano-mermaid-preview"><svg></svg></div>');
    expect(toPng).toHaveBeenCalledTimes(2);
    expect(toPng).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      width: 120, height: 40, style: { boxSizing: 'border-box', overflow: 'visible', maxWidth: 'none' },
    }));
    expect(elements(document, 'drawing')).toHaveLength(2);
    expect(text(document)).toBe('公式');
  } finally { bounds.mockRestore(); vi.doUnmock('html-to-image'); }
});

it('picks one Latin and one CJK font for Word', async () => {
  const { wordFonts } = await import('./word-document-export');
  const { visualFontFamily } = await import('./editor-font');
  expect(wordFonts(visualFontFamily('system', ''))).toEqual({ latin: 'Segoe UI', eastAsia: 'Microsoft YaHei' });
  expect(wordFonts(visualFontFamily('serif', ''))).toEqual({ latin: 'Literata', eastAsia: 'SimSun' });
  expect(wordFonts('"Inter", sans-serif')).toEqual({ latin: 'Inter', eastAsia: 'Inter' });
});
