import { objectTypeRegistry, parsePluginCatalog, parsePluginPackage, type PluginCatalogRelease, type Workspace, type WorkspaceAdapter } from '@tano/protocol';
import { WorkspacePluginHost, type InstalledObjectPlugin, type PluginChange } from './workspace-plugins';
import { PluginExecutionHost, type PluginAccess, type PluginRuntimeServices, type PluginRuntimeState } from './plugins/host';
import { PluginDevelopmentRunner, type PluginDevelopmentState } from './plugins/development';
import { PluginPackageCache } from './plugins/packages';
import { canManageWorkspacePlugins } from './plugins/policy';
import { verifyCatalogPackage } from './plugins/catalog';

export interface WorkspacePluginRuntimeHost {
  adapter: WorkspaceAdapter;
  services?: PluginRuntimeServices;
  workspace(): Workspace | null;
  setWorkspace(workspace: Workspace): void;
  installed(): readonly InstalledObjectPlugin[];
  canManage(): boolean;
  serial<T>(task: () => Promise<T>): Promise<T>;
  refresh(): Promise<void>;
  call: PluginAccess['call'];
  changed(states: PluginRuntimeState[]): void;
  developmentChanged(state: PluginDevelopmentState): void;
}

/** Owns plugin execution, development sessions and guarded management operations. */
export class WorkspacePluginRuntime {
  readonly policy: WorkspacePluginHost;
  readonly executor: PluginExecutionHost;
  readonly developer: PluginDevelopmentRunner;
  private developmentState: PluginDevelopmentState = { pluginId: '', active: false, message: '' };
  constructor(private readonly host: WorkspacePluginRuntimeHost) {
    this.policy = new WorkspacePluginHost(objectTypeRegistry, undefined, host.services?.principal);
    this.executor = new PluginExecutionHost({ call: host.call }, host.changed, host.services);
    this.developer = new PluginDevelopmentRunner({
      snapshot: (id) => {
        const installation = this.host.installed().find(plugin => plugin.manifest.id === id);
        const workspace = this.host.workspace();
        if (!workspace || installation?.manifest.manifestVersion !== 2 || !installation.rule?.integrity) return;
        return { workspaceId: workspace.id, manifest: installation.manifest, integrity: installation.rule.integrity,
          authorized: !!installation.authorized, enabled: installation.enabled, canManage: this.host.canManage() };
      },
      apply: (pkg, integrity, previous, guards) => this.host.serial(async () => {
        const assertSession = guards.beforeInstall;
        assertSession(); await this.refresh(); assertSession();
        await this.policy.changeWorkspace(this.host.adapter, this.host.workspace()!, { install: pkg.manifest, package: pkg }, assertSession, this.host.services?.repository);
        // Re-read authority before authorizing the newly installed bytes. The previous
        // digest assertion remains valid until refreshObjects publishes the new rule.
        assertSession(); this.host.setWorkspace(await this.host.adapter.refresh());
        const workspace = this.host.workspace();
        if (!workspace || workspace.id !== previous.workspaceId || !canManageWorkspacePlugins(this.host.adapter, workspace)) throw new Error('工作区或管理权限已变化');
        await this.host.refresh();
        if (this.host.installed().find(plugin => plugin.manifest.id === pkg.manifest.id)?.rule?.integrity !== integrity) throw new Error('插件版本被另一操作更改，请重新连接开发服务');
        guards.beforeAuthorize();
        this.policy.authorize(previous.workspaceId, pkg.manifest.id, integrity, previous.integrity);
        await this.host.refresh();
      }),
    }, state => { this.developmentState = state; host.developmentChanged(state); });
  }

  changePlugin = async (change: PluginChange, expectedWorkspace: string) => {
    return this.host.serial(async () => {
      const workspace = this.host.workspace();
      if (!workspace || workspace.id !== expectedWorkspace) throw new Error('工作区已切换，请重试');
      const assertCurrent = () => this.assertWorkspace(expectedWorkspace);
      await this.policy.changeWorkspace(this.host.adapter, workspace, change, assertCurrent, this.host.services?.repository);
      await this.refresh();
    });
  }
  loadPluginCatalog = async (signal: AbortSignal) => {
    if (!this.host.services?.catalog) throw new Error('此产品尚未配置社区插件目录');
    const value = await this.host.services.catalog.list(signal);
    signal.throwIfAborted();
    return parsePluginCatalog(JSON.stringify(value));
  }
  installCatalogRelease = async (release: PluginCatalogRelease, expectedWorkspace: string, signal: AbortSignal) => {
    const assertCurrent = () => {
      signal.throwIfAborted();
      this.assertWorkspace(expectedWorkspace, true);
    };
    assertCurrent();
    if (!this.host.services?.catalog || release.status !== 'published') throw new Error('此目录版本不可安装');
    const downloaded = await this.host.services.catalog.download(release, signal);
    assertCurrent();
    const pkg = parsePluginPackage(JSON.stringify(downloaded.pkg));
    await verifyCatalogPackage(release, pkg); assertCurrent();
    return this.host.serial(async () => {
      assertCurrent(); await this.refresh(); assertCurrent();
      await this.policy.changeWorkspace(this.host.adapter, this.host.workspace()!, { install: pkg.manifest, package: pkg, sourceUrl: downloaded.sourceUrl }, assertCurrent, this.host.services?.repository);
      assertCurrent(); await this.refresh();
    });
  }
  authorizePlugin = async (id: string, integrity: string | undefined, expectedWorkspace: string) => {
    if (!integrity && this.host.workspace()?.id === expectedWorkspace && this.developmentState.pluginId === id) this.developer.stop();
    return this.host.serial(async () => {
      this.assertWorkspace(expectedWorkspace);
      this.policy.authorize(expectedWorkspace, id, integrity);
      await this.host.refresh();
    });
  }
  cachePluginPackage = async (content: string) => {
    const pkg = parsePluginPackage(content);
    const integrity = await new PluginPackageCache().put(pkg);
    this.executor.invalidate(pkg.manifest.id);
    return integrity;
  }
  restartPlugin = async (id: string, expectedWorkspace: string) => {
    return this.host.serial(async () => {
      if (this.host.workspace()?.id !== expectedWorkspace) throw new Error('工作区已切换');
      this.executor.invalidate(id);
      await this.refresh();
    });
  }
  rollbackPlugin = async (id: string, integrity: string, expectedWorkspace: string) => {
    return this.host.serial(async () => {
      const assertCurrent = () => {
        if (this.host.workspace()?.id !== expectedWorkspace || !this.host.canManage()) throw new Error('工作区或管理权限已变化');
      };
      assertCurrent();
      await this.refresh(); assertCurrent();
      const rule = this.host.installed().find(plugin => plugin.manifest.id === id)?.rule;
      const previous = rule?.history?.find(version => version.integrity === integrity);
      if (!rule || !previous) throw new Error('此历史版本已不可用，请刷新后重试');
      const pkg = await new PluginPackageCache().resolve(expectedWorkspace, { ...previous, mode: rule.mode, settings: rule.settings }, AbortSignal.timeout(15000), this.host.services?.repository);
      assertCurrent();
      await this.policy.changeWorkspace(this.host.adapter, this.host.workspace()!, { install: pkg.manifest, package: pkg, sourceUrl: previous.sourceUrl }, assertCurrent, this.host.services?.repository);
      await this.refresh();
    });
  }
  private assertWorkspace(expected: string, manage = false) {
    if (this.host.workspace()?.id !== expected || (manage && !this.host.canManage()))
      throw new Error('工作区或管理权限已变化');
  }
  private async refresh() {
    this.host.setWorkspace(await this.host.adapter.refresh());
    await this.host.refresh();
  }
  dispose() { this.developer.stop(); this.executor.dispose(); this.policy.dispose(); }
}
