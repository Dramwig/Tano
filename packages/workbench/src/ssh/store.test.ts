// SPDX-License-Identifier: MIT
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createFeatureGate } from '@tano/protocol/features';
import { features } from '../features';
import { createWorkspaceLifecycle } from '../stores/workspace-lifecycle';
import { ref } from 'vue';
import type { WorkspaceAdapter } from '@tano/protocol';

describe('SSH remote workspace feature gating and lifecycle guards', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('registers sshRemoteWorkspace and codeFileEditing as dev features (disabled in stable)', () => {
    const devGate = createFeatureGate(features, 'dev');
    const stableGate = createFeatureGate(features, 'stable');
    expect(devGate.isEnabled('sshRemoteWorkspace')).toBe(true);
    expect(devGate.isEnabled('codeFileEditing')).toBe(true);
    expect(stableGate.isEnabled('sshRemoteWorkspace')).toBe(false);
    expect(stableGate.isEnabled('codeFileEditing')).toBe(false);
  });

  it('exposes SshStore challenge queue management cleanly', async () => {
    const { useSshStore } = await import('./store');
    const ssh = useSshStore();
    expect(ssh.activeChallenge).toBeNull();
    ssh.challengeQueue = [
      {
        type: 'host-key',
        event: {
          challengeId: 'req-1',
          hostId: 'prod',
          hostLabel: 'Prod',
          hostname: '10.0.0.5',
          port: 22,
          algorithm: 'ssh-ed25519',
          fingerprint: 'SHA256:abc',
          mismatch: false,
        },
      },
    ];
    expect(ssh.activeChallenge?.event.challengeId).toBe('req-1');
  });

  it('rejects direct ssh:// openWorkspace calls when sshRemoteWorkspace is disabled', async () => {
    vi.resetModules();
    vi.doMock('../features', () => ({
      isFeatureEnabled: () => false,
    }));
    const { createWorkspaceLifecycle: createGuardedLifecycle } = await import(
      '../stores/workspace-lifecycle'
    );
    const open = vi.fn();
    const adapter = { open } as unknown as WorkspaceAdapter;
    const lifecycle = createGuardedLifecycle({
      adapter,
      isDemo: false,
      isWeb: false,
      remembersStartupWorkspace: false,
      workspace: ref(null),
      fileRegistry: ref(null),
      documents: ref([]),
      tabIds: ref([]),
      tabAliases: ref(new Map()),
      activeId: ref(''),
      installedPlugins: ref([]),
      busy: ref(false),
      openingWorkspace: ref(false),
      workspaceLoading: ref({
        files: false,
        session: false,
        settings: false,
        tables: false,
        objects: false,
        capabilities: false,
        plugins: false,
        relations: false,
      }),
      restoringDocuments: ref({}),
      openingDocuments: ref({}),
      activities: ref([]),
      fatal: ref(''),
      recent: ref([]),
      sessionError: ref(''),
      workspaceLifecycle: { pause: vi.fn(), resume: vi.fn(), start: vi.fn() } as never,
      stopWatching: vi.fn(),
      dataTables: {} as never,
      policy: {} as never,
      knowledge: {} as never,
      plugins: {} as never,
      tabsLayout: {} as never,
      assistantBridge: {} as never,
      session: {} as never,
      hooks: {},
      serial: async (task) => task(),
      activity: vi.fn(),
      report: vi.fn(),
      loadWorkspacePart: vi.fn(),
      flush: vi.fn(async () => true),
      reconcile: vi.fn(),
      saveInternal: vi.fn(),
      hydrateDocumentLayout: vi.fn(),
      saveTableLayout: vi.fn(),
    });

    await expect(lifecycle.openWorkspace('ssh://prod/srv/docs')).rejects.toThrow(/未启用/);
    expect(open).not.toHaveBeenCalled();
    vi.doUnmock('../features');
  });
});
