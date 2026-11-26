// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { Workspace } from '@tano/protocol';

const workspaceState = reactive<{
  workspace: Workspace | null;
  refresh: ReturnType<typeof vi.fn>;
  report: ReturnType<typeof vi.fn>;
}>({
  workspace: null,
  refresh: vi.fn(),
  report: vi.fn(),
});

vi.mock('../client', () => ({
  sshClient: {
    available: () => true,
    openTerminal: vi.fn(async () => {}),
    onHostKeyPrompt: vi.fn(async () => () => {}),
    onAuthPrompt: vi.fn(async () => () => {}),
    onConnectionStatus: vi.fn(async () => () => {}),
  },
}));

vi.mock('../../features', () => ({
  isFeatureEnabled: () => true,
}));

vi.mock('../../stores/workspace', () => ({
  useWorkspaceStore: () => workspaceState,
}));

import SshStatusBadge from './SshStatusBadge.vue';

let app: App | null = null;
let root: HTMLDivElement | null = null;

function mountBadge() {
  const pinia = createPinia();
  setActivePinia(pinia);
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(SshStatusBadge));
  app.use(pinia);
  app.mount(root);
}

describe('SshStatusBadge', () => {
  beforeEach(() => {
    localStorage.clear();
    workspaceState.workspace = {
      id: 'ws-ssh-git',
      name: 'project',
      path: 'ssh://gpu-1/srv/project',
      files: [],
      newlyCreated: true,
      remote: {
        kind: 'ssh',
        hostId: 'gpu-1',
        hostLabel: 'GPU Dev',
        remotePath: '/srv/project',
        transport: 'sftp',
        status: 'connected',
        latencyMs: 14,
        gitRepo: true,
      },
    };
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    root?.remove();
    root = null;
    vi.restoreAllMocks();
  });

  it('shows a dismissible .git/info/exclude tip on newly initialized remote Git repos and copies the command', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    mountBadge();
    await nextTick();

    const tip = root!.querySelector('.ssh-git-exclude-tip');
    expect(tip).toBeTruthy();
    expect(tip!.textContent).toContain('.git/info/exclude');

    const copyBtn = [...tip!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('复制'),
    );
    expect(copyBtn).toBeTruthy();
    copyBtn!.click();
    await Promise.resolve();
    await nextTick();

    expect(writeText).toHaveBeenCalledWith("printf '\\n.tano/\\n' >> .git/info/exclude");
    expect(tip!.textContent).toContain('已复制命令');

    const dismissBtn = [...tip!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('知道了'),
    );
    dismissBtn!.click();
    await nextTick();

    expect(root!.querySelector('.ssh-git-exclude-tip')).toBeNull();
    expect(localStorage.getItem('tano.ssh.gitExcludeDismissed:ws-ssh-git')).toBe('1');
  });

  it('does not show the git exclude tip when the remote folder is not a Git repository', async () => {
    workspaceState.workspace = {
      ...workspaceState.workspace!,
      remote: {
        ...workspaceState.workspace!.remote!,
        gitRepo: false,
      },
    };
    mountBadge();
    await nextTick();

    expect(root!.querySelector('.ssh-git-exclude-tip')).toBeNull();
  });
});
