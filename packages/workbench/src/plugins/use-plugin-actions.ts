import { computed, ref, watch, type Ref } from 'vue';
import { t } from '../i18n/i18n';
import { useWorkspaceStore } from '../stores/workspace';
import type { PluginManifest, PluginMode } from '@tano/protocol';
import type { PluginChange } from './workspace-plugins';
import { bundledPluginCatalog, type PluginCatalogEntry } from './plugin-catalog';
export function matchesPlugin(plugin: PluginManifest, query: string) {
  return `${plugin.name} ${plugin.id} ${plugin.description ?? ''} ${plugin.objectTypes.map((type) => `${type.label} ${type.type}`).join(' ')} ${plugin.relationTypes.map((type) => type.label).join(' ')}`
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase());
}
export function usePluginActions(
  detail: Ref<PluginManifest | undefined> = ref(),
  catalog: () => readonly PluginCatalogEntry[] = () => bundledPluginCatalog,
) {
  const store = useWorkspaceStore();
  const selectedInstallation = computed(() =>
    store.installedPlugins.find((item) => item.manifest.id === detail.value?.id),
  );
  const error = ref(''),
    status = ref(''),
    pending = ref('');
  const busy = computed(() => !!pending.value);
  const policyMode = ref<PluginMode>('recommended'),
    settingsText = ref('{}'),
    sourceUrl = ref('');
  watch(
    selectedInstallation,
    (item) => {
      policyMode.value = item?.rule?.mode ?? 'recommended';
      settingsText.value = JSON.stringify(item?.rule?.settings ?? {}, null, 2);
      sourceUrl.value = item?.rule?.sourceUrl ?? '';
    },
    { immediate: true },
  );
  watch(
    () => store.workspace?.id,
    () => {
      error.value = '';
      status.value = '';
    },
  );
  async function installFromCatalog(manifest: PluginManifest) {
    if (busy.value || !store.workspace || !store.canManagePlugins) return;
    const entry = catalog().find((item) => item.manifest.id === manifest.id);
    if (!entry?.loadPackage) {
      await change({ install: manifest, ...(entry?.package ? { package: entry.package } : {}) });
      return;
    }
    const workspace = store.workspace.id;
    pending.value = manifest.id;
    error.value = '';
    status.value = '';
    try {
      const pkg = await entry.loadPackage();
      if (store.workspace?.id !== workspace) return;
      pending.value = '';
      await change({ install: manifest, package: pkg });
    } catch (cause) {
      if (store.workspace?.id === workspace) error.value = String(cause);
    } finally {
      pending.value = '';
    }
  }
  async function change(value: PluginChange) {
    if (busy.value || !store.workspace) return;
    const workspace = store.workspace.id;
    pending.value =
      'install' in value ? value.install.id : 'uninstall' in value ? value.uninstall : value.id;
    error.value = '';
    status.value = '';
    try {
      await store.changePlugin(value, workspace);
      if (store.workspace?.id === workspace) {
        status.value =
          'install' in value
            ? t('{0} 已安装并启用', [value.install.name])
            : 'uninstall' in value
              ? t('插件已卸载，对象和关系文件已保留')
              : 'mode' in value
                ? t('工作区插件规则已保存')
                : 'forgetVersion' in value
                  ? t('已移除历史版本引用')
                  : value.enabled
                    ? t('插件已启用')
                    : t('插件已停用，对象和关系文件已保留');
      }
    } catch (cause) {
      if (store.workspace?.id === workspace) error.value = String(cause);
    } finally {
      pending.value = '';
    }
  }
  async function authorize(allowed: boolean) {
    if (!detail.value || !store.workspace) return;
    try {
      await store.authorizePlugin(
        detail.value.id,
        allowed ? selectedInstallation.value?.rule?.integrity : undefined,
        store.workspace.id,
      );
    } catch (cause) {
      error.value = String(cause);
    }
  }
  async function savePolicy() {
    if (!detail.value) return;
    try {
      await change({
        id: detail.value.id,
        mode: policyMode.value,
        settings: JSON.parse(settingsText.value),
        sourceUrl: sourceUrl.value,
      });
    } catch (cause) {
      error.value = String(cause);
    }
  }

  return {
    error,
    status,
    pending,
    busy,
    policyMode,
    settingsText,
    sourceUrl,
    selectedInstallation,
    change,
    authorize,
    savePolicy,
    installFromCatalog,
  };
}
