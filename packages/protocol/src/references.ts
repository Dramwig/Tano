import { validatePath } from './paths';

/** Markdown references are relative to the document, never to the process cwd. */
export function resolveWorkspaceReference(documentPath: string, reference: string): string | null {
  try {
    const raw = decodeURIComponent(reference.split(/[?#]/, 1)[0]!);
    if (
      !raw ||
      raw.startsWith('/') ||
      raw.includes('\\') ||
      raw.includes(':') ||
      /[\u0000-\u001f]/.test(raw)
    )
      return null;
    const parts = documentPath.split('/').slice(0, -1);
    for (const part of raw.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        if (!parts.length) return null;
        parts.pop();
      } else parts.push(part);
    }
    const path = parts.join('/');
    return validatePath(path) ? null : path;
  } catch {
    return null;
  }
}

export function relativeWorkspaceReference(documentPath: string, targetPath: string): string {
  const source = documentPath.split('/').slice(0, -1),
    target = targetPath.split('/');
  while (source.length && target.length && source[0] === target[0]) {
    source.shift();
    target.shift();
  }
  return [...source.map(() => '..'), ...target.map(encodeURIComponent)].join('/');
}

export function safeRemoteImage(reference: string): string | null {
  try {
    const url = new URL(reference);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
