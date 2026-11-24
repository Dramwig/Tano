import { describe, expect, it, vi } from 'vitest';
import { handleMobileVisibility } from './mobile-lifecycle';

function dependencies(
  visibilityState: DocumentVisibilityState,
  mobile = true,
  hasWorkspace = true,
) {
  const events: string[] = [];
  return {
    events,
    mobile,
    hasWorkspace,
    visibilityState,
    flushWorkspace: vi.fn(async () => void events.push('flush workspace')),
    flushEditing: vi.fn(async () => void events.push('flush collaboration')),
    refreshWorkspace: vi.fn(async () => void events.push('refresh workspace')),
    synchronize: vi.fn(async () => void events.push('synchronize')),
  };
}

describe('mobile lifecycle', () => {
  it('flushes the workspace before collaboration when hidden', async () => {
    const deps = dependencies('hidden');
    await handleMobileVisibility(deps);
    expect(deps.events).toEqual(['flush workspace', 'flush collaboration']);
  });

  it('refreshes the workspace before File Sync when visible again', async () => {
    const deps = dependencies('visible');
    await handleMobileVisibility(deps);
    expect(deps.events).toEqual(['refresh workspace', 'synchronize']);
  });

  it('does not touch stores without a mobile workspace', async () => {
    const deps = dependencies('hidden', false, false);
    await handleMobileVisibility(deps);
    expect(deps.events).toEqual([]);
    expect(deps.flushWorkspace).not.toHaveBeenCalled();
    expect(deps.synchronize).not.toHaveBeenCalled();
  });

  it('ignores prerender state until the page is visible', async () => {
    const deps = dependencies('visible');
    deps.visibilityState = 'prerender' as DocumentVisibilityState;
    await handleMobileVisibility(deps);
    expect(deps.events).toEqual([]);
    expect(deps.refreshWorkspace).not.toHaveBeenCalled();
    expect(deps.synchronize).not.toHaveBeenCalled();
  });
});
