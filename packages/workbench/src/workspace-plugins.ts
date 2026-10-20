import { ObjectTypeRegistry, objectTypeRegistry, parseObjectPlugin, parsePluginManifest, parsePluginSettings, parsePluginPolicy, canonicalPluginJson } from '@tano/protocol';
import type { PluginManifest, PluginMode, PluginPackage, Workspace, WorkspaceAdapter, WorkspacePluginRule } from '@tano/protocol';
import { canManageWorkspacePlugins, loadPluginPolicy, savePluginRule } from './plugins/policy';
import type { PluginPolicySnapshot } from './plugins/policy';
import { PluginPackageCache, type PluginPackageRepository } from './plugins/packages';

export const retiredSystemPlugin = (id: string) => id === 'git-inspector';
const retiredMessage = 'Git 功能已内置，请从工作区菜单打开“Git 与同步”，无需安装或授权插件';

export const PLUGINS_TAB_ID = 'view:plugins';

export interface InstalledObjectPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  rule?: WorkspacePluginRule;
  authorized?: boolean;
}
const keyFor = (workspace: string) => `tano.object-plugins.v1.${encodeURIComponent(workspace)}`;
export type PluginChange =
  { install: PluginManifest; package?: PluginPackage; sourceUrl?: string } | { id: string; enabled: boolean } | { uninstall: string }
  | { id: string; forgetVersion: string }
  | { id: string; mode: PluginMode; settings: Record<string, unknown>; sourceUrl?: string };

/** Portable administrator rules and device/account-scoped activation and authorization. */
export class WorkspacePluginHost {
  private disposers: (() => void)[] = [];
  private owned = new Set<string>();
  private applied = '';
  private storage: Pick<Storage, 'getItem' | 'setItem'>;
  private shared: PluginPolicySnapshot | null = null;
  private workspaceId = '';
  constructor(
    private registry = objectTypeRegistry,
    storage?: Pick<Storage, 'getItem' | 'setItem'>,
    private principal = 'device',
  ) {
    const memory = new Map<string, string>();
    this.storage =
      storage ??
      (typeof localStorage !== 'undefined'
        ? localStorage
        : {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => {
              memory.set(key, value);
            },
          });
  }
  private read(workspace: string): InstalledObjectPlugin[] {
    const raw = this.storage.getItem(keyFor(workspace));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.plugins) || data.plugins.length > 100)
      throw new Error('插件安装记录损坏，原记录已保留');
    const ids = new Set<string>();
    return data.plugins.map((item: InstalledObjectPlugin) => {
      const manifest = parseObjectPlugin(JSON.stringify(item.manifest));
      if (typeof item.enabled !== 'boolean' || ids.has(manifest.id))
        throw new Error('插件安装记录重复或无效');
      ids.add(manifest.id);
      return { manifest, enabled: item.enabled };
    });
  }
  private validate(plugins: InstalledObjectPlugin[]) {
    const registry = new ObjectTypeRegistry();
    for (const definition of this.registry.list()) {
      if (definition.plugin && !this.owned.has(definition.type))
        registry.registerObjectType({ ...definition, plugin: definition.plugin });
    }
    for (const { manifest, enabled } of plugins)
      if (enabled)
        for (const definition of manifest.objectTypes)
          registry.registerObjectType({ ...definition, plugin: manifest.id });
  }
  private apply(plugins: InstalledObjectPlugin[]) {
    const serialized = JSON.stringify(plugins);
    if (serialized === this.applied) return;
    this.dispose();
    for (const { manifest, enabled } of plugins)
      if (enabled)
        for (const definition of manifest.objectTypes) {
          this.disposers.push(
            this.registry.registerObjectType({ ...definition, plugin: manifest.id }),
          );
          this.owned.add(definition.type);
        }
    this.applied = serialized;
  }
  load(workspace: string) {
    const plugins = this.read(workspace).filter(item => !retiredSystemPlugin(item.manifest.id));
    this.validate(plugins);
    this.apply(plugins);
    return plugins;
  }
  async change(workspace: string, change: PluginChange) {
    const id = 'install' in change ? change.install.id : 'uninstall' in change ? change.uninstall : change.id;
    if (retiredSystemPlugin(id) && !('uninstall' in change)) throw new Error(retiredMessage);
    const update = () => {
      const before = this.storage.getItem(keyFor(workspace));
      let plugins = this.read(workspace);
      if ('install' in change) {
        const manifest = parseObjectPlugin(JSON.stringify(change.install));
        if (retiredSystemPlugin(manifest.id)) throw new Error(retiredMessage);
        plugins = [
          ...plugins.filter((item) => item.manifest.id !== manifest.id),
          { manifest, enabled: true },
        ];
      } else if ('uninstall' in change)
        plugins = plugins.filter((item) => item.manifest.id !== change.uninstall);
      else if ('enabled' in change) {
        if (!plugins.some((item) => item.manifest.id === change.id))
          throw new Error('插件已被卸载，请刷新后重试');
        plugins = plugins.map((item) =>
          item.manifest.id === change.id ? { ...item, enabled: change.enabled } : item,
        );
      }
      this.validate(plugins);
      if (before !== this.storage.getItem(keyFor(workspace)))
        throw new Error('插件状态已在另一窗口改变，请重试');
      this.storage.setItem(keyFor(workspace), JSON.stringify({ version: 1, plugins }));
      const active = plugins.filter(item => !retiredSystemPlugin(item.manifest.id));
      this.apply(active);
      return active;
    };
    return typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(keyFor(workspace), update)
      : update();
  }
  private preferences(workspace: string): Record<string, { enabled?: boolean; integrity?: string }> {
    const raw = this.storage.getItem(`tano.plugin-preferences.v1.${encodeURIComponent(this.principal)}.${encodeURIComponent(workspace)}`);
    const value = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件个人设置损坏，原记录已保留');
    return value;
  }
  private setPreference(workspace: string, id: string, value: { enabled?: boolean; integrity?: string }) {
    const preferences = this.preferences(workspace);
    preferences[id] = { ...preferences[id], ...value };
    this.storage.setItem(`tano.plugin-preferences.v1.${encodeURIComponent(this.principal)}.${encodeURIComponent(workspace)}`, JSON.stringify(preferences));
  }
  authorize(workspace: string, id: string, integrity: string | undefined, expectedAuthorization?: string) {
    if (workspace !== this.workspaceId) throw new Error('工作区已切换');
    const rule = this.shared?.policy.plugins.find(row => row.manifest.id === id);
    if (!rule || (integrity && rule.integrity !== integrity)) throw new Error('插件版本已变化，请重新查看权限');
    if (expectedAuthorization !== undefined && this.preferences(workspace)[id]?.integrity !== expectedAuthorization)
      throw new Error('原版本授权已撤销或变化，开发会话已停止');
    this.setPreference(workspace, id, { integrity: integrity ?? '' });
  }
  async loadWorkspace(adapter: WorkspaceAdapter, workspace: Workspace) {
    const shared = await loadPluginPolicy(adapter, workspace);
    this.workspaceId = workspace.id;
    this.shared = shared;
    if (!shared.snapshot) return this.load(workspace.id);
    const preferences = this.preferences(workspace.id);
    const plugins = shared.policy.plugins.filter(rule => !retiredSystemPlugin(rule.manifest.id)).map(rule => ({ manifest: rule.manifest, rule,
      enabled: rule.mode === 'required' || (rule.mode !== 'disabled' && (preferences[rule.manifest.id]?.enabled ?? rule.mode === 'recommended')),
      authorized: rule.manifest.manifestVersion === 1 || preferences[rule.manifest.id]?.integrity === rule.integrity,
    }));
    this.validate(plugins);
    this.apply(plugins);
    return plugins;
  }
  async changeWorkspace(adapter: WorkspaceAdapter, workspace: Workspace, change: PluginChange,
    assertCurrent: () => void, repository?: PluginPackageRepository) {
    if (this.workspaceId !== workspace.id || !this.shared) throw new Error('请先载入工作区插件规则');
    const id = 'install' in change ? change.install.id : 'uninstall' in change ? change.uninstall : change.id;
    if (retiredSystemPlugin(id) && !('uninstall' in change)) throw new Error(retiredMessage);
    const rule = this.shared.policy.plugins.find(row => row.manifest.id === id);
    if ('enabled' in change && this.shared.snapshot) {
      if (!rule) throw new Error('插件已被卸载，请刷新后重试');
      if (rule.mode === 'required' || rule.mode === 'disabled') throw new Error('此插件由工作区管理员统一控制');
      this.setPreference(workspace.id, id, { enabled: change.enabled });
      return;
    }
    if (!canManageWorkspacePlugins(adapter, workspace)) throw new Error('仅工作区管理员可以修改插件规则');
    let desired: WorkspacePluginRule | null = null;
    if ('install' in change) {
      const manifest = parsePluginManifest(change.install);
      let integrity: string | undefined;
      if (manifest.manifestVersion === 2) {
        if (!change.package || canonicalPluginJson(change.package.manifest) !== canonicalPluginJson(manifest)) throw new Error('请导入包含此版本脚本的插件包');
        const cache = new PluginPackageCache(this.storage);
        integrity = await cache.put(change.package);
        assertCurrent();
        if (repository) await repository.publish(workspace.id, integrity, canonicalPluginJson(change.package));
      }
      desired = { manifest, mode: rule?.mode ?? 'recommended', settings: rule?.settings ?? {},
        ...(integrity ? { integrity } : {}), ...(change.sourceUrl ? { sourceUrl: change.sourceUrl } : {}) };
      if (rule) {
        const same = rule.integrity === integrity && canonicalPluginJson(rule.manifest) === canonicalPluginJson(manifest);
        const previous = { manifest: rule.manifest, ...(rule.integrity ? { integrity: rule.integrity } : {}), ...(rule.sourceUrl ? { sourceUrl: rule.sourceUrl } : {}), recordedAt: new Date().toISOString() };
        desired.history = (same ? rule.history ?? [] : [previous, ...(rule.history ?? [])]).filter(version =>
          version.integrity !== integrity || canonicalPluginJson(version.manifest) !== canonicalPluginJson(manifest)).slice(0, 10);
      }
    } else if ('forgetVersion' in change) {
      if (!rule || rule.integrity === change.forgetVersion || !rule.history?.some(version => version.integrity === change.forgetVersion))
        throw new Error('只能移除已有的历史版本引用');
      desired = { ...rule, history: rule.history.filter(version => version.integrity !== change.forgetVersion) };
    } else if ('mode' in change) {
      if (!rule) throw new Error('插件已被卸载，请刷新后重试');
      desired = { ...rule, mode: change.mode, settings: parsePluginSettings(change.settings), sourceUrl: change.sourceUrl || undefined };
    } else if ('enabled' in change) {
      const legacy = this.read(workspace.id).find(row => row.manifest.id === id);
      if (!legacy) throw new Error('插件已被卸载');
      desired = { manifest: legacy.manifest, mode: change.enabled ? 'recommended' : 'optional', settings: {} };
    }
    // First shared edit migrates existing declarations without deleting the recoverable local record.
    const base = this.shared.snapshot ? this.shared : { ...this.shared, policy: { version: 1 as const,
      plugins: this.read(workspace.id).map(row => ({ manifest: row.manifest, mode: (row.enabled ? 'recommended' : 'optional') as PluginMode, settings: {} })) } };
    const next = parsePluginPolicy(JSON.stringify({ version: 1, plugins: [...base.policy.plugins.filter(row => row.manifest.id !== id), ...(desired ? [desired] : [])] }));
    this.validate(next.plugins.filter(row => row.mode !== 'disabled').map(row => ({ manifest: row.manifest, enabled: true })));
    assertCurrent();
    this.shared = await savePluginRule(adapter, base, id, desired, assertCurrent);
  }
  dispose() {
    for (const unregister of this.disposers) unregister();
    this.disposers = [];
    this.owned.clear();
    this.applied = '';
  }
}
