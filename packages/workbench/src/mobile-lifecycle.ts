export interface MobileLifecycleDependencies {
  mobile: boolean;
  hasWorkspace: boolean;
  visibilityState: DocumentVisibilityState;
  flushWorkspace: () => Promise<unknown>;
  flushEditing: () => Promise<unknown>;
  refreshWorkspace: () => Promise<unknown>;
  synchronize: () => Promise<unknown>;
}

/**
 * Persist local state before Android/iOS freezes the WebView, then refresh the
 * filesystem and host extension state when the app becomes visible again.
 *
 * The caller owns error reporting so the same path is used by the desktop and
 * mobile stores. Keeping this orchestration UI-independent makes lifecycle
 * ordering testable without a native window.
 */
export async function handleMobileVisibility({
  mobile,
  hasWorkspace,
  visibilityState,
  flushWorkspace,
  flushEditing,
  refreshWorkspace,
  synchronize,
}: MobileLifecycleDependencies): Promise<void> {
  if (!mobile || !hasWorkspace) return;
  if (visibilityState === 'hidden') {
    await flushWorkspace();
    await flushEditing();
  } else if (visibilityState === 'visible') {
    await refreshWorkspace();
    await synchronize();
  }
}
