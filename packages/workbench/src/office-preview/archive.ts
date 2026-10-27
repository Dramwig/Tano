import { unzipSync } from 'fflate';
import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
import { officeErrors, officeLimits } from './model';

export function officeArchive(bytes: Uint8Array) {
  let total = 0, entries = 0;
  const files = unzipSync(bytes, { filter(entry) {
    if (++entries > officeLimits.entries || entry.originalSize > officeLimits.entryBytes ||
      (total += entry.originalSize) > officeLimits.expandedBytes) throw new Error(officeErrors.limit);
    if (entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').some(p => p === '..'))
      throw new Error(officeErrors.invalid);
    return /\.(xml|rels|png|jpe?g|gif|webp|bmp)$/i.test(entry.name);
  } });
  return files;
}
export function xml(bytes: Uint8Array | undefined): Document {
  if (!bytes) throw new Error(officeErrors.invalid);
  const text = new TextDecoder().decode(bytes);
  // Office parts do not need DTDs. Never expand entities or resolve external resources.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(officeErrors.invalid);
  return new DOMParser({ onError: () => { throw new Error(officeErrors.invalid); } })
    .parseFromString(text, 'application/xml');
}
export const children = (node: Node): Element[] => Array.from(node.childNodes).filter(node => node.nodeType === 1) as Element[];
export const named = (node: Element | Document, name: string): Element[] => Array.from(node.getElementsByTagNameNS('*', name));
export function attr(node: Element, name: string) {
  return Array.from(node.attributes).find(attribute => attribute.localName === name)?.value ?? '';
}
export function relationships(files: Record<string, Uint8Array>, part: string) {
  const slash = part.lastIndexOf('/');
  const relPath = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
  const result = new Map<string, string>();
  if (!files[relPath]) return result;
  for (const rel of named(xml(files[relPath]), 'Relationship')) {
    const target = attr(rel, 'Target');
    if (attr(rel, 'TargetMode') === 'External' || /^[a-z][\w+.-]*:/i.test(target) || target.includes('\\')) continue;
    const path: string[] = target.startsWith('/') ? [] : part.slice(0, slash).split('/');
    for (const segment of target.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') { if (!path.length) throw new Error(officeErrors.invalid); path.pop(); }
      else path.push(segment);
    }
    result.set(attr(rel, 'Id'), path.join('/'));
  }
  return result;
}
