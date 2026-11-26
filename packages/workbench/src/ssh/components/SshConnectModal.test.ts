// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import type { App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { RemoteListDirResponse, SshConnectResult, SshHostListResponse, SshHostProfile } from '../types';

const listHostsMock = vi.fn<() => Promise<SshHostListResponse>>();
const testHostMock = vi.fn<(hostId: string) => Promise<SshConnectResult>>();
const connectMock = vi.fn<(hostId: string) => Promise<SshConnectResult>>();
const saveHostMock = vi.fn();
const listDirMock = vi.fn<
  (hostId: string, path?: string | null, includeHidden?: boolean) => Promise<RemoteListDirResponse>
>();
const parseQuickConnectMock = vi.fn();
const openWorkspaceMock = vi.fn();

vi.mock('../client', () => ({
  sshClient: {
    available: () => true,
    listHosts: () => listHostsMock(),
    testHost: (hostId: string) => testHostMock(hostId),
    connect: (hostId: string) => connectMock(hostId),
    saveHost: (input: unknown) => saveHostMock(input),
    removeHost: vi.fn(async () => {}),
    parseQuickConnect: (raw: string) => parseQuickConnectMock(raw),
    listDir: (hostId: string, path?: string | null, includeHidden?: boolean) =>
      listDirMock(hostId, path, includeHidden),
    mkdir: vi.fn(async () => '/srv/new'),
    onHostKeyPrompt: vi.fn(async () => () => {}),
    onAuthPrompt: vi.fn(async () => () => {}),
    onConnectionStatus: vi.fn(async () => () => {}),
  },
}));

vi.mock('../../features', () => ({
  isFeatureEnabled: () => true,
}));

vi.mock('../../stores/workspace', () => ({
  useWorkspaceStore: () => ({
    openWorkspace: openWorkspaceMock,
  }),
}));

import SshConnectModal from './SshConnectModal.vue';
import { useSshStore } from '../store';

let app: App | null = null;
let root: HTMLDivElement | null = null;

const savedProfile: SshHostProfile = {
  id: 'gpu-1',
  name: 'GPU Dev',
  host: '10.0.0.5',
  port: 22,
  username: 'ubuntu',
  authMethod: 'auto',
  forwardAgent: false,
  source: 'saved',
  hasSavedPassword: false,
  hasSavedPassphrase: false,
};

const configProfile: SshHostProfile = {
  id: 'ssh-config:prod',
  name: 'prod',
  host: 'prod.example.com',
  port: 2222,
  username: 'deploy',
  authMethod: 'auto',
  forwardAgent: false,
  source: 'ssh-config',
  configAlias: 'prod',
  hasSavedPassword: false,
  hasSavedPassphrase: false,
};

const connectResult: SshConnectResult = {
  hostId: 'gpu-1',
  hostLabel: 'GPU Dev',
  homeDir: '/home/ubuntu',
  recentPaths: ['/srv/project'],
  latencyMs: 18,
  capabilities: {
    shell: true,
    fastScan: true,
    inotify: true,
    git: true,
    node: true,
    nodeVersion: 'v22.1.0',
    codexCli: true,
    claudeCli: false,
  },
};

async function flushAsync() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
}

function mountModal() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const ssh = useSshStore();
  ssh.connectModalOpen = true;
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(SshConnectModal));
  app.use(pinia);
  app.mount(root);
  return { ssh };
}

describe('SshConnectModal', () => {
  beforeEach(() => {
    listHostsMock.mockReset().mockResolvedValue({
      savedHosts: [savedProfile],
      configHosts: [configProfile],
      configPath: '/home/user/.ssh/config',
      configError: null,
    });
    testHostMock.mockReset().mockResolvedValue(connectResult);
    connectMock.mockReset().mockResolvedValue(connectResult);
    saveHostMock.mockReset().mockResolvedValue(savedProfile);
    listDirMock.mockReset().mockResolvedValue({
      path: '/srv/project',
      parent: '/srv',
      entries: [
        { name: 'src', path: '/srv/project/src', kind: 'dir', size: 0, modified: 0, isHidden: false, isSymlink: false },
        { name: 'README.md', path: '/srv/project/README.md', kind: 'file', size: 120, modified: 0, isHidden: false, isSymlink: false },
      ],
    });
    parseQuickConnectMock.mockReset();
    openWorkspaceMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    root?.remove();
    root = null;
  });

  it('lists saved and ~/.ssh/config hosts and tests a host via the inline test button', async () => {
    mountModal();
    await flushAsync();

    expect(root!.textContent).toContain('GPU Dev');
    expect(root!.textContent).toContain('prod');

    const testButtons = [...root!.querySelectorAll<HTMLButtonElement>('button[aria-label="测试连接"]')];
    expect(testButtons).toHaveLength(2);
    testButtons[0]!.click();
    await flushAsync();

    expect(testHostMock).toHaveBeenCalledWith('gpu-1');
    expect(root!.querySelector('.ssh-notice')?.textContent).toContain('18ms');
    expect(root!.querySelector('.ssh-notice')?.textContent).toContain('/home/ubuntu');
  });

  it('saves and tests a newly filled host form via the form test button', async () => {
    mountModal();
    await flushAsync();

    const addBtn = root!.querySelector<HTMLButtonElement>('.ssh-add-btn')!;
    addBtn.click();
    await nextTick();

    const inputs = [...root!.querySelectorAll<HTMLInputElement>('.ssh-form-grid input')];
    // [0]=name, [1]=host, [2]=port, [3]=username
    inputs[0]!.value = 'GPU Dev';
    inputs[0]!.dispatchEvent(new Event('input'));
    inputs[1]!.value = '10.0.0.5';
    inputs[1]!.dispatchEvent(new Event('input'));
    inputs[3]!.value = 'ubuntu';
    inputs[3]!.dispatchEvent(new Event('input'));
    await nextTick();

    const formTestBtn = [...root!.querySelectorAll<HTMLButtonElement>('.ssh-form-actions button')].find(
      (b) => b.textContent?.includes('测试连接'),
    );
    expect(formTestBtn).toBeTruthy();
    expect(formTestBtn!.disabled).toBe(false);
    formTestBtn!.click();
    await flushAsync();

    expect(saveHostMock).toHaveBeenCalledOnce();
    expect(testHostMock).toHaveBeenCalledWith('gpu-1');
    expect(root!.querySelector('.ssh-notice')?.textContent).toContain('Python3');
    expect(root!.querySelector('.ssh-notice')?.textContent).toContain('Git');
  });

  it('connects to a host, browses directories, and opens the remote folder as an ssh:// workspace', async () => {
    const { ssh } = mountModal();
    await flushAsync();

    const hostMain = root!.querySelector<HTMLButtonElement>('.ssh-host-main')!;
    hostMain.click();
    await flushAsync();

    expect(connectMock).toHaveBeenCalledWith('gpu-1');
    expect(listDirMock).toHaveBeenCalledWith('gpu-1', '/srv/project', false);

    const dirItems = [...root!.querySelectorAll<HTMLButtonElement>('.remote-dir-item')];
    expect(dirItems).toHaveLength(2);
    expect(dirItems[0]!.classList.contains('is-dir')).toBe(true);
    expect(dirItems[0]!.disabled).toBe(false);
    expect(dirItems[1]!.classList.contains('is-file')).toBe(true);
    expect(dirItems[1]!.disabled).toBe(true);

    const openBtn = [...root!.querySelectorAll<HTMLButtonElement>('.remote-browser-footer button')].find(
      (b) => b.textContent?.includes('打开此文件夹'),
    );
    expect(openBtn).toBeTruthy();
    openBtn!.click();
    await flushAsync();

    expect(openWorkspaceMock).toHaveBeenCalledWith('ssh://gpu-1/srv/project');
    expect(ssh.connectModalOpen).toBe(false);
  });
});
