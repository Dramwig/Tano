import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, HighlightColor,
  ImageRun, LevelFormat, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow,
  TextRun, UnderlineType, WidthType,
} from 'docx';
import type { ILevelsOptions, IParagraphOptions, IRunOptions, ParagraphChild } from 'docx';
import { basename } from '@tano/protocol';
import type { DocumentExportOptions } from './document-export';

const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pageWidth = 11906, pageHeight = 16838, margin = 850;
const contentWidth = (pageWidth - margin * 2) / 15;
const blockTags = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD',
  'FIGURE', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'MAIN', 'NAV',
  'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL']);
const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
type Block = Paragraph | Table;
interface Context {
  width: number;
  indent: number;
  listDepth: number;
  quote?: boolean;
  run?: IRunOptions;
}

function hidden(element: Element) {
  return element.hasAttribute('hidden') || element.matches('script, style, template, textarea, button, .tano-editor-panel');
}

function color(value: string) {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (hex) return (hex[1].length === 3 ? [...hex[1]].map(char => char + char).join('') : hex[1]).toUpperCase();
  const rgb = /^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)$/i.exec(value);
  return rgb ? rgb.slice(1).map(channel => Math.min(255, Number(channel)).toString(16).padStart(2, '0')).join('').toUpperCase() : undefined;
}

function runStyle(element: HTMLElement, inherited: IRunOptions): IRunOptions {
  const tag = element.tagName, style = element.style;
  return {
    ...inherited,
    ...(['B', 'STRONG'].includes(tag) || style.fontWeight === 'bold' ? { bold: true } : {}),
    ...(['I', 'EM'].includes(tag) || style.fontStyle === 'italic' ? { italics: true } : {}),
    ...(['S', 'DEL', 'STRIKE'].includes(tag) ? { strike: true } : {}),
    ...(tag === 'U' ? { underline: { type: UnderlineType.SINGLE } } : {}),
    ...(tag === 'SUP' ? { superScript: true, subScript: false } : {}),
    ...(tag === 'SUB' ? { subScript: true, superScript: false } : {}),
    ...(tag === 'MARK' ? { highlight: HighlightColor.YELLOW } : {}),
    ...(tag === 'CODE' ? { font: 'Consolas' } : {}),
    ...(color(style.color) ? { color: color(style.color) } : {}),
  };
}

function textRuns(text: string, style: IRunOptions): TextRun[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line, index) => new TextRun({ ...style, text: line, ...(index ? { break: 1 } : {}) }));
}

function linkRuns(link: string, children: ParagraphChild[]): ParagraphChild[] {
  // Retain relative workspace links, but never publish a temporary image URL or executable link.
  const scheme = /^([\w+.-]+):/.exec(link)?.[1]?.toLowerCase();
  return link && (!scheme || ['http', 'https', 'mailto', 'tano'].includes(scheme))
    ? [new ExternalHyperlink({ link, children })] : children;
}

async function imageRun(image: HTMLImageElement, maxWidth: number): Promise<ImageRun | TextRun> {
  if (!image.getAttribute('src')) return new TextRun(image.alt || '图片');
  const rect = image.getBoundingClientRect();
  const naturalWidth = image.naturalWidth || image.width || 320;
  const naturalHeight = image.naturalHeight || image.height || 200;
  const width = rect.width || image.width || naturalWidth;
  const height = rect.height || width * naturalHeight / naturalWidth;
  const scale = Math.min(1, maxWidth / width, (pageHeight - margin * 2) / 15 / height);
  const match = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,([\s\S]+)$/i.exec(image.src);
  let type: 'png' | 'jpg' | 'gif' | 'bmp', data: Uint8Array;
  if (match) {
    type = ['jpeg', 'jpg'].includes(match[1].toLowerCase()) ? 'jpg' : match[1].toLowerCase() as typeof type;
    data = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  } else {
    // Word does not support web formats such as WebP and AVIF; rasterize decoded pixels.
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale * 2);
    canvas.height = Math.ceil(height * scale * 2);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法生成 Word 图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    type = 'png';
    data = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), char => char.charCodeAt(0));
  }
  return new ImageRun({ type, data, transformation: { width: width * scale, height: height * scale },
    altText: { name: image.alt || '图片', title: image.alt, description: image.alt } });
}

async function rasterizePreviews(root: HTMLElement) {
  const previews = [...root.querySelectorAll<HTMLElement>('.math-preview, .tano-mermaid-preview')]
    .filter(preview => !preview.closest('[hidden]'));
  if (!previews.length) return;
  const { getFontEmbedCSS, toPng } = await import('html-to-image');
  const fontEmbedCSS = await getFontEmbedCSS(root, { preferredFontFormat: 'woff2' });
  for (const preview of previews) {
    // Editor previews scroll when space is tight. Export the entire expression,
    // with explicit border-box dimensions so cloning cannot add scrollbars.
    preview.style.overflow = 'visible';
    preview.style.maxWidth = 'none';
    preview.style.flexShrink = '0';
    const rect = preview.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const width = Math.ceil(Math.max(rect.width, preview.scrollWidth));
    const height = Math.ceil(Math.max(rect.height, preview.scrollHeight));
    const image = document.createElement('img');
    image.alt = preview.title || (preview.matches('.math-preview') ? 'LaTeX 公式' : 'Mermaid 图表');
    image.width = width;
    image.height = height;
    image.src = await toPng(preview, { backgroundColor: '#ffffff', pixelRatio: 2, fontEmbedCSS, width, height,
      style: { boxSizing: 'border-box', overflow: 'visible', maxWidth: 'none' } });
    preview.replaceWith(image);
  }
}

/** Convert the cleaned editor snapshot to editable Word content. Markdown remains the source. */
export async function renderWordDocument(root: HTMLElement, options: Pick<DocumentExportOptions, 'title' | 'path' | 'fontFamily' | 'fontSize'>): Promise<Blob> {
  await rasterizePreviews(root);
  const numbering: { reference: string; levels: ILevelsOptions[] }[] = [];

  async function inline(nodes: Iterable<Node>, context: Context, inherited = context.run ?? {}): Promise<ParagraphChild[]> {
    const result: ParagraphChild[] = [];
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        result.push(...textRuns(node.textContent ?? '', inherited));
        continue;
      }
      if (!(node instanceof HTMLElement) || hidden(node)) continue;
      const style = runStyle(node, inherited);
      if (node.tagName === 'BR') result.push(new TextRun({ break: 1 }));
      else if (node instanceof HTMLImageElement) result.push(await imageRun(node, context.width));
      else if (node instanceof HTMLInputElement && node.type === 'checkbox') result.push(new TextRun({ text: node.checked ? '☑ ' : '☐ ' }));
      else if (node.matches('[data-tano-reference]')) {
        const label = await inline(node.childNodes, context, style);
        result.push(...linkRuns(node.dataset.referenceUrl ?? '', label.length ? label : textRuns(node.dataset.referenceLabel ?? '', style)));
      } else {
        const children = await inline(node.childNodes, context, style);
        const link = node.tagName === 'A' ? node.dataset.tanoWikiTarget ?? node.getAttribute('href') : null;
        result.push(...(link ? linkRuns(link, children) : children));
      }
    }
    return result;
  }

  function paragraph(children: ParagraphChild[], context: Context, extra: IParagraphOptions = {}) {
    return new Paragraph({ children, spacing: { after: 120, line: 276 },
      ...(context.indent ? { indent: { left: context.indent } } : {}),
      ...(context.quote ? { border: { left: { color: 'CBD5E1', style: BorderStyle.SINGLE, size: 12, space: 8 } } } : {}),
      ...extra,
    });
  }

  async function list(element: HTMLElement, context: Context): Promise<Block[]> {
    const result: Block[] = [];
    const level = Math.min(8, context.listDepth), reference = `list-${numbering.length}`;
    const ordered = element.tagName === 'OL';
    const start = Math.max(1, Number.parseInt(element.getAttribute('start') ?? '1', 10) || 1);
    numbering.push({ reference, levels: Array.from({ length: 9 }, (_, index) => ({
      level: index, format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
      text: ordered ? `%${index + 1}.` : '•', start,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: context.indent + (index + 1) * 360, hanging: 240 } } },
    })) });
    for (const item of element.children) {
      if (!(item instanceof HTMLElement) || item.tagName !== 'LI') continue;
      const itemContext = { ...context, width: Math.max(80, context.width - 24), listDepth: context.listDepth + 1 };
      const task = item.dataset.itemType === 'task' || item.hasAttribute('data-checked');
      let first = true;
      const buffer: Node[] = [];
      const flush = async () => {
        if (!buffer.length && !first) return;
        const children = await inline(buffer, itemContext);
        if (task && first && !item.querySelector('input[type="checkbox"]')) children.unshift(new TextRun(item.dataset.checked === 'true' ? '☑ ' : '☐ '));
        result.push(paragraph(children, context, first && !task ? { numbering: { reference, level } }
          : { indent: { left: context.indent + (level + 1) * 360 } }));
        buffer.length = 0;
        first = false;
      };
      for (const child of item.childNodes) {
        if (child instanceof HTMLElement && ['UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'PRE'].includes(child.tagName)) {
          await flush();
          result.push(...await block(child, itemContext));
        } else if (child instanceof HTMLElement && child.tagName === 'P') {
          if (buffer.length) await flush();
          buffer.push(...child.childNodes);
          await flush();
        } else buffer.push(child);
      }
      if (buffer.length || first) await flush();
    }
    return result;
  }

  async function table(element: HTMLTableElement, context: Context): Promise<Table> {
    const columns = [...element.querySelectorAll('col')].filter(column => column.closest('table') === element);
    const columnCount = Math.max(1, ...[...element.rows].map(row => [...row.cells].reduce((sum, cell) => sum + cell.colSpan, 0)));
    const weights = Array.from({ length: columnCount }, (_, index) => Number.parseFloat(columns[index]?.style.width ?? '') || 1);
    const total = weights.reduce((sum, width) => sum + width, 0);
    const widths = weights.map(width => Math.round(context.width * 15 * width / total));
    const rows: TableRow[] = [];
    for (const row of element.rows) {
      const cells: TableCell[] = [];
      let index = 0;
      for (const cell of row.cells) {
        const width = widths.slice(index, index + cell.colSpan).reduce((sum, value) => sum + value, 0);
        const children = await blocks(cell.childNodes, { ...context, width: Math.max(40, width / 15 - 16), indent: 0, listDepth: 0,
          run: { ...context.run, ...(cell.tagName === 'TH' ? { bold: true } : {}), ...(color(cell.style.color) ? { color: color(cell.style.color) } : {}) } });
        if (!(children.at(-1) instanceof Paragraph)) children.push(new Paragraph(''));
        cells.push(new TableCell({ children, columnSpan: cell.colSpan, rowSpan: cell.rowSpan,
          width: { size: width, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
          shading: { fill: color(cell.style.backgroundColor) ?? (cell.tagName === 'TH' ? 'F1F5F9' : 'FFFFFF') },
        }));
        index += cell.colSpan;
      }
      rows.push(new TableRow({ children: cells, ...([...row.cells].every(cell => cell.tagName === 'TH') ? { tableHeader: true } : {}) }));
    }
    return new Table({ rows, columnWidths: widths, layout: TableLayoutType.FIXED,
      width: { size: Math.round(context.width * 15), type: WidthType.DXA } });
  }

  async function block(element: HTMLElement, context: Context): Promise<Block[]> {
    if (hidden(element)) return [];
    const tag = element.tagName;
    if (tag === 'UL' || tag === 'OL') return list(element, context);
    if (element instanceof HTMLTableElement) return [await table(element, context), paragraph([], context)];
    if (tag === 'BLOCKQUOTE') return blocks(element.childNodes, { ...context, quote: true, indent: context.indent + 360, width: context.width - 24 });
    if (tag === 'PRE') return [paragraph(textRuns(element.textContent ?? '', { font: 'Consolas' }), context,
      { shading: { fill: 'F1F5F9' }, spacing: { after: 160, line: 240 } })];
    if (tag === 'HR') return [paragraph([], context, { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' } } })];
    if (tag === 'P' || /^H[1-6]$/.test(tag)) {
      const heading = element.classList.contains('document-export-title') ? HeadingLevel.TITLE : headings[Number(tag[1]) - 1];
      const alignment = element.style.textAlign;
      return [paragraph(await inline(element.childNodes, context), context, {
        ...(heading ? { heading, keepNext: true, spacing: { before: 240, after: 160 } } : {}),
        ...(['left', 'center', 'right', 'justify'].includes(alignment) ? { alignment: alignment === 'justify' ? AlignmentType.JUSTIFIED : alignment as 'left' | 'center' | 'right' } : {}),
      })];
    }
    if (element.matches('.tano-resource') && !element.querySelector('img')) {
      return [paragraph(linkRuns(element.dataset.url ?? '', textRuns(element.dataset.title || element.dataset.url || element.textContent || '', {})), context)];
    }
    return blocks(element.childNodes, context);
  }

  async function blocks(nodes: Iterable<Node>, context: Context): Promise<Block[]> {
    const result: Block[] = [], buffer: Node[] = [];
    const flush = async () => {
      if (buffer.some(node => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim())) result.push(paragraph(await inline(buffer, context), context));
      buffer.length = 0;
    };
    for (const node of nodes) {
      if (node instanceof HTMLElement && blockTags.has(node.tagName)) {
        await flush();
        result.push(...await block(node, context));
      } else buffer.push(node);
    }
    await flush();
    return result;
  }

  const children = await blocks(root.childNodes, { width: contentWidth, indent: 0, listDepth: 0 });
  const font = options.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '') || 'Arial';
  const document = new Document({ creator: 'Tano', title: options.title ?? basename(options.path),
    styles: { default: { document: { run: { font: { name: font, eastAsia: font }, size: Math.round(options.fontSize * 1.5), color: '24272B' } } } },
    numbering: { config: numbering },
    sections: [{ properties: { page: { size: { width: pageWidth, height: pageHeight }, margin: { top: margin, bottom: margin, left: margin, right: margin } } },
      children: children.length ? children : [new Paragraph('')] }],
  });
  return new Blob([await Packer.toArrayBuffer(document)], { type: mime });
}
