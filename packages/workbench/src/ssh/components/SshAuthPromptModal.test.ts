// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import type { App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

const respondChallengeMock = vi.fn();

vi.mock('../client', () => ({
  sshClient: {
    available: () => true,
    respondChallenge: (...args: unknown[]) => respondChallengeMock(...args),
    onHostKeyPrompt: vi.fn(async () => () => {}),
    onAuthPrompt: vi.fn(async () => () => {}),
    onConnectionStatus: vi.fn(async () => () => {}),
  },
}));

vi.mock('../../features', () => ({
  isFeatureEnabled: () => true,
}));

import SshAuthPromptModal from './SshAuthPromptModal.vue';
import { useSshStore } from '../store';

let app: App | null = null;
let root: HTMLDivElement | null = null;

function mountModal() {
  const pinia = createPinia();
  setActivePinia(pinia);
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(SshAuthPromptModal));
  app.use(pinia);
  app.mount(root);
  return { ssh: useSshStore() };
}

describe('SshAuthPromptModal', () => {
  beforeEach(() => {
    respondChallengeMock.mockReset();
    respondChallengeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    root?.remove();
    root = null;
  });

  it('prompts TOFU fingerprint confirmation for an unknown host and trusts on click', async () => {
    const { ssh } = mountModal();
    ssh.challengeQueue = [
      {
        type: 'host-key',
        event: {
          challengeId: 'hk-tofu-1',
          hostId: 'gpu-box',
          hostLabel: 'GPU Box',
          hostname: '10.0.0.8',
          port: 2222,
          algorithm: 'ssh-ed25519',
          fingerprint: 'SHA256:newfingerprint123',
          mismatch: false,
        },
      },
    ];
    await nextTick();

    expect(root!.textContent).toContain('10.0.0.8:2222');
    expect(root!.textContent).toContain('ssh-ed25519');
    expect(root!.textContent).toContain('SHA256:newfingerprint123');

    const trustBtn = [...root!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('信任并继续连接'),
    );
    expect(trustBtn).toBeTruthy();
    trustBtn!.click();
    await nextTick();

    expect(respondChallengeMock).toHaveBeenCalledWith({
      challengeId: 'hk-tofu-1',
      cancelled: false,
      trustHostKey: true,
      secrets: [],
      saveSecret: true,
    });
    expect(ssh.activeChallenge).toBeNull();
  });

  it('hard-blocks MITM host key mismatch without an accept button and displays both fingerprints', async () => {
    const { ssh } = mountModal();
    ssh.challengeQueue = [
      {
        type: 'host-key',
        event: {
          challengeId: 'hk-mitm-1',
          hostId: 'prod',
          hostLabel: 'Prod',
          hostname: 'prod.internal',
          port: 22,
          algorithm: 'ssh-ed25519',
          fingerprint: 'SHA256:attackerKey',
          previousFingerprint: 'SHA256:trustedOldKey',
          mismatch: true,
        },
      },
    ];
    await nextTick();

    expect(root!.querySelector('.ssh-mitm-warning')).toBeTruthy();
    expect(root!.textContent).toContain('SHA256:trustedOldKey');
    expect(root!.textContent).toContain('SHA256:attackerKey');

    const trustBtn = [...root!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('信任并继续连接'),
    );
    expect(trustBtn).toBeUndefined();

    const ackBtn = [...root!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('知道了（断开连接）'),
    );
    expect(ackBtn).toBeTruthy();
    ackBtn!.click();
    await nextTick();

    expect(respondChallengeMock).toHaveBeenCalledWith({
      challengeId: 'hk-mitm-1',
      cancelled: true,
      trustHostKey: false,
      secrets: [],
      saveSecret: false,
    });
  });

  it('submits interactive password/2FA secrets with optional keyring save', async () => {
    const { ssh } = mountModal();
    ssh.challengeQueue = [
      {
        type: 'auth',
        event: {
          challengeId: 'auth-1',
          hostId: 'prod',
          hostLabel: 'Prod (ubuntu@10.0.0.5)',
          kind: 'keyboard-interactive',
          instruction: 'Enter password and TOTP code',
          prompts: [
            { prompt: 'Password:', echo: false },
            { prompt: 'Verification code:', echo: true },
          ],
          allowSave: true,
        },
      },
    ];
    await nextTick();

    expect(root!.textContent).toContain('Enter password and TOTP code');
    const inputs = [...root!.querySelectorAll<HTMLInputElement>('.ssh-auth-field input')];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.type).toBe('password');
    expect(inputs[1]!.type).toBe('text');

    inputs[0]!.value = 's3cr3t';
    inputs[0]!.dispatchEvent(new Event('input'));
    inputs[1]!.value = '123456';
    inputs[1]!.dispatchEvent(new Event('input'));

    const saveCheckbox = root!.querySelector<HTMLInputElement>('.ssh-auth-save input[type="checkbox"]')!;
    saveCheckbox.checked = true;
    saveCheckbox.dispatchEvent(new Event('change'));
    await nextTick();

    const form = root!.querySelector<HTMLFormElement>('form.ssh-auth-form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await nextTick();

    expect(respondChallengeMock).toHaveBeenCalledWith({
      challengeId: 'auth-1',
      cancelled: false,
      trustHostKey: false,
      secrets: ['s3cr3t', '123456'],
      saveSecret: true,
    });
  });
});
