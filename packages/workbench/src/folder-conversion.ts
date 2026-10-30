import { basename, isMarkdown, isWorkspaceInternalPath, parentPath, pathKey, relativeWorkspaceReference, resolveWorkspaceReference,
  validatePath, type FileEntry, type FileSnapshot, type WorkspaceAdapter } from '@tano/protocol';
import { rewriteDocumentLinks } from '@tano/editor/document-links';
import { mergeMarkdown } from '@tano/markdown';
import { indexFolderHomes, type FolderHomeFileName } from './folder-home';
import { resolveWikiLink } from './wiki-links';
import { assistantHash } from './assistant/hash';
import { appearanceProperty, appearanceText, updateAppearance } from './document-appearance';

export type FolderConversionKind = 'child' | 'flatten';
export function planFolderConversion(entries: FileEntry[], selected: FileEntry, filename: FolderHomeFileName, kind: FolderConversionKind) {
  if (!filename) throw new Error('请先在工作区设置中启用文件夹首页');
  const source = entries.find(file => file.id === selected.id && file.path === selected.path && file.kind === selected.kind);
  if (!source || isWorkspaceInternalPath(source.path)) throw new Error('文件位置已变化，请刷新后重试');
  if (source.readOnly) throw new Error('你对此条目只有阅读权限');
  const homes = indexFolderHomes(entries, filename);
  let home: FileEntry, folder: string, destination: string, createFolder = false;
  if (kind === 'flatten') {
    folder = source.kind === 'directory' ? source.path : parentPath(source.path);
    home = homes.get(folder)!;
    if (!home || (source.kind === 'file' && source.id !== home.id)) throw new Error('此条目不是文件夹首页');
    if (entries.some(file => file.path.startsWith(`${folder}/`) && file.id !== home.id))
      throw new Error('文件夹中还有其他文件、附件或子目录，请先移走后再转换');
    destination = `${folder}.md`;
  } else if (source.kind === 'directory' || homes.get(parentPath(source.path))?.id === source.id) {
    folder = source.kind === 'directory' ? source.path : parentPath(source.path);
    home = homes.get(folder)!;
    if (!home) throw new Error('此文件夹尚未设置首页');
    destination = home.path;
  } else {
    if (!isMarkdown(source.path)) throw new Error('只有 Markdown 文档可以添加子文档');
    home = source;
    folder = source.path.replace(/\.(md|markdown)$/i, '');
    destination = `${folder}/${filename}`;
    createFolder = true;
    if (entries.some(file => pathKey(file.path) === pathKey(folder))) throw new Error('同名文件夹或文件已存在，请先重命名');
  }
  if (home.readOnly || entries.some(file => file.kind === 'directory' && file.readOnly &&
    (folder === file.path || folder.startsWith(`${file.path}/`)))) throw new Error('你对此目录或首页只有阅读权限');
  for (const path of [folder, destination]) { const error = validatePath(path); if (error) throw new Error(error); }
  if (destination !== home.path && entries.some(file => pathKey(file.path) === pathKey(destination)))
    throw new Error('目标文档已经存在，请先重命名');
  let childPath = `${folder}/新建文档.md`;
  for (let i = 2; entries.some(file => pathKey(file.path) === pathKey(childPath)) || pathKey(childPath) === pathKey(destination); i++)
    childPath = `${folder}/新建文档 ${i}.md`;
  return { home, folder, destination, createFolder, childPath: kind === 'child' ? childPath : undefined };
}

export function rewriteConversionLinks(content: string, sourcePath: string, moved: FileEntry, destination: string, entries: FileEntry[]) {
  const nextSource = sourcePath === moved.path ? destination : sourcePath;
  const future = entries.map(file => file.id === moved.id ? { ...file, path: destination, name: basename(destination) } : file);
  const rewrite = (link: { kind: 'markdown' | 'wiki'; target: string }) => {
    if (link.kind === 'wiki') {
      const old = resolveWikiLink(entries, sourcePath, link.target);
      if (!('file' in old)) return link.target;
      const next = resolveWikiLink(future, nextSource, link.target);
      if ('file' in next && next.file.id === old.file.id) return link.target;
      const target = old.file.id === moved.id ? destination : old.file.path;
      return relativeWorkspaceReference(nextSource, target) + (old.heading ? `#${old.heading}` : '');
    }
    const target = resolveWorkspaceReference(sourcePath, link.target);
    if (!target || (nextSource === sourcePath && target !== moved.path)) return link.target;
    const suffix = link.target.match(/[?#].*$/)?.[0] ?? '';
    return relativeWorkspaceReference(nextSource, target === moved.path ? destination : target)
      .replace(/[()]/g, char => char === '(' ? '%28' : '%29') + suffix;
  };
  let result = rewriteDocumentLinks(content, rewrite);
  const cover = appearanceText(content, 'cover');
  if (cover) {
    const next = rewrite({ kind: 'markdown', target: cover });
    if (next !== cover) result = updateAppearance(result, 'cover', next, appearanceProperty(result, 'cover'));
  }
  return result;
}

interface Revision { file: FileEntry; path: string; before: FileSnapshot; after: string }

/** A checked, compensating operation: no recursive deletion and no unconditional content writes. */
export async function convertFolderDocument(adapter: WorkspaceAdapter, workspaceId: string, selected: FileEntry,
  filename: FolderHomeFileName, kind: FolderConversionKind) {
  if (!adapter.changeFile || !adapter.removeEmptyFolder) throw new Error('当前存储适配器尚不支持安全的文档与文件夹转换');
  const workspace = await adapter.refresh();
  if (workspace.id !== workspaceId || workspace.readOnly) throw new Error('工作区已切换或为只读');
  const plan = planFolderConversion(workspace.files, selected, filename, kind);
  const edits: Revision[] = [];
  const homeBase = await adapter.read(plan.home.path);
  if (plan.home.path !== plan.destination) {
    for (const file of workspace.files.filter(file => file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path))) {
      const before = file.id === plan.home.id ? homeBase : await adapter.read(file.path);
      const after = rewriteConversionLinks(before.content, file.path, plan.home, plan.destination, workspace.files);
      if (after === before.content) continue;
      if (file.readOnly) throw new Error(`需要更新的引用文档为只读：${file.path}`);
      edits.push({ file, path: file.id === plan.home.id ? plan.destination : file.path, before, after });
    }
  }
  const attempted: Revision[] = [];
  let folderCreated = false, child: { file: FileEntry; snapshot: FileSnapshot } | undefined;
  const checkedWorkspace = async () => {
    const current = await adapter.refresh();
    if (current.id !== workspaceId) throw new Error('工作区已切换');
    return current;
  };
  const move = async (from: string, to: string, hash: string) => {
    const result = await adapter.changeFile!({ workspaceId, fileId: plan.home.id, path: from, destination: to, expectedHash: hash });
    if (result.status !== 'saved') throw new Error('首页已被外部修改或移除，请刷新后重试');
  };
  try {
    if (plan.createFolder) { await adapter.createFolder(plan.folder); folderCreated = true; }
    if (plan.home.path !== plan.destination) await move(plan.home.path, plan.destination, homeBase.hash);
    for (const edit of edits) {
      const current = await checkedWorkspace();
      if (!current.files.some(file => file.id === edit.file.id && file.path === edit.path)) throw new Error(`引用文件位置已变化：${edit.path}`);
      for (let attempt = 0; ; attempt++) {
        attempted.push(edit);
        const result = await adapter.write(edit.path, edit.after, edit.before.hash);
        if (result.status === 'saved') break;
        attempted.pop(); // A rejected compare-and-write did not apply our change.
        if (result.status !== 'conflict' || attempt >= 2)
          throw new Error(`文档已被外部修改，转换已停止：${edit.path}`);
        const merged = mergeMarkdown(edit.before.content, edit.after, result.snapshot.content);
        if (!merged.clean) throw new Error(`文档已被外部修改，转换已停止：${edit.path}`);
        // Compensation restores the latest external revision, not the stale original.
        edit.before = result.snapshot;
        edit.after = merged.content;
      }
    }
    if (plan.childPath) {
      await adapter.create(plan.childPath, '');
      const current = await checkedWorkspace();
      const file = current.files.find(file => file.path === plan.childPath)!;
      if (!file) throw new Error('新建子文档后无法确认文件');
      child = { file, snapshot: { content: '', hash: await assistantHash(''), modified: file.modified } };
    } else await adapter.removeEmptyFolder(workspaceId, plan.folder);
    return { workspace: await checkedWorkspace(), openId: child?.file.id ?? plan.home.id, plan };
  } catch (error) {
    const recoveryErrors: string[] = [];
    const recover = async (action: () => Promise<void>) => {
      try { await action(); } catch (failure) { recoveryErrors.push(String(failure)); }
    };
    if (plan.childPath && !child) await recover(async () => {
      if ((await checkedWorkspace()).files.some(file => file.path === plan.childPath))
        throw new Error(`无法确认子文档创建结果，已保留该文件：${plan.childPath}`);
    });
    if (child) await recover(async () => {
      const result = await adapter.changeFile!({ workspaceId, fileId: child!.file.id, path: child!.file.path, expectedHash: child!.snapshot.hash });
      if (result.status !== 'saved') throw new Error('子文档已有外部修改，已保留');
    });
    for (const edit of [...attempted].reverse()) await recover(async () => {
      const current = await checkedWorkspace();
      const file = current.files.find(file => file.id === edit.file.id);
      if (!file || file.path !== edit.path) throw new Error(`需要手动恢复引用：${edit.path}`);
      const now = await adapter.read(file.path);
      if (now.content === edit.before.content) return;
      const reverted = mergeMarkdown(edit.after, edit.before.content, now.content);
      if (!reverted.clean) throw new Error(`外部修改与恢复冲突，已保留现有内容：${edit.path}`);
      const result = await adapter.write(file.path, reverted.content, now.hash);
      if (result.status !== 'saved') throw new Error(`恢复时文件再次变化：${edit.path}`);
    });
    if (plan.home.path !== plan.destination) await recover(async () => {
      const current = await checkedWorkspace();
      const home = current.files.find(file => file.id === plan.home.id);
      if (home?.path === plan.home.path) return;
      if (home?.path !== plan.destination) throw new Error('首页位置已变化，需要手动恢复');
      if (kind === 'flatten' && !current.files.some(file => file.path === plan.folder)) await adapter.createFolder(plan.folder);
      await move(plan.destination, plan.home.path, (await adapter.read(plan.destination)).hash);
    });
    if (folderCreated) await recover(() => adapter.removeEmptyFolder!(workspaceId, plan.folder));
    if (recoveryErrors.length) {
      const recoveryPath = `.tano/conflicts/folder-conversion-${crypto.randomUUID()}.json`;
      try {
        await checkedWorkspace();
        await adapter.create(recoveryPath, JSON.stringify({ version: 1, kind, plan, homeBase, edits, error: String(error), recoveryErrors }, null, 2));
      } catch (backupError) {
        throw new Error(`转换失败，部分操作未能恢复；请保留当前文件并检查路径。${String(error)}；${recoveryErrors.join('；')}；恢复记录写入失败：${String(backupError)}`);
      }
      throw new Error(`转换未完成，外部修改已保留。恢复记录：${recoveryPath}。${String(error)}；${recoveryErrors.join('；')}`);
    }
    throw new Error(`转换未完成，已恢复原有结构：${String(error)}`);
  }
}
