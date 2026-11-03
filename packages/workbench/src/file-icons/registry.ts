import { shallowRef, type InjectionKey } from 'vue';
import { defaultFileIconTheme } from './default-theme';
import type { FileIconDefinition, FileIconResource, FileIconTheme } from './types';

function normalize(map: Readonly<Record<string, string>> | undefined) {
  return Object.fromEntries(Object.entries(map ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
}
function snapshot(theme: FileIconTheme): FileIconTheme {
  if (!theme.id.trim()) throw new Error('File icon theme requires an id');
  const icons = Object.fromEntries(Object.entries(theme.icons).map(([id, icon]) => {
    if (!id.trim() || !/^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|currentColor)$/i.test(icon.color) ||
      icon.paths.some(path => !/^[MmZzLlHhVvCcSsQqTtAaEe\d\s.,+\-]*$/.test(path)) ||
      (icon.label?.length ?? 0) > 4 ||
      (icon.silhouette && !['file', 'folder', 'folder-open', 'none'].includes(icon.silhouette))) {
      throw new Error(`Invalid file icon: ${id}`);
    }
    return [id, Object.freeze({ ...icon, paths: Object.freeze([...icon.paths]) })];
  }));
  const maps = {
    fileNames: normalize(theme.fileNames), fileExtensions: normalize(theme.fileExtensions),
    folderNames: normalize(theme.folderNames), folderNamesExpanded: normalize(theme.folderNamesExpanded),
  };
  const references = [theme.file, theme.folder, theme.folderExpanded, theme.folderHome, theme.folderHomeExpanded,
    ...Object.values(maps).flatMap(map => Object.values(map))];
  for (const id of references) if (id !== undefined && !Object.hasOwn(icons, id)) throw new Error(`Unknown file icon: ${id}`);
  return Object.freeze({ ...theme, ...Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, Object.freeze(map)])), icons: Object.freeze(icons) });
}

function match(theme: FileIconTheme, resource: FileIconResource): string | undefined {
  const name = (resource.name ?? resource.path.replace(/\\/g, '/').split('/').at(-1) ?? '').toLowerCase();
  if (resource.kind === 'directory') {
    if (resource.expanded && Object.hasOwn(theme.folderNamesExpanded ?? {}, name)) return theme.folderNamesExpanded![name];
    if (Object.hasOwn(theme.folderNames ?? {}, name)) return theme.folderNames![name];
    if (resource.folderHome) return (resource.expanded ? theme.folderHomeExpanded : undefined) ?? theme.folderHome
      ?? (resource.expanded ? theme.folderExpanded : undefined) ?? theme.folder;
    return (resource.expanded ? theme.folderExpanded : undefined) ?? theme.folder;
  }
  if (Object.hasOwn(theme.fileNames ?? {}, name)) return theme.fileNames![name];
  // Longest compound suffix wins, without sorting maps on every tree row.
  for (let index = name.indexOf('.'); index >= 0; index = name.indexOf('.', index + 1)) {
    const extension = name.slice(index + 1);
    if (Object.hasOwn(theme.fileExtensions ?? {}, extension)) return theme.fileExtensions![extension];
  }
  return theme.file;
}

/** Host-owned registry. Inject one per application/workspace for isolated themes. */
export class FileIconRegistry {
  private readonly themes = new Map<string, FileIconTheme>();
  private readonly revision = shallowRef(0);
  private activeId = 'tano';
  constructor() { this.themes.set('tano', snapshot(defaultFileIconTheme)); }

  register(theme: FileIconTheme): () => void {
    if (this.themes.has(theme.id)) throw new Error(`File icon theme already registered: ${theme.id}`);
    const saved = snapshot(theme);
    this.themes.set(saved.id, saved);
    this.revision.value++;
    return () => {
      if (this.themes.get(saved.id) !== saved) return;
      this.themes.delete(saved.id);
      if (this.activeId === saved.id) this.activeId = 'tano';
      this.revision.value++;
    };
  }

  select(id: string): void {
    if (!this.themes.has(id)) throw new Error(`Unknown file icon theme: ${id}`);
    this.activeId = id;
    this.revision.value++;
  }

  resolve(resource: FileIconResource): { themeId: string; id: string; icon: FileIconDefinition } {
    void this.revision.value;
    const active = this.themes.get(this.activeId)!;
    const fallback = this.themes.get('tano')!;
    const selected = match(active, resource);
    const theme = selected ? active : fallback;
    const id = selected ?? match(fallback, resource)!;
    return { themeId: theme.id, id, icon: theme.icons[id]! };
  }
}

export const fileIconRegistryKey: InjectionKey<FileIconRegistry> = Symbol('file-icon-registry');
export const fileIconRegistry = new FileIconRegistry();
export type { FileIconDefinition, FileIconResource, FileIconTheme } from './types';
