export interface PageRoute {
  workspaceId: string;
  fileId: string;
}

function decodeSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded ? decoded : null;
  } catch {
    return null;
  }
}

export function parsePageRoute(pathname: string): PageRoute | null {
  const match = /^\/p\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const workspaceId = decodeSegment(match[1]);
  const fileId = decodeSegment(match[2]);
  return workspaceId && fileId ? { workspaceId, fileId } : null;
}

export function pageRoutePath(workspaceId: string, fileId: string) {
  return `/p/${encodeURIComponent(workspaceId)}/${encodeURIComponent(fileId)}`;
}
