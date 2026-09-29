import { basename, parentPath, pathKey, validatePath, type FileEntry } from '@tano/protocol';

export function planFileMove(source: FileEntry, folder: string, entries: FileEntry[]) {
  if (
    !entries.some(
      (entry) => entry.id === source.id && entry.path === source.path && entry.kind === source.kind,
    )
  )
    throw new Error('文件位置已变化，目录已自动更新，请重新选择后重试');
  if (folder && !entries.some((entry) => entry.path === folder && entry.kind === 'directory'))
    throw new Error('目标文件夹已不存在');
  if (pathKey(parentPath(source.path)) === pathKey(folder)) throw new Error('文件已在该目录中');
  if (
    source.kind === 'directory' &&
    (pathKey(folder) === pathKey(source.path) ||
      pathKey(folder).startsWith(`${pathKey(source.path)}/`))
  )
    throw new Error('不能将文件夹移动到自身或子文件夹');

  const destination = folder ? `${folder}/${basename(source.path)}` : basename(source.path);
  const prefix = `${source.path}/`;
  const moving = (entry: FileEntry) =>
    entry.path === source.path || (source.kind === 'directory' && entry.path.startsWith(prefix));
  const occupied = new Set(
    entries.filter((entry) => !moving(entry)).map((entry) => pathKey(entry.path)),
  );
  const moved = entries.filter(moving).map((entry) => ({
    entry,
    path: `${destination}${entry.path.slice(source.path.length)}`,
  }));
  for (const item of moved) {
    const error = validatePath(item.path);
    if (error) throw new Error(error);
    const key = pathKey(item.path);
    if (occupied.has(key)) throw new Error('目标名称已经存在');
    occupied.add(key);
  }
  return { destination, moved };
}

export interface FileMovePreview {
  id: string;
  from: string;
  to: string;
}

export function planFileMovePreview(sources: FileEntry[], folder: string, entries: FileEntry[]) {
  const destinations = new Set<string>();
  const preview: FileMovePreview[] = [];
  for (const source of sources) {
    const { destination, moved } = planFileMove(source, folder, entries);
    const key = pathKey(destination);
    if (destinations.has(key)) throw new Error('目标名称已经存在');
    destinations.add(key);
    preview.push(...moved.map(({ entry, path }) => ({ id: entry.id, from: entry.path, to: path })));
  }
  return preview;
}

export function applyFileMovePreview(entries: FileEntry[], preview: FileMovePreview[]) {
  const byId = new Map(preview.map((change) => [change.id, change]));
  return entries.map((entry) => {
    const change = byId.get(entry.id);
    return change && entry.path === change.from
      ? { ...entry, path: change.to, name: basename(change.to) }
      : entry;
  });
}
