import { ObjectTypeRegistry, objectTypeRegistry, parseObjectPlugin } from '@tano/protocol';
import type { ObjectPluginManifest } from '@tano/protocol';

export interface InstalledObjectPlugin {
  manifest: ObjectPluginManifest;
  enabled: boolean;
}
const keyFor = (workspace: string) => `tano.object-plugins.v1.${encodeURIComponent(workspace)}`;
export type PluginChange =
  { install: ObjectPluginManifest } | { id: string; enabled: boolean } | { uninstall: string };

/** WebView/browser application storage, scoped to workspace. Never writes workspace files. */
export class WorkspacePluginHost {
  private disposers: (() => void)[] = [];
  private owned = new Set<string>();
  private applied = '';
  private storage: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(
    private registry = objectTypeRegistry,
    storage?: Pick<Storage, 'getItem' | 'setItem'>,
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
    const plugins = this.read(workspace);
    this.validate(plugins);
    this.apply(plugins);
    return plugins;
  }
  async change(workspace: string, change: PluginChange) {
    const update = () => {
      const before = this.storage.getItem(keyFor(workspace));
      let plugins = this.read(workspace);
      if ('install' in change) {
        const manifest = parseObjectPlugin(JSON.stringify(change.install));
        plugins = [
          ...plugins.filter((item) => item.manifest.id !== manifest.id),
          { manifest, enabled: true },
        ];
      } else if ('uninstall' in change)
        plugins = plugins.filter((item) => item.manifest.id !== change.uninstall);
      else {
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
      this.apply(plugins);
      return plugins;
    };
    return typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(keyFor(workspace), update)
      : update();
  }
  dispose() {
    for (const unregister of this.disposers) unregister();
    this.disposers = [];
    this.owned.clear();
    this.applied = '';
  }
}
