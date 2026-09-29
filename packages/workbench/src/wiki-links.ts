import { isMarkdown, resolveWorkspaceReference } from '@tano/protocol';
import type { FileEntry } from '@tano/protocol';

type WikiResolution =
  { file: FileEntry; heading: string } | { error: 'invalid' | 'missing' | 'ambiguous' };

/** Resolve Obsidian-style forward links without depending on a path as file identity. */
export function resolveWikiLink(
  files: FileEntry[],
  currentPath: string,
  target: string,
): WikiResolution {
  const separator = target.indexOf('#');
  const name = (separator < 0 ? target : target.slice(0, separator)).trim();
  const heading = separator < 0 ? '' : target.slice(separator + 1).trim();
  const notes = files.filter((file) => file.kind === 'file' && isMarkdown(file.path));
  const current = notes.find((file) => file.path === currentPath);
  if (!name) return current && heading ? { file: current, heading } : { error: 'invalid' };
  if (/^[\\/]|[\\:\u0000-\u001f]/.test(name) || name.includes('\\')) return { error: 'invalid' };

  const spellings = isMarkdown(name) ? [name] : [`${name}.md`, `${name}.markdown`];
  const paths: string[] = [];
  for (const spelling of spellings) {
    const relative = resolveWorkspaceReference(currentPath, spelling);
    if (relative) paths.push(relative);
    if (!spelling.includes('/')) {
      const parents = currentPath.split('/').slice(0, -1);
      for (let depth = parents.length - 1; depth >= 0; depth--)
        paths.push([...parents.slice(0, depth), spelling].join('/'));
    } else if (!spelling.startsWith('../') && !spelling.startsWith('./')) paths.push(spelling);
  }
  for (const path of paths) {
    const exact = notes.find((file) => file.path === path);
    if (exact) return { file: exact, heading };
  }

  // A short wiki target can name a page anywhere in the workspace. Never pick
  // an arbitrary page when multiple folders contain the same title.
  const names = new Set(spellings.map((spelling) => spelling.toLocaleLowerCase()));
  const matches = notes.filter((file) => {
    const path = file.path.toLocaleLowerCase();
    return name.includes('/')
      ? spellings.some((spelling) => path.endsWith(`/${spelling.toLocaleLowerCase()}`))
      : names.has(path.split('/').at(-1)!);
  });
  if (matches.length === 1) return { file: matches[0], heading };
  return { error: matches.length ? 'ambiguous' : 'missing' };
}
