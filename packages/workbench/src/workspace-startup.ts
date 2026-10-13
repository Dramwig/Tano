// Device-local navigation belongs in app/WebView storage, never in the workspace.
export const startupWorkspaceKey = 'tano.session.localWorkspace.v1';

/** undefined migrates older installs from recent history; null keeps the picker open. */
export function readStartupWorkspace(): string | null | undefined {
  try {
    const raw = localStorage.getItem(startupWorkspaceKey);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    if (value === null || (typeof value === 'string' && value.length > 0)) return value;
  } catch { /* Invalid or unavailable device storage must not block startup. */ }
  return undefined;
}

export function rememberStartupWorkspace(id: string | null) {
  try { localStorage.setItem(startupWorkspaceKey, JSON.stringify(id)); }
  catch { /* Opening and leaving a workspace still work without device storage. */ }
}
