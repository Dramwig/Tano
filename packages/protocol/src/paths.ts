export function isMarkdown(path: string) {
  return /\.(md|markdown)$/i.test(path);
}
export function basename(path: string) {
  return path.split('/').at(-1) ?? path;
}
export function parentPath(path: string) {
  return path.split('/').slice(0, -1).join('/');
}

/**
 * Stable cross-platform comparison key for workspace paths. Filesystems vary
 * in case and Unicode compatibility handling, so sync must reject aliases
 * before they can become two different remote file identities.
 */
export function pathKey(path: string) {
  return path
    .split('/')
    .map((part) => part.normalize('NFKC').toLocaleUpperCase('en-US').toLocaleLowerCase('en-US'))
    .join('/');
}

export function validatePath(path: string): string | null {
  if (!path.trim() || path !== path.trim()) return '请输入有效的相对路径，首尾不能有空格';
  if (path !== path.normalize('NFC')) return '路径必须使用 NFC Unicode';
  if (path.length > 220) return '路径过长，请使用更短的名称';
  if (
    path
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          p.startsWith('.') ||
          /[\\<>:"|?*\u0000-\u001f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    return '路径不能包含隐藏目录、上级目录或系统保留字符';
  return null;
}
