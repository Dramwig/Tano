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

/** App-local list of ~/.ssh/config aliases the user explicitly added to Tano. */
const IMPORTED_CONFIG_KEY = 'tano.preference.sshImportedConfigHosts';

function readImportedConfigIds(): string[] | null {
  try {
    const raw = window.localStorage.getItem(IMPORTED_CONFIG_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeImportedConfigIds(ids: string[]) {
  try {
    window.localStorage.setItem(IMPORTED_CONFIG_KEY, JSON.stringify(ids));
  } catch {
    // Storage may be unavailable (private mode); the list then lasts for this session only.
  }
}

export const useSshStore = defineStore('ssh', () => {
  const available = computed(
    () => isFeatureEnabled('sshRemoteWorkspace') && sshClient.available() && !mobile,
  );
  const connectModalOpen = ref(false);
  const preselectedHostId = ref<string | null>(null);
  const startWithNewHost = ref(false);
  const savedHosts = ref<SshHostProfile[]>([]);
  /** Every host parsed from ~/.ssh/config; only `importedConfigIds` are shown as servers. */
  const configHosts = ref<SshHostProfile[]>([]);
  const importedConfigIds = ref<string[]>(readImportedConfigIds() ?? []);
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

  const importedConfigHosts = computed(() => {
    const imported = new Set(importedConfigIds.value);
    return configHosts.value.filter((host) => imported.has(host.id));
  });
  const importableConfigHosts = computed(() => {
    const imported = new Set(importedConfigIds.value);
    return configHosts.value.filter((host) => !imported.has(host.id));
  });
  const allHosts = computed(() => [...savedHosts.value, ...importedConfigHosts.value]);

  function setImportedConfigIds(ids: string[]) {
    importedConfigIds.value = [...new Set(ids)];
    writeImportedConfigIds(importedConfigIds.value);
  }

  function importConfigHosts(ids: string[]) {
    setImportedConfigIds([...importedConfigIds.value, ...ids]);
  }

  function removeConfigHost(hostId: string) {
    setImportedConfigIds(importedConfigIds.value.filter((id) => id !== hostId));
  }

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
      const stored = readImportedConfigIds();
      if (stored === null) {
        // First run after manual import was introduced: keep hosts the user already connected to.
        setImportedConfigIds(
          result.configHosts
            .filter((host) => host.lastConnectedAt || host.recentPaths?.length)
            .map((host) => host.id),
        );
      } else {
        importedConfigIds.value = stored;
      }
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
    if (configHosts.value.some((host) => host.id === hostId)) importConfigHosts([hostId]);
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

  function openConnectModal(hostId?: string | null, options: { newHost?: boolean } = {}) {
    if (!available.value) return;
    preselectedHostId.value = hostId ?? null;
    startWithNewHost.value = !hostId && !!options.newHost;
    connectModalOpen.value = true;
    void initListeners();
    void loadHosts();
  }

  function closeConnectModal() {
    connectModalOpen.value = false;
    preselectedHostId.value = null;
    startWithNewHost.value = false;
  }

  return {
    available,
    connectModalOpen,
    preselectedHostId,
    startWithNewHost,
    savedHosts,
    configHosts,
    importedConfigIds,
    importedConfigHosts,
    importableConfigHosts,
    allHosts,
    importConfigHosts,
    removeConfigHost,
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
