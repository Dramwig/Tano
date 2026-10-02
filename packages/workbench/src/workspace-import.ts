import { basename, parentPath, pathKey, relativeWorkspaceReference, resolveWorkspaceReference, validatePath } from '@tano/protocol';
import type { WorkspaceAdapter } from '@tano/protocol';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import type { Nodes } from 'mdast';
import { splitFrontmatter } from '@tano/editor/syntax';
import { importLimits } from './document-import';
import type { PreparedImport, ImportIssue } from './document-import';

const parser = unified().use(remarkParse).use(remarkGfm);

export function rewriteImportLinks(content: string, sourcePath: string, destination: string, mapping: ReadonlyMap<string, string>) {
  const { body } = splitFrontmatter(content);
  const offset = content.length - body.length;
  const changes: { from: number; to: number; text: string }[] = [];
  function resolve(url: string, wiki = false) {
    if (/^(?:[\w+.-]+:|\/\/|#)/.test(url)) return null;
    const fragment = url.indexOf('#');
    const target = fragment < 0 ? url : url.slice(0, fragment);
    const suffix = fragment < 0 ? '' : url.slice(fragment);
    const source = resolveWorkspaceReference(sourcePath, target);
    let mapped = source ? mapping.get(pathKey(source)) : undefined;
    if (!mapped && wiki) {
      mapped = source ? mapping.get(pathKey(`${source}.md`)) : undefined;
      if (!mapped) {
        const matches = [...mapping].filter(([path]) => basename(path) === pathKey(target) || basename(path) === pathKey(`${target}.md`));
        if (matches.length === 1) mapped = matches[0][1];
      }
    }
    if (!mapped) return null;
    return `${mapped.startsWith('data:') ? mapped : relativeWorkspaceReference(destination, mapped)}${suffix}`;
  }
  function visit(node: Nodes) {
    const start = 'position' in node ? node.position?.start.offset : undefined;
    const end = 'position' in node ? node.position?.end.offset : undefined;
    const from = start === undefined ? undefined : start + offset;
    const to = end === undefined ? undefined : end + offset;
    if (from !== undefined && to !== undefined) {
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
        const url = resolve(node.url);
        if (url) changes.push({ from, to, text: toMarkdown({ ...node, url }).trimEnd() });
        return;
      }
      if (node.type === 'text') {
        const raw = content.slice(from, to);
        for (const match of raw.matchAll(/(!?)\[\[([^\[\]\r\n]+)\]\]/g)) {
          let slashes = 0;
          for (let index = match.index - 1; index >= 0 && raw[index] === '\\'; index--) slashes++;
          if (slashes % 2) continue;
          const [target, alias] = match[2].split('|');
          const url = resolve(target, true);
          if (url) changes.push({ from: from + match.index, to: from + match.index + match[0].length,
            text: `${match[1]}[${(alias || basename(target).replace(/\.md$/i, '')).replace(/[\[\]\\]/g, '\\$&')}](${url})` });
        }
        return;
      }
    }
    if ('children' in node) node.children.forEach(visit);
  }
  visit(parser.parse(body));
  for (const change of changes.sort((left, right) => right.from - left.from)) content = content.slice(0, change.from) + change.text + content.slice(change.to);
  return content;
}

export interface ImportReceipt {
  folder: string;
  paths: string[];
  issues: ImportIssue[];
}

export async function writeWorkspaceImport(
  adapter: WorkspaceAdapter,
  prepared: PreparedImport,
  folderName: string,
  expectedWorkspaceId: string,
  options: {
    importAsset?: (file: File, documentPath: string) => Promise<string>;
    progress?: (done: number, total: number) => void;
  } = {},
): Promise<ImportReceipt> {
  if (!prepared.pages.length) throw new Error('没有可导入的页面');
  if (folderName.includes('/') || validatePath(folderName) || folderName.length > 40) throw new Error('请输入不超过 40 个字符的有效文件夹名称');
  const workspace = await adapter.refresh();
  if (workspace.id !== expectedWorkspaceId) throw new Error('工作区已切换，请重新选择导入文件');
  if (workspace.readOnly) throw new Error('你在此工作区只有阅读权限');
  const occupied = new Set(workspace.files.map(file => pathKey(file.path)));
  let folder = folderName;
  for (let index = 2; occupied.has(pathKey(folder)); index++) folder = `${folderName} ${index}`;
  const paths = prepared.pages.map(page => `${folder}/${page.path}`);
  if (paths.some(path => validatePath(path))) throw new Error('导入路径无效，请缩短文件夹或文件名称');
  if (new Set(paths.map(pathKey)).size !== paths.length) throw new Error('导入列表包含重复路径');
  const mapping = new Map(prepared.pages.map((page, index) => [pathKey(page.sourcePath), paths[index]]));
  const receipt: ImportReceipt = { folder, paths: [], issues: [] };
  // Reserve a new folder before writing; every adapter.create must refuse existing files.
  await adapter.createFolder(folder);
  const directories = new Set([folder]);
  async function ensureParent(path: string) {
    const parts = parentPath(path).split('/');
    for (let index = 1; index <= parts.length; index++) {
      const directory = parts.slice(0, index).join('/');
      if (directories.has(directory)) continue;
      await adapter.createFolder(directory);
      directories.add(directory);
    }
  }
  for (const asset of prepared.assets) {
    try {
      let target: string;
      if (options.importAsset) target = await options.importAsset(asset.file, paths[0]);
      else {
        if (asset.file.size > importLimits.fileBytes) throw new Error('附件超过 50 MiB');
        const bytes = new Uint8Array(await asset.file.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        const mime = asset.file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[basename(asset.sourcePath).split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream');
        target = `data:${mime};base64,${btoa(binary)}`;
      }
      mapping.set(pathKey(asset.sourcePath), target);
    } catch (error) { receipt.issues.push({ name: asset.sourcePath, message: `附件未导入：${error instanceof Error ? error.message : String(error)}` }); }
  }
  for (const [index, page] of prepared.pages.entries()) {
    try {
      const path = paths[index];
      await ensureParent(path);
      await adapter.create(path, rewriteImportLinks(page.content, page.sourcePath, path, mapping));
      receipt.paths.push(path);
    } catch (error) { receipt.issues.push({ name: page.sourcePath, message: error instanceof Error ? error.message : String(error) }); }
    options.progress?.(index + 1, prepared.pages.length);
  }
  return receipt;
}
