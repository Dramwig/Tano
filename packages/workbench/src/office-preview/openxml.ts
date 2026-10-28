import { attr, children, named, relationships, xml } from './archive';
import type { Element } from '@xmldom/xmldom';
import { officeErrors, officeLimits, type OfficeBlock, type OfficePage, type OfficePreview, type OfficeRun } from './model';

type Archive = Record<string, Uint8Array>;
function picture(files: Archive, rels: Map<string, string>, node: Element): OfficeBlock | undefined {
  const path = rels.get(attr(node, 'embed'));
  const bytes = path ? files[path] : undefined;
  if (!bytes || bytes.length > officeLimits.imageBytes) return;
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const mime = starts(137, 80, 78, 71, 13, 10, 26, 10) ? 'image/png'
    : starts(255, 216, 255) ? 'image/jpeg'
    : starts(71, 73, 70, 56) ? 'image/gif'
    : starts(82, 73, 70, 70) && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP' ? 'image/webp'
    : starts(66, 77) ? 'image/bmp' : '';
  if (!mime) return; // SVG, linked images, OLE and active content never enter the renderer.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { kind: 'image', src: `data:${mime};base64,${btoa(binary)}`, alt: path!.split('/').at(-1) ?? '' };
}
function enabled(node: Element | undefined) { return !!node && !['0', 'false', 'off'].includes(attr(node, 'val')); }

/** Flow reading view, intentionally independent of Word's page geometry. */
function wordBlocks(files: Archive, rels: Map<string, string>, parent: Element, depth = 0): OfficeBlock[] {
  if (depth > 32) throw new Error(officeErrors.limit);
  const blocks: OfficeBlock[] = [];
  for (const node of children(parent)) {
    if (node.localName === 'p') {
      let runs: OfficeRun[] = [];
      const headingName = attr(named(node, 'pStyle')[0] ?? node, 'val');
      const heading = /^(?:heading|标题)\s*([1-6])$/i.exec(headingName)?.[1];
      const flush = () => {
        if (runs.length) blocks.push({ kind: 'paragraph', runs, ...(heading ? { heading: Number(heading) } : {}) });
        runs = [];
      };
      if (named(node, 'numPr').length) runs.push({ text: '• ' });
      function walk(element: Element, style: Omit<OfficeRun, 'text'> = {}, level = 0) {
        if (level > 64) throw new Error(officeErrors.limit);
        const name = element.localName ?? '';
        if (['del', 'instrText', 'pPr', 'rPr'].includes(name)) return;
        if (name === 'r') {
          const properties = children(element).find(item => item.localName === 'rPr');
          if (properties) style = { bold: enabled(named(properties, 'b')[0]), italic: enabled(named(properties, 'i')[0]),
            underline: enabled(named(properties, 'u')[0]) && attr(named(properties, 'u')[0], 'val') !== 'none' };
        }
        if (name === 't') runs.push({ text: element.textContent ?? '', ...style });
        else if (name === 'tab') runs.push({ text: '\t' });
        else if (name === 'br' || name === 'cr') runs.push({ text: '\n' });
        else if (name === 'blip') { const image = picture(files, rels, element); if (image) { flush(); blocks.push(image); } }
        else for (const child of children(element)) walk(child, style, level + 1);
      }
      walk(node); flush();
    } else if (node.localName === 'tbl') {
      const rows = children(node).filter(item => item.localName === 'tr').map(row =>
        children(row).filter(item => item.localName === 'tc').map(cell => ({
          blocks: wordBlocks(files, rels, cell, depth + 1),
          colspan: Math.max(1, Math.min(200, Number(attr(named(cell, 'gridSpan')[0] ?? cell, 'val')) || 1)),
        })));
      blocks.push({ kind: 'table', rows });
    } else if (!['sectPr', 'del'].includes(node.localName ?? '')) blocks.push(...wordBlocks(files, rels, node, depth + 1));
    if (blocks.length > officeLimits.blocks) throw new Error(officeErrors.limit);
  }
  return blocks;
}
export function wordDocument(files: Archive): OfficePreview {
  const part = 'word/document.xml';
  const body = named(xml(files[part]), 'body')[0];
  if (!body) throw new Error(officeErrors.invalid);
  const blocks = wordBlocks(files, relationships(files, part), body);
  // Bound DOM size while retaining every extracted block. These are reading sections, not printed pages.
  const pages: OfficePage[] = [];
  for (let offset = 0; offset < blocks.length; offset += 200) pages.push({ name: '', blocks: blocks.slice(offset, offset + 200) });
  return { kind: 'document', pages: pages.length ? pages : [{ name: '', blocks: [] }], legacy: false };
}
function slideParagraph(node: Element): OfficeBlock {
  const runs: OfficeRun[] = [];
  for (const child of children(node)) {
    if (child.localName === 'br') runs.push({ text: '\n' });
    if (['r', 'fld'].includes(child.localName ?? '')) {
      const properties = children(child).find(item => item.localName === 'rPr');
      runs.push({ text: named(child, 't').map(item => item.textContent ?? '').join(''),
        bold: properties ? ['1', 'true'].includes(attr(properties, 'b')) : false,
        italic: properties ? ['1', 'true'].includes(attr(properties, 'i')) : false });
    }
  }
  const properties = children(node).find(item => item.localName === 'pPr');
  if (properties && named(properties, 'buChar').length) runs.unshift({ text: `${attr(named(properties, 'buChar')[0], 'char') || '•'} ` });
  return { kind: 'paragraph', runs };
}
function slideBlocks(files: Archive, rels: Map<string, string>, node: Element, depth = 0): OfficeBlock[] {
  if (depth > 32) throw new Error(officeErrors.limit);
  if (node.localName === 'p') return [slideParagraph(node)];
  if (node.localName === 'blip') { const image = picture(files, rels, node); return image ? [image] : []; }
  if (node.localName === 'tbl') return [{ kind: 'table', rows: children(node).filter(item => item.localName === 'tr').map(row =>
    children(row).filter(item => item.localName === 'tc').map(cell => ({ blocks: slideBlocks(files, rels, cell, depth + 1), colspan: 1 }))) }];
  // Drawing properties, extensions and cached metadata are not visible slide text.
  if (['extLst', 'spPr', 'nvSpPr', 'nvPicPr', 'nvGraphicFramePr'].includes(node.localName ?? '')) return [];
  return children(node).flatMap(child => slideBlocks(files, rels, child, depth + 1));
}
export function presentation(files: Archive): OfficePreview {
  const part = 'ppt/presentation.xml';
  const document = xml(files[part]);
  const rels = relationships(files, part);
  const slides = named(document, 'sldId');
  if (!slides.length || slides.length > officeLimits.pages) throw new Error(officeErrors.limit);
  const pages = slides.map(slide => {
    // Both id and r:id exist on sldId; resolve by namespace, never by ZIP filename order.
    const id = Array.from(slide.attributes).find(attribute => attribute.localName === 'id' && !!attribute.prefix)?.value;
    const path = id ? rels.get(id) : undefined;
    if (!path) throw new Error(officeErrors.invalid);
    const root = xml(files[path]).documentElement;
    if (!root || root.localName !== 'sld') throw new Error(officeErrors.invalid);
    const blocks = slideBlocks(files, relationships(files, path), root);
    return { name: '', blocks };
  });
  return { kind: 'presentation', pages, legacy: false };
}
