import { canonicalPluginJson, parsePluginPackage } from '@tano/protocol';
import type { ExecutablePluginManifest, PluginPackage } from '@tano/protocol';
import { pluginIntegrity, readPluginResponse } from './packages';
export interface PluginDevelopmentState { pluginId: string; active: boolean; message: string; updatedAt?: string }
export interface DevelopmentSnapshot { workspaceId: string; integrity: string; manifest: ExecutablePluginManifest; authorized: boolean; enabled: boolean; canManage: boolean }
export interface DevelopmentAccess {
  snapshot(id: string): DevelopmentSnapshot | undefined;
  apply(pkg: PluginPackage, integrity: string, previous: DevelopmentSnapshot, guards: {
    beforeInstall(): void;
    beforeAuthorize(): void;
  }): Promise<void>;
}
const permissionStamp = (manifest: ExecutablePluginManifest) => canonicalPluginJson([
  manifest.apiVersion, [...manifest.permissions].sort(), [...manifest.networkOrigins].sort(), [...manifest.nativeCommands].sort(),
]);
class DevelopmentBoundaryError extends Error {}
/** A device-only explicit trust session; its URL and authorization are never loaded from portable files. */
export class PluginDevelopmentRunner {
  private session?: { controller: AbortController; timer?: ReturnType<typeof setTimeout> };
  constructor(private access: DevelopmentAccess, private changed: (state: PluginDevelopmentState) => void,
    private request: typeof fetch = (...args) => globalThis.fetch(...args), private interval = 1500) {}
  stop(message = '开发会话已停止') {
    const session = this.session;
    if (session) { session.controller.abort(); clearTimeout(session.timer); this.session = undefined; }
    this.changed({ pluginId: '', active: false, message });
  }
  start(id: string, address: string) {
    const url = new URL(address);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || !/^\/[a-f0-9]{48}\/package\.json$/.test(url.pathname)) throw new Error('请输入本机 plugin watch 命令生成的完整地址');
    const initial = this.access.snapshot(id);
    if (!initial?.canManage || !initial.authorized || !initial.enabled) throw new Error('请先安装、启用并授权此插件；开发模式需要工作区管理权限');
    this.stop();
    const session = { controller: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.session = session;
    const signal = session.controller.signal, permissions = permissionStamp(initial.manifest);
    let integrity = initial.integrity, etag = '', updatedAt: string | undefined;
    const assertCurrent = (expectedIntegrity = integrity, requireAuthorization = true) => {
      if (signal.aborted || this.session !== session) throw new DevelopmentBoundaryError('开发会话已停止');
      const current = this.access.snapshot(id);
      if (!current?.canManage || (requireAuthorization && !current.authorized) || !current.enabled || current.workspaceId !== initial.workspaceId ||
        current.integrity !== expectedIntegrity || permissionStamp(current.manifest) !== permissions) throw new DevelopmentBoundaryError('工作区、授权或插件版本已变化，开发会话已停止');
    };
    const status = (message: string) => { if (!signal.aborted) this.changed({ pluginId: id, active: true, message, updatedAt }); };
    const tick = async () => {
      let retry = true;
      try {
        assertCurrent();
        const response = await this.request(url.href, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: etag ? { 'If-None-Match': etag } : {} });
        assertCurrent();
        if (response.status === 304) { status('正在监听构建变化'); return; }
        if (response.status === 503) { await response.body?.cancel(); status('源码构建失败或尚未就绪，修复后会自动重试；当前版本继续运行'); return; }
        retry = false;
        const pkg = parsePluginPackage(await readPluginResponse(response));
        if (pkg.manifest.id !== id || pkg.manifest.manifestVersion !== 2 || permissionStamp(pkg.manifest) !== permissions) throw new DevelopmentBoundaryError('插件身份或权限声明已变化，请手动导入并重新核对权限');
        const nextIntegrity = await pluginIntegrity(pkg);
        assertCurrent();
        if (nextIntegrity !== integrity) {
          status('正在应用开发构建');
          await this.access.apply(pkg, nextIntegrity, { ...initial, integrity }, {
            beforeInstall: () => assertCurrent(),
            // Installation changes the pin before it is authorized. Recheck the live
            // session and exact new rule immediately before granting trust, without an await.
            beforeAuthorize: () => assertCurrent(nextIntegrity, false),
          });
          // The host validates its own transition from the previous to the new exact digest.
          if (signal.aborted || this.session !== session) return;
          integrity = nextIntegrity; updatedAt = new Date().toISOString();
          assertCurrent();
        }
        etag = response.headers.get('ETag') ?? ''; status('正在监听构建变化');
      } catch (cause) {
        if (signal.aborted) return;
        if (cause instanceof DevelopmentBoundaryError || !retry) {
          this.stop(String(cause)); this.changed({ pluginId: id, active: false, message: String(cause), updatedAt });
        } else status(`开发服务暂不可用，将自动重试：${String(cause).slice(0, 200)}`);
      } finally { if (!signal.aborted && this.session === session) session.timer = setTimeout(() => { void tick(); }, this.interval); }
    };
    status('正在连接本机开发服务'); void tick();
  }
}
