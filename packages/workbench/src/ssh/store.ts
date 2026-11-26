// SPDX-License-Identifier: MIT
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { sshClient, type SshUnlisten } from './client';
import { isFeatureEnabled } from '../features';
import { mobile } from '../platform/platform';
import type {
  KnownHostRecord,
  SshChallenge,
  SshChallengeResponse,
  SshConnectionStatusEvent,
  SshConnectResult,
  SshHostInput,
  SshHostProfile,
  SshSettings,
} from './types';

export const useSshStore = defineStore('ssh', () => {
  const available = computed(
    () => isFeatureEnabled('sshRemoteWorkspace') && sshClient.available() && !mobile,
  );
  const connectModalOpen = ref(false);
  const preselectedHostId = ref<string | null>(null);
  const savedHosts = ref<SshHostProfile[]>([]);
  const configHosts = ref<SshHostProfile[]>([]);
  const configPath = ref<string | null>(null);
  const configParseError = ref<string | null>(null);
  const hostsLoading = ref(false);
  const hostsError = ref('');

  const statuses = ref<Record<string, SshConnectionStatusEvent>>({});
  const challengeQueue = ref<SshChallenge[]>([]);
  const activeChallenge = computed(() => challengeQueue.value[0] ?? null);

  const knownHosts = ref<KnownHostRecord[]>([]);
  const settings = ref<SshSettings>({
    trashMode: 'remote-trash',
    pollIntervalSecs: 3,
    keepaliveSecs: 15,
    connectTimeoutSecs: 15,
  });

  const allHosts = computed(() => [...savedHosts.value, ...configHosts.value]);

  let unlisteners: SshUnlisten[] = [];
  let listenersStarted = false;

  async function initListeners() {
    if (listenersStarted || !available.value) return;
    listenersStarted = true;
    try {
      const [u1, u2, u3] = await Promise.all([
        sshClient.onHostKeyPrompt((event) => {
          challengeQueue.value = [...challengeQueue.value, { type: 'host-key', event }];
        }),
        sshClient.onAuthPrompt((event) => {
          challengeQueue.value = [...challengeQueue.value, { type: 'auth', event }];
        }),
        sshClient.onConnectionStatus((event) => {
          statuses.value = { ...statuses.value, [event.hostId]: event };
        }),
      ]);
      unlisteners = [u1, u2, u3];
    } catch {
      listenersStarted = false;
    }
  }

  function disposeListeners() {
    for (const stop of unlisteners) stop();
    unlisteners = [];
    listenersStarted = false;
  }

  async function loadHosts() {
    if (!available.value) return;
    hostsLoading.value = true;
    hostsError.value = '';
    try {
      const result = await sshClient.listHosts();
      savedHosts.value = result.savedHosts;
      configHosts.value = result.configHosts;
      configPath.value = result.configPath ?? null;
      configParseError.value = result.configError ?? null;
    } catch (error) {
      hostsError.value = error instanceof Error ? error.message : String(error);
    } finally {
      hostsLoading.value = false;
    }
  }

  async function saveHost(input: SshHostInput): Promise<SshHostProfile> {
    const saved = await sshClient.saveHost(input);
    await loadHosts();
    return saved;
  }

  async function removeHost(hostId: string): Promise<void> {
    await sshClient.removeHost(hostId);
    const next = { ...statuses.value };
    delete next[hostId];
    statuses.value = next;
    await loadHosts();
  }

  async function parseQuickConnect(raw: string): Promise<[SshHostProfile, string | null]> {
    const result = await sshClient.parseQuickConnect(raw);
    await loadHosts();
    return result;
  }

  async function connect(hostId: string): Promise<SshConnectResult> {
    await initListeners();
    const res = await sshClient.connect(hostId);
    statuses.value = {
      ...statuses.value,
      [res.hostId]: {
        hostId: res.hostId,
        hostLabel: res.hostLabel,
        status: 'connected',
        latencyMs: res.latencyMs,
        error: null,
        capabilities: res.capabilities,
      },
    };
    return res;
  }

  async function testHost(hostId: string): Promise<SshConnectResult> {
    await initListeners();
    return sshClient.testHost(hostId);
  }

  async function reconnect(hostId: string): Promise<SshConnectResult> {
    await initListeners();
    const res = await sshClient.reconnect(hostId);
    statuses.value = {
      ...statuses.value,
      [res.hostId]: {
        hostId: res.hostId,
        hostLabel: res.hostLabel,
        status: 'connected',
        latencyMs: res.latencyMs,
        error: null,
        capabilities: res.capabilities,
      },
    };
    return res;
  }

  async function disconnect(hostId: string): Promise<void> {
    await sshClient.disconnect(hostId);
    const existing = statuses.value[hostId];
    if (existing) {
      statuses.value = {
        ...statuses.value,
        [hostId]: { ...existing, status: 'disconnected', latencyMs: null },
      };
    }
  }

  async function respondChallenge(response: SshChallengeResponse): Promise<void> {
    challengeQueue.value = challengeQueue.value.filter(
      (item) => item.event.challengeId !== response.challengeId,
    );
    await sshClient.respondChallenge(response);
  }

  async function loadKnownHosts() {
    if (!available.value) return;
    knownHosts.value = await sshClient.listKnownHosts();
  }

  async function removeKnownHost(id: string) {
    await sshClient.removeKnownHost(id);
    await loadKnownHosts();
  }

  async function loadSettings() {
    if (!available.value) return;
    settings.value = await sshClient.loadSettings();
  }

  async function saveSettings(next: SshSettings) {
    settings.value = await sshClient.saveSettings(next);
    return settings.value;
  }

  function openConnectModal(hostId?: string | null) {
    if (!available.value) return;
    preselectedHostId.value = hostId ?? null;
    connectModalOpen.value = true;
    void initListeners();
    void loadHosts();
  }

  function closeConnectModal() {
    connectModalOpen.value = false;
    preselectedHostId.value = null;
  }

  return {
    available,
    connectModalOpen,
    preselectedHostId,
    savedHosts,
    configHosts,
    allHosts,
    configPath,
    configParseError,
    hostsLoading,
    hostsError,
    statuses,
    challengeQueue,
    activeChallenge,
    knownHosts,
    settings,
    initListeners,
    disposeListeners,
    loadHosts,
    saveHost,
    removeHost,
    parseQuickConnect,
    connect,
    testHost,
    reconnect,
    disconnect,
    respondChallenge,
    loadKnownHosts,
    removeKnownHost,
    loadSettings,
    saveSettings,
    openConnectModal,
    closeConnectModal,
  };
});
