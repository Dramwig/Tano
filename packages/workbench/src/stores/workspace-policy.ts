import { computed, ref, watch, type Ref } from 'vue';
import { defaultCapabilities, parseCapabilities } from '@tano/editor/runtime';
import {
  isMarkdown,
  isWorkspaceInternalPath,
  workspaceSettingsPath,
  type FileSnapshot,
  type RecentWorkspace,
  type Workspace,
  type WorkspaceAdapter,
} from '@tano/protocol';
import {
  loadCapabilities,
  saveCapabilityPatch,
  type CapabilityPatch,
} from '../workspace/workspace-capabilities';
import {
  defaultWorkspaceSettings,
  loadWorkspaceSettings,
  saveWorkspaceSettingsPatch,
  type WorkspaceSettings,
  type WorkspaceSettingsPatch,
} from '../workspace/workspace-settings';

export interface WorkspacePolicyDeps {
  adapter: WorkspaceAdapter;
  workspace: Ref<Workspace | null>;
  recent: Ref<RecentWorkspace[]>;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  writable: () => void;
  report: (error: unknown) => void;
}

export function createWorkspacePolicy(deps: WorkspacePolicyDeps) {
  const { adapter, workspace, recent, serial, writable, report } = deps;

  const canManageSettings = computed(
    () =>
      !!workspace.value &&
      !workspace.value.readOnly &&
      (workspace.value.canManageSettings ?? adapter.mode !== 'web'),
  );

  // Workspace settings (.tano/settings.json)
  const workspaceSettings = ref({ ...defaultWorkspaceSettings });
  const pendingWorkspaceIcon = ref<{ workspaceId: string; value: string }>();
  const visibleWorkspaceSettings = computed(() => {
    const pending = pendingWorkspaceIcon.value;
    return pending && pending.workspaceId === workspace.value?.id
      ? { ...workspaceSettings.value, icon: pending.value }
      : workspaceSettings.value;
  });
  const workspaceSettingsError = ref('');
  const workspaceSettingsSaving = ref(false);
  let workspaceSettingsBase: FileSnapshot | null = null;
  let workspaceSettingsScope = '';
  let workspaceDefaultName = '';
  const workspaceNames = new Map<string, string>();

  watch(
    workspace,
    (current) => {
      workspaceDefaultName = current?.name ?? '';
      if (current?.id === workspaceSettingsScope && workspaceSettings.value.name)
        current.name = workspaceSettings.value.name;
    },
    { flush: 'sync' },
  );

  function decorateRecent(items: RecentWorkspace[]) {
    return items.map((item) => ({
      ...item,
      name: workspaceNames.get(item.id) ?? item.name,
      ...(item.id === workspaceSettingsScope ? { icon: workspaceSettings.value.icon } : {}),
    }));
  }

  function decorateRecentNames(items: RecentWorkspace[]) {
    return items.map((item) => ({
      ...item,
      name: workspaceNames.get(item.id) ?? item.name,
    }));
  }

  function applyWorkspaceSettings(
    current: Workspace,
    loaded: { snapshot: FileSnapshot | null; settings: WorkspaceSettings },
  ) {
    workspaceSettingsScope = current.id;
    workspaceSettingsBase = loaded.snapshot;
    workspaceSettings.value = loaded.settings;
    workspaceSettingsError.value = '';
    current.name = loaded.settings.name || workspaceDefaultName;
    workspaceNames.set(current.id, current.name);
    recent.value = recent.value.map((item) => ({
      ...item,
      name: workspaceNames.get(item.id) ?? item.name,
      ...(item.id === current.id ? { icon: loaded.settings.icon } : {}),
    }));
  }

  async function refreshWorkspaceSettings() {
    const current = workspace.value;
    if (!current) return;
    try {
      const loaded = await loadWorkspaceSettings(adapter, current);
      applyWorkspaceSettings(current, loaded);
    } catch (error) {
      workspaceSettingsError.value = `无法读取工作区设置：${String(error)}。原文件已保留。`;
    }
  }

  async function updateWorkspaceSettings(workspaceId: string, patch: WorkspaceSettingsPatch) {
    if (workspaceSettingsSaving.value || workspaceSettingsError.value) return;
    workspaceSettingsSaving.value = true;
    // Preview before joining the filesystem queue; keep the persisted base intact
    // so refreshes and failed writes can still reconcile against the actual file.
    if (
      patch.key === 'icon' &&
      workspace.value?.id === workspaceId &&
      !workspace.value.readOnly &&
      canManageSettings.value
    )
      pendingWorkspaceIcon.value = { workspaceId, value: patch.value };
    try {
      await serial(async () => {
        if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换，请重新打开设置');
        writable();
        if (!canManageSettings.value)
          throw new Error('只有工作区所有者和管理者可以修改工作区设置');
        if (
          patch.key === 'homePageId' &&
          patch.value &&
          !workspace.value.files.some(
            (file) =>
              file.id === patch.value &&
              file.kind === 'file' &&
              isMarkdown(file.path) &&
              !isWorkspaceInternalPath(file.path),
          )
        )
          throw new Error('默认页面已不存在，请重新选择');
        const saved = await saveWorkspaceSettingsPatch(adapter, workspaceSettingsBase, patch);
        // Use the acknowledged state, including a newly created settings file.
        // Legacy adapters only need a scan when they cannot return that new entry.
        if (saved.workspace) workspace.value = saved.workspace;
        else if (!workspace.value.files.some((file) => file.path === workspaceSettingsPath))
          workspace.value = await adapter.refresh();
        applyWorkspaceSettings(workspace.value, saved);
        const entry = workspace.value.files.find((file) => file.path === workspaceSettingsPath);
        if (entry) {
          entry.size = new TextEncoder().encode(saved.snapshot.content).length;
          entry.modified = saved.snapshot.modified;
        }
        pendingWorkspaceIcon.value = undefined;
      });
    } catch (error) {
      pendingWorkspaceIcon.value = undefined;
      report(error);
      if (workspace.value?.id === workspaceId) {
        await serial(async () => {
          if (workspace.value?.id !== workspaceId) return;
          workspace.value = await adapter.refresh();
          await refreshWorkspaceSettings();
        }).catch(report);
        if (workspace.value?.id === workspaceId) workspaceSettingsError.value = String(error);
      }
    } finally {
      pendingWorkspaceIcon.value = undefined;
      workspaceSettingsSaving.value = false;
    }
  }

  async function reloadWorkspaceSettings() {
    await serial(async () => {
      if (!workspace.value) return;
      workspace.value = await adapter.refresh();
      await refreshWorkspaceSettings();
    }).catch(report);
  }

  // Capabilities / workspace rules (.tano/rules.json)
  const capabilities = ref(structuredClone(defaultCapabilities));
  const capabilityError = ref('');
  const capabilitySaving = ref(false);
  let capabilityBase: FileSnapshot | null = null;
  const pendingPageWidths = new Map<
    string,
    { workspaceId: string; documentId: string; limited: boolean }
  >();
  let capabilitySaves = 0;

  function withPendingPageWidth(policy: typeof capabilities.value) {
    const pageWidthLimits = { ...policy.pageWidthLimits };
    for (const pending of pendingPageWidths.values()) {
      if (pending.workspaceId !== workspace.value?.id) continue;
      if (pending.limited) delete pageWidthLimits[pending.documentId];
      else pageWidthLimits[pending.documentId] = false;
    }
    return { ...policy, pageWidthLimits };
  }

  async function refreshCapabilities() {
    if (!workspace.value) return;
    const workspaceId = workspace.value.id;
    try {
      const loaded = await loadCapabilities(adapter, workspace.value);
      if (workspace.value?.id !== workspaceId) return;
      capabilityBase = loaded.snapshot;
      const next = withPendingPageWidth(loaded.capabilities);
      if (JSON.stringify(capabilities.value) !== JSON.stringify(next)) capabilities.value = next;
      capabilityError.value = '';
    } catch (error) {
      capabilityError.value = `无法读取工作区规则：${String(error)}。原文件已保留，设置暂时不可修改。`;
    }
  }

  async function updateCapabilities(patch: CapabilityPatch) {
    if (
      !workspace.value ||
      (capabilitySaving.value && !('pageWidth' in patch)) ||
      capabilityError.value
    )
      return;
    const workspaceId = workspace.value.id;
    const base = capabilityBase;
    capabilitySaves++;
    capabilitySaving.value = true;
    // Keep the preview over any older refresh already ahead of this save in
    // the serial queue. The disk snapshot remains the merge base, not the preview.
    const pending =
      'pageWidth' in patch && canManageSettings.value && !workspace.value.readOnly
        ? { workspaceId, ...patch.pageWidth }
        : undefined;
    const pendingKey = pending ? `${workspaceId}:${pending.documentId}` : '';
    if (pending) {
      pendingPageWidths.set(pendingKey, pending);
      capabilities.value = withPendingPageWidth(capabilities.value);
    }
    try {
      await serial(async () => {
        // A queued click superseded by a newer choice never needs its own write.
        if (pending && pendingPageWidths.get(pendingKey) !== pending) return;
        try {
          if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换，请重试');
          writable();
          if (!canManageSettings.value)
            throw new Error('只有工作区所有者和管理者可以修改工作区设置');
          // Width writes follow preceding local saves, while other policy edits
          // retain the base captured when requested for conflict detection.
          const saved = await saveCapabilityPatch(adapter, pending ? capabilityBase : base, patch);
          capabilityBase = saved.snapshot;
          capabilities.value = withPendingPageWidth(saved.capabilities);
          workspace.value = await adapter.refresh();
        } catch (error) {
          report(error);
          if (pendingPageWidths.get(pendingKey) === pending) pendingPageWidths.delete(pendingKey);
          if (workspace.value?.id === workspaceId) {
            // Keep newer choices visible even when an older write fails.
            capabilities.value = withPendingPageWidth(
              capabilityBase
                ? parseCapabilities(capabilityBase.content)
                : structuredClone(defaultCapabilities),
            );
            await refreshCapabilities();
          }
        } finally {
          if (pendingPageWidths.get(pendingKey) === pending) pendingPageWidths.delete(pendingKey);
        }
      });
    } finally {
      capabilitySaves--;
      capabilitySaving.value = capabilitySaves > 0;
    }
  }

  function resetPolicy(clearCapabilityError = false) {
    workspaceSettingsScope = '';
    workspaceSettingsBase = null;
    workspaceSettings.value = { ...defaultWorkspaceSettings };
    workspaceSettingsError.value = '';
    capabilityBase = null;
    capabilities.value = structuredClone(defaultCapabilities);
    if (clearCapabilityError) capabilityError.value = '';
  }

  function forgetWorkspaceName(id: string) {
    workspaceNames.delete(id);
  }

  return {
    canManageSettings,
    workspaceSettings,
    visibleWorkspaceSettings,
    workspaceSettingsError,
    workspaceSettingsSaving,
    decorateRecent,
    decorateRecentNames,
    refreshWorkspaceSettings,
    updateWorkspaceSettings,
    reloadWorkspaceSettings,
    capabilities,
    capabilityError,
    capabilitySaving,
    refreshCapabilities,
    updateCapabilities,
    resetPolicy,
    forgetWorkspaceName,
  };
}
