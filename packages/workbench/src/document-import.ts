/// <reference path="./import-vendors.d.ts" />
import { unzip } from 'fflate';
import { basename, parentPath, pathKey, validatePath } from '@tano/protocol';

export interface ImportPage { sourcePath: string; path: string; content: string }
export interface ImportAsset { sourcePath: string; file: File }
export interface ImportIssue { name: string; message: string }
export interface PreparedImport { pages: ImportPage[]; assets: ImportAsset[]; issues: ImportIssue[] }
export const importAccept = '.md,.markdown,.txt,.log,.csv,.tsv,.html,.htm,.docx,.pdf,.epub,.zip,.enex,.json';
export const importLimits = { fileBytes: 50 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, entries: 2000 };
const documentExtensions = new Set(importAccept.split(',').map(value => value.slice(1)));
const extension = (path: string) => path.split('.').at(-1)?.toLowerCase() ?? '';

export function importName(name: string) {
  let value = name.normalize('NFC').replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_').replace(/^\.+|[. ]+$/g, '').trim();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`;
  return value.slice(0, 64).replace(/[. ]+$/g, '') || '未命名';
}

export function importPagePath(source: string) {
  const parts = source.split('/').map(importName);
  parts[parts.length - 1] = `${importName(basename(source).replace(/\.[^.]+$/, ''))}.md`;
  const path = parts.join('/');
  if (path.length > 170 || validatePath(path)) throw new Error('文件路径过长，请缩短目录名称后重试');
  return path;
}

function validSourcePath(path: string) {
  return !!path && !path.startsWith('/') && !path.includes('\\') && !/^[a-z]:/i.test(path)
    && path.split('/').every(part => !!part && part !== '..' && part !== '.' && !part.startsWith('.'));
}

function decode(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

function xmlDocument(source: string) {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 文件格式无效');
  return doc;
}

function dataAsset(url: string, path: string): ImportAsset | null {
  const match = url.match(/^data:([\w.+/-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  if (match[2].length > importLimits.fileBytes * 1.4) throw new Error('内嵌附件超过 50 MiB');
  const binary = atob(match[2].replace(/\s/g, ''));
  if (binary.length > importLimits.fileBytes) throw new Error('内嵌附件超过 50 MiB');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const suffix = match[1].split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
  return { sourcePath: `${path}.${suffix}`, file: new File([bytes], `${basename(path)}.${suffix}`, { type: match[1] }) };
}

async function htmlMarkdown(source: string, sourcePath: string, assets: ImportAsset[]) {
  const [{ default: TurndownService }, { gfm }] = await Promise.all([import('turndown'), import('turndown-plugin-gfm')]);
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,template,link,meta').forEach(node => node.remove());
  for (const node of doc.querySelectorAll('[href], [src]')) {
    for (const attribute of ['href', 'src']) {
      const url = node.getAttribute(attribute);
      if (!url) continue;
      if (url.startsWith('data:')) {
        const asset = dataAsset(url, `${parentPath(sourcePath) ? `${parentPath(sourcePath)}/` : ''}${basename(sourcePath)}_附件/${assets.length + 1}`);
        if (asset) {
          assets.push(asset);
          node.setAttribute(attribute, asset.sourcePath.slice(parentPath(sourcePath).length + (parentPath(sourcePath) ? 1 : 0)));
        } else node.removeAttribute(attribute);
      } else {
        const normalized = url.replace(/[\u0000-\u0020]/g, '');
        if (/^[\w+.-]+:/.test(normalized) && !/^(https?:|mailto:)/i.test(normalized)) node.removeAttribute(attribute);
      }
    }
  }
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  converter.use(gfm);
  return converter.turndown(doc.body).trim() + '\n';
}

function cell(value: unknown) { return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'); }

async function csvMarkdown(source: string, delimiter: string) {
  const { default: Papa } = await import('papaparse');
  const result = Papa.parse<string[]>(source, { delimiter, skipEmptyLines: 'greedy' });
  if (result.errors.length) throw new Error(`表格格式无效：${result.errors[0].message}`);
  if (!result.data.length) throw new Error('表格为空');
  const width = result.data.reduce((width, row) => Math.max(width, row.length), 0);
  if (width > 200 || result.data.length > 20000) throw new Error('表格不能超过 200 列或 20,000 行');
  const row = (values: string[]) => `| ${Array.from({ length: width }, (_, index) => cell(values[index])).join(' | ')} |`;
  return [row(result.data[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...result.data.slice(1).map(row)].join('\n') + '\n';
}

async function archive(bytes: Uint8Array) {
  let total = 0, count = 0, error = '';
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(bytes, {
    filter: entry => {
      if (entry.name.endsWith('/') || entry.name.startsWith('__MACOSX/')) return false;
      if (!validSourcePath(entry.name)) {
        if (entry.name.split('/').some(part => part === '..' || part === '.') || !entry.name.split('/').some(part => part.startsWith('.'))) error = '压缩包包含不安全的路径';
        return false;
      }
      total += entry.originalSize;
      if (++count > importLimits.entries || total > importLimits.totalBytes || entry.originalSize > importLimits.fileBytes) {
        error = '压缩包最多包含 2,000 个文件，解压后总大小不能超过 100 MiB，单文件不能超过 50 MiB'; return false;
      }
      return true;
    },
  }, (failure, result) => failure ? reject(new Error('无法解压文件，请检查 ZIP 是否损坏或加密')) : resolve(result)));
  if (error) throw new Error(error);
  return files;
}

async function pdfMarkdown(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist');
  const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 500) throw new Error('PDF 不能超过 500 页');
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim());
      page.cleanup();
    }
    if (!pages.some(page => page.trim())) throw new Error('PDF 没有可提取的文字；扫描件需要先进行 OCR');
    return pages.join('\n\n---\n\n') + '\n';
  } finally { await task.destroy(); }
}

async function epubPages(bytes: Uint8Array, sourcePath: string, assets: ImportAsset[]) {
  const entries = await archive(bytes);
  const container = entries['META-INF/container.xml'];
  if (!container) throw new Error('EPUB 缺少目录信息');
  const packagePath = xmlDocument(decode(container)).getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!packagePath || !entries[packagePath]) throw new Error('EPUB 缺少书籍信息');
  const doc = xmlDocument(decode(entries[packagePath]));
  const items = new Map([...doc.getElementsByTagName('item')].map(item => [item.getAttribute('id'), item]));
  const prefix = sourcePath.replace(/\.[^.]+$/, '');
  const base = parentPath(packagePath);
  const pages: ImportPage[] = [];
  if (doc.getElementsByTagName('itemref').length > importLimits.entries) throw new Error('EPUB 章节超过 2,000 个，请分批导入');
  for (const item of doc.getElementsByTagName('itemref')) {
    const href = items.get(item.getAttribute('idref'))?.getAttribute('href');
    if (!href) continue;
    const path = `${base ? `${base}/` : ''}${decodeURIComponent(href.split('#')[0])}`;
    if (!entries[path]) throw new Error(`EPUB 缺少章节：${href}`);
    const source = `${prefix}/${path}`;
    pages.push({ sourcePath: source, path: importPagePath(source), content: await htmlMarkdown(decode(entries[path]), source, assets) });
  }
  for (const [path, data] of Object.entries(entries)) {
    if (!/\.(png|jpe?g|gif|webp|svg|avif|mp3|mp4|ogg)$/i.test(path)) continue;
    assets.push({ sourcePath: `${prefix}/${path}`, file: new File([data as Uint8Array<ArrayBuffer>], basename(path)) });
  }
  if (!pages.length) throw new Error('EPUB 没有可导入的章节');
  return pages;
}

async function enexPages(source: string, sourcePath: string, assets: ImportAsset[]) {
  const doc = xmlDocument(source);
  const pages: ImportPage[] = [];
  const prefix = sourcePath.replace(/\.[^.]+$/, '');
  if (doc.getElementsByTagName('note').length > importLimits.entries) throw new Error('ENEX 笔记超过 2,000 个，请分批导入');
  for (const [index, note] of [...doc.getElementsByTagName('note')].entries()) {
    const name = note.querySelector('title')?.textContent ?? `笔记 ${index + 1}`;
    const path = `${prefix}/${index + 1}-${importName(name)}.html`;
    const content = xmlDocument(note.querySelector('content')?.textContent ?? '<en-note/>');
    const resources = new Map<string, string>();
    for (const [resourceIndex, resource] of [...note.getElementsByTagName('resource')].entries()) {
      const data = resource.querySelector('data')?.textContent?.replace(/\s/g, '');
      const mime = resource.querySelector('mime')?.textContent;
      if (!data || !mime) continue;
      const asset = dataAsset(`data:${mime};base64,${data}`, `${prefix}/附件/${index + 1}-${resourceIndex + 1}`);
      if (!asset) continue;
      assets.push(asset);
      const { md5 } = await import('js-md5');
      resources.set(md5(await asset.file.arrayBuffer()), asset.sourcePath.slice(prefix.length + 1));
    }
    for (const media of [...content.getElementsByTagName('en-media')]) {
      const url = resources.get(media.getAttribute('hash') ?? '');
      const node = content.createElement(media.getAttribute('type')?.startsWith('image/') ? 'img' : 'a');
      if (url) node.setAttribute(node.tagName === 'img' ? 'src' : 'href', url);
      node.textContent = media.getAttribute('type') ?? '附件';
      media.replaceWith(node);
    }
    for (const todo of [...content.getElementsByTagName('en-todo')]) todo.replaceWith(content.createTextNode(todo.getAttribute('checked') === 'true' ? '[x] ' : '[ ] '));
    pages.push({ sourcePath: path, path: importPagePath(path), content: `# ${name.replace(/[\r\n]/g, ' ')}\n\n${await htmlMarkdown(new XMLSerializer().serializeToString(content), path, assets)}` });
  }
  if (!pages.length) throw new Error('ENEX 文件中没有笔记');
  return pages;
}

function jsonPages(source: string, sourcePath: string): ImportPage[] {
  const value: unknown = JSON.parse(source);
  const prefix = sourcePath.replace(/\.[^.]+$/, '');
  if (value && typeof value === 'object' && 'cards' in value && 'lists' in value) {
    const board = value as { name?: string; cards: { name: string; desc?: string; idList: string; closed?: boolean; due?: string; id?: string }[];
      lists: { id: string; name: string }[]; checklists?: { idCard: string; name: string; checkItems: { name: string; state: string }[] }[] };
    if (!Array.isArray(board.cards) || !Array.isArray(board.lists)) throw new Error('Trello 导出格式无效');
    const content = [`# ${board.name ?? basename(prefix)}`];
    for (const list of board.lists) {
      content.push(`\n## ${list.name}`);
      for (const card of board.cards.filter(card => card.idList === list.id)) {
        content.push(`\n### ${card.name}\n`, card.desc ?? '');
        if (card.closed) content.push('\n状态：已归档');
        if (card.due) content.push(`\n截止时间：${card.due}`);
        for (const checklist of board.checklists?.filter(item => item.idCard === card.id) ?? []) {
          content.push(`\n#### ${checklist.name}\n`);
          for (const item of checklist.checkItems) content.push(`- [${item.state === 'complete' ? 'x' : ' '}] ${item.name}`);
        }
      }
    }
    return [{ sourcePath, path: importPagePath(sourcePath), content: content.join('\n') + '\n' }];
  }
  if (Array.isArray(value) && value.every(page => page && typeof page.title === 'string' && Array.isArray(page.children))) {
    if (value.length > importLimits.entries) throw new Error('Roam 页面超过 2,000 个，请分批导入');
    return value.map((page: { title: string; children: unknown[] }, index) => {
      const lines = [`# ${page.title}\n`];
      let count = 0;
      function visit(children: unknown[], depth: number) {
        if (depth > 100 || count > 20000) throw new Error('Roam 页面层级或块数量超过限制');
        for (const child of children) {
          if (!child || typeof child !== 'object' || !('string' in child) || typeof child.string !== 'string') throw new Error('Roam 块格式无效');
          count++;
          lines.push(`${'  '.repeat(depth)}- ${child.string.replace(/\{\{\[\[TODO\]\]\}\}/g, '[ ]').replace(/\{\{\[\[DONE\]\]\}\}/g, '[x]').replace(/\n/g, `\n${'  '.repeat(depth + 1)}`)}`);
          if ('children' in child && Array.isArray(child.children)) visit(child.children, depth + 1);
        }
      }
      visit(page.children, 0);
      const path = `${prefix}/${index + 1}-${importName(page.title)}.md`;
      return { sourcePath: `${prefix}/${page.title}.md`, path: importPagePath(path), content: lines.join('\n') + '\n' };
    });
  }
  throw new Error('JSON 目前支持 Trello 看板和 Roam Research 导出');
}

export async function prepareImport(files: readonly File[], progress?: (name: string) => void): Promise<PreparedImport> {
  const result: PreparedImport = { pages: [], assets: [], issues: [] };
  let total = 0, count = 0;
  async function convert(path: string, bytes: Uint8Array, depth = 0) {
    if (++count > importLimits.entries || (total += bytes.byteLength) > importLimits.totalBytes) throw new Error('本次导入最多 2,000 个文件、100 MiB');
    if (bytes.byteLength > importLimits.fileBytes) throw new Error('单文件不能超过 50 MiB');
    const ext = extension(path);
    progress?.(path);
    if (ext === 'zip') {
      if (depth >= 3) throw new Error('ZIP 嵌套不能超过 3 层');
      const prefix = path.replace(/\.zip$/i, '');
      const entries = await archive(bytes);
      for (const [name, data] of Object.entries(entries)) {
        try { await convert(`${prefix}/${name}`, data, depth + 1); }
        catch (error) { result.issues.push({ name: `${prefix}/${name}`, message: error instanceof Error ? error.message : String(error) }); }
      }
      return;
    }
    if (!documentExtensions.has(ext)) {
      result.assets.push({ sourcePath: path, file: new File([bytes as Uint8Array<ArrayBuffer>], basename(path)) }); return;
    }
    if (ext === 'epub') { result.pages.push(...await epubPages(bytes, path, result.assets)); return; }
    if (ext === 'enex') { result.pages.push(...await enexPages(decode(bytes), path, result.assets)); return; }
    if (ext === 'json') { result.pages.push(...jsonPages(decode(bytes), path)); return; }
    let content: string;
    if (ext === 'docx') {
      const mammoth = await import('mammoth/mammoth.browser');
      const converted = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer as ArrayBuffer });
      content = await htmlMarkdown(converted.value, path, result.assets);
      for (const warning of converted.messages) result.issues.push({ name: path, message: warning.message });
    } else if (ext === 'pdf') content = await pdfMarkdown(bytes);
    else if (ext === 'html' || ext === 'htm') content = await htmlMarkdown(decode(bytes), path, result.assets);
    else if (ext === 'csv' || ext === 'tsv') content = await csvMarkdown(decode(bytes), ext === 'tsv' ? '\t' : '');
    else content = decode(bytes).replace(/\r\n/g, '\n');
    result.pages.push({ sourcePath: path, path: importPagePath(path), content });
  }
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    try {
      if (!validSourcePath(path)) throw new Error('文件路径无效');
      if (file.size > importLimits.fileBytes) throw new Error('单文件不能超过 50 MiB');
      await convert(path, new Uint8Array(await file.arrayBuffer()));
    } catch (error) { result.issues.push({ name: path, message: error instanceof Error ? error.message : String(error) }); }
  }
  const outputBytes = result.assets.reduce((sum, asset) => sum + asset.file.size, 0)
    + result.pages.reduce((sum, page) => sum + new TextEncoder().encode(page.content).byteLength, 0);
  if (outputBytes > importLimits.totalBytes) throw new Error('转换后的内容超过 100 MiB，请分批导入');
  const occupied = new Set<string>();
  for (const page of result.pages) {
    const initial = page.path.replace(/\.md$/, '');
    for (let index = 2; occupied.has(pathKey(page.path)); index++) page.path = `${initial} ${index}.md`;
    occupied.add(pathKey(page.path));
  }
  if (result.pages.length > importLimits.entries) throw new Error('生成的页面超过 2,000 个，请分批导入');
  return result;
}
