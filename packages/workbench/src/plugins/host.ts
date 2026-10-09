import { canonicalPluginJson, parsePluginView, parsePluginJson, parsePluginSettings, pluginKey, pluginRecord, pluginText, pluginStorageLimit } from '@tano/protocol';
import type { ExecutablePluginManifest, PluginCommandDefinition, PluginViewDefinition, PluginPermission, PluginViewNode, PluginJson, PluginUiBundle, Workspace } from '@tano/protocol';
import type { InstalledObjectPlugin } from '../workspace-plugins';
import { PluginPackageCache, fetchPluginText, pluginApplicationStorage, type PluginPackageRepository } from './packages';
import { createPluginSandbox, type PluginSandbox, type PluginSandboxFactory } from './sandbox';
import { applyPluginTextEdits } from './data';
import type { PluginEvent } from '../plugin-sdk';
import type { PluginCatalogProvider } from './catalog';
import { parsePluginConnectionRequest, pluginConnectionOrigin, type PluginConnectionProvider, type PluginAutomationProvider } from '@tano/protocol';

export interface PluginRuntimeServices {
  principal?: string;
  repository?: PluginPackageRepository;
  catalog?: PluginCatalogProvider;
  connections?: PluginConnectionProvider;
  /** Owner-facing host administration. Never exposed to executable plugin code. */
  automations?: PluginAutomationProvider;
  /** Trusted host integrations, explicitly named in a package and device authorization. */
  native?: Record<string, (args: unknown, context: PluginNativeContext) => Promise<unknown>>;
}
export interface PluginNativeContext { workspaceId: string; pluginId: string; integrity: string; signal: AbortSignal }
export interface PluginRuntimeState {
  id: string; instanceId: string; name: string; status: 'loading' | 'running' | 'blocked' | 'error'; message: string;
  commands: PluginCommandDefinition[];
  views: (PluginViewDefinition & { tree?: PluginViewNode; custom?: { bundle: PluginUiBundle; state: PluginJson } })[];
  logs?: { time: string; level: 'info' | 'warn' | 'error'; message: string }[];
}
export interface PluginAccess {
  call(method: string, params: Record<string, unknown>, assertCurrent: () => void): Promise<unknown>;
}
interface Session {
  stamp: string; integrity: string; state: PluginRuntimeState; manifest: ExecutablePluginManifest; controller: AbortController;
  sandbox?: PluginSandbox; timer?: ReturnType<typeof setTimeout>; inFlight: number;
  invocation: number; pending: Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  reads: Map<string, unknown>; storage: string; seen: Set<number>; windowStart: number; calls: number;
  ui?: Record<string, PluginUiBundle>;
}
const permissions: Record<string, PluginPermission> = {
  'views.renderCustom': 'ui',
  'documents.list': 'documents.read', 'documents.read': 'documents.read', 'documents.open': 'documents.read',
  'documents.write': 'documents.write', 'documents.create': 'documents.write',
  'documents.query': 'documents.read', 'documents.search': 'documents.read', 'documents.edit': 'documents.write',
  'objects.query': 'objects.read', 'relations.query': 'relations.read',
  'objects.list': 'objects.read', 'objects.read': 'objects.read', 'objects.create': 'objects.write', 'objects.update': 'objects.write',
  'relations.list': 'relations.read', 'relations.add': 'relations.write', 'relations.remove': 'relations.write',
  'storage.get': 'storage', 'storage.set': 'storage', 'network.get': 'network', 'native.invoke': 'native',
  'storage.remove': 'storage', 'storage.usage': 'storage',
  'connections.request': 'connections',
};
export class PluginExecutionHost {
  private workspace = '';
  private sessions = new Map<string, Session>();
  private logs = new Map<string, NonNullable<PluginRuntimeState['logs']>>();
  constructor(private access: PluginAccess, private changed: (states: PluginRuntimeState[]) => void,
    private services: PluginRuntimeServices = {}, private storage: Pick<Storage, 'getItem' | 'setItem'> = pluginApplicationStorage(),
    private factory: PluginSandboxFactory = createPluginSandbox) {}
  private publish() { this.changed([...this.sessions.values()].map(session => ({ ...session.state, logs: [...(this.logs.get(session.manifest.id) ?? [])], commands: [...session.state.commands], views: [...session.state.views] }))); }
  private log(session: Session, level: 'info' | 'warn' | 'error', message: unknown) {
    const entries = this.logs.get(session.manifest.id) ?? [];
    entries.push({ time: new Date().toISOString(), level, message: String(message).slice(0, 1500) });
    if (entries.length > 100) entries.splice(0, entries.length - 100);
    this.logs.set(session.manifest.id, entries); this.publish();
  }
  clearLogs(id: string) { this.logs.delete(id); this.publish(); }
  storageUsage(workspaceId: string, pluginId: string) {
    const key = `tano.plugin-data.v1.${encodeURIComponent(this.services.principal ?? 'device')}.${encodeURIComponent(workspaceId)}.${pluginId}`;
    return { used: new TextEncoder().encode(this.storage.getItem(key) ?? '{}').length, limit: pluginStorageLimit };
  }
  private stop(session: Session) {
    session.controller.abort(); clearTimeout(session.timer); session.sandbox?.dispose();
    for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('插件已停止')); }
    session.pending.clear(); session.state.commands = []; session.state.views = []; session.reads.clear();
  }
  dispose() { for (const session of this.sessions.values()) this.stop(session); this.sessions.clear(); this.logs.clear(); this.workspace = ''; this.publish(); }
  invalidate(id: string) { const session = this.sessions.get(id); if (session) this.stop(session); this.sessions.delete(id); this.publish(); }
  sync(workspace: Workspace, plugins: InstalledObjectPlugin[]) {
    const scope = `${workspace.id}:${workspace.path}`;
    if (this.workspace !== scope) { this.dispose(); this.workspace = scope; }
    const active = new Set<string>();
    for (const installation of plugins) {
      const { manifest, rule } = installation;
      if (manifest.manifestVersion !== 2 || !installation.enabled || !rule) continue;
      active.add(manifest.id);
      const stamp = canonicalPluginJson([rule, installation.authorized, workspace.readOnly]);
      if (this.sessions.get(manifest.id)?.stamp === stamp) continue;
      const prior = this.sessions.get(manifest.id); if (prior) this.stop(prior);
      const session: Session = { stamp, integrity: rule.integrity ?? '', manifest, controller: new AbortController(), inFlight: 0, invocation: 0, pending: new Map(), reads: new Map(), seen: new Set(), windowStart: Date.now(), calls: 0,
        storage: `tano.plugin-data.v1.${encodeURIComponent(this.services.principal ?? 'device')}.${encodeURIComponent(workspace.id)}.${manifest.id}`,
        state: { id: manifest.id, instanceId: crypto.randomUUID(), name: manifest.name, status: 'blocked', message: '等待此设备授权', commands: [], views: [] } };
      this.sessions.set(manifest.id, session);
      if (!installation.authorized) continue;
      if (manifest.nativeCommands.some(command => !this.services.native || !Object.hasOwn(this.services.native, command))) {
        session.state.message = '当前运行环境不提供此插件要求的本机能力'; continue;
      }
      session.state.status = 'loading'; session.state.message = '正在校验并加载';
      const fail = (message: string) => {
        if (session.controller.signal.aborted) return;
        this.stop(session); session.state.status = 'error'; session.state.message = message.slice(0, 1000); this.log(session, 'error', message);
      };
      session.timer = setTimeout(() => fail('插件启动超时，已停止运行'), 15000);
      void new PluginPackageCache(this.storage).resolve(workspace.id, rule, session.controller.signal, this.services.repository).then(pkg => {
        if (session.controller.signal.aborted) return;
        session.ui = pkg.ui;
        session.sandbox = this.factory(pkg.source!, message => this.receive(session, workspace.id, rule.settings, message, fail), fail);
      }).catch(error => fail(String(error)));
    }
    for (const [id, session] of this.sessions) if (!active.has(id)) { this.stop(session); this.sessions.delete(id); }
    this.publish();
  }
  private assert(session: Session) {
    if (session.controller.signal.aborted || this.sessions.get(session.manifest.id) !== session) throw new Error('插件运行实例已失效');
  }
  private receive(session: Session, workspaceId: string, settings: Record<string, unknown>, message: unknown, fail: (message: string) => void) {
    if (session.controller.signal.aborted || !pluginRecord(message)) return;
    if (Date.now() - session.windowStart > 1000) { session.windowStart = Date.now(); session.calls = 0; }
    if (++session.calls > 200) { fail('插件消息超过资源限制，已停止运行'); return; }
    try { if (JSON.stringify(message).length > 600 * 1024) throw new Error(); }
    catch { fail('插件消息格式无效或超过大小限制，已停止运行'); return; }
    if (message.type === 'ready') { clearTimeout(session.timer); session.state.status = 'running'; session.state.message = ''; this.log(session, 'info', `已启动 ${session.manifest.version}`); return; }
    if (message.type === 'failed') { fail(String(message.error)); return; }
    if (message.type === 'log') { this.log(session, message.level === 'warn' ? 'warn' : message.level === 'info' ? 'info' : 'error', message.message ?? message.error); return; }
    if (message.type === 'invoked') {
      const pending = session.pending.get(Number(message.id));
      if (pending) { clearTimeout(pending.timer); session.pending.delete(Number(message.id)); if (message.error) { this.log(session, 'error', message.error); pending.reject(new Error(String(message.error))); } else pending.resolve(); }
      return;
    }
    if (message.type !== 'call' || !Number.isSafeInteger(message.id) || typeof message.method !== 'string' || !pluginRecord(message.params)) return;
    const id = Number(message.id);
    if (session.seen.has(id)) return;
    session.seen.add(id); if (session.seen.size > 2048) session.seen.delete(session.seen.values().next().value!);
    if (session.inFlight >= 32) { fail('插件请求超过资源限制，已停止运行'); return; }
    session.inFlight++;
    void this.dispatch(session, workspaceId, settings, message.method, message.params).then(result => {
      this.assert(session); session.sandbox?.send({ type: 'result', id, result });
    }).catch(error => {
      if (!session.controller.signal.aborted) { this.log(session, 'error', `${message.method}: ${String(error)}`); session.sandbox?.send({ type: 'result', id, error: String(error) }); }
    }).finally(() => { session.inFlight--; });
  }
  private async dispatch(session: Session, workspaceId: string, settings: Record<string, unknown>, method: string, params: Record<string, unknown>) {
    this.assert(session);
    const permission = permissions[method];
    if (permission && !session.manifest.permissions.includes(permission)) throw new Error(`插件没有 ${permission} 权限`);
    // Workspace rules can be reactive Vue state. MessagePort requires plain data,
    // and plugins must receive a detached settings snapshot rather than host state.
    if (method === 'context') return { workspaceId, pluginId: session.manifest.id, settings: parsePluginSettings(settings) };
    if (method === 'commands.register') {
      const command = session.manifest.commands.find(item => item.id === params.id);
      if (!command) throw new Error('命令没有在清单中声明');
      if (!session.state.commands.some(item => item.id === command.id)) session.state.commands.push(command);
      this.publish(); return null;
    }
    if (method === 'views.render') {
      const definition = session.manifest.views.find(item => item.id === params.id);
      if (!definition) throw new Error('视图没有在清单中声明');
      const tree = parsePluginView(params.tree);
      session.state.views = [...session.state.views.filter(view => view.id !== definition.id), { ...definition, tree }]; this.publish(); return null;
    }
    if (method === 'views.renderCustom') {
      const definition = session.manifest.views.find(item => item.id === params.id);
      const bundle = definition && session.ui && Object.hasOwn(session.ui, definition.id) ? session.ui[definition.id] : undefined;
      if (!definition || !bundle) throw new Error('插件包没有提供此视图的界面');
      const state = parsePluginJson(params.state);
      session.state.views = [...session.state.views.filter(view => view.id !== definition.id), { ...definition, custom: { bundle, state } }];
      this.publish(); return null;
    }
    if (method === 'views.open') {
      const definition = session.manifest.views.find(item => item.id === params.id);
      if (!definition) throw new Error('视图没有在清单中声明');
      return this.access.call('views.open', { pluginId: session.manifest.id, viewId: definition.id }, () => this.assert(session));
    }
    if (method === 'notify') {
      if (!pluginText(params.message, 1000)) throw new Error('插件通知无效');
      session.state.message = params.message; this.publish(); return null;
    }
    if (!permission) throw new Error('不支持此插件 API');
    if (method.startsWith('storage.')) {
      const data = JSON.parse(this.storage.getItem(session.storage) ?? '{}');
      if (!pluginRecord(data)) throw new Error('插件本机状态损坏，原数据已保留');
      if (method === 'storage.usage') return { used: new TextEncoder().encode(JSON.stringify(data)).length, limit: pluginStorageLimit };
      if (!pluginKey(params.key)) throw new Error('插件存储键无效');
      if (method === 'storage.get') return Object.hasOwn(data, params.key) ? data[params.key] : null;
      if (method === 'storage.remove') delete data[params.key];
      else data[params.key] = parsePluginJson(params.value ?? null, pluginStorageLimit);
      const content = JSON.stringify(data);
      if (new TextEncoder().encode(content).length > pluginStorageLimit) throw new Error('插件本机状态不能超过 256 KiB');
      try { this.storage.setItem(session.storage, content); } catch { throw new Error('设备存储空间不足，插件本机状态未写入'); }
      return null;
    }
    if (method === 'connections.request') {
      const origin = pluginConnectionOrigin(params.origin);
      if (!session.manifest.networkOrigins.includes(origin)) throw new Error('此连接来源未在插件清单中声明');
      if (!this.services.connections) throw new Error('当前产品尚未提供插件凭据连接');
      const result = await this.services.connections.request({ workspaceId, pluginId: session.manifest.id, integrity: session.integrity, signal: session.controller.signal }, origin, parsePluginConnectionRequest(params.request));
      this.assert(session); return parsePluginJson(result, 300 * 1024);
    }
    if (method === 'network.get') {
      if (!pluginText(params.url, 2048)) throw new Error('网络地址无效');
      const url = new URL(params.url);
      if (url.protocol !== 'https:' || url.username || url.password || !session.manifest.networkOrigins.includes(url.origin)) throw new Error('此网络来源未经授权');
      return fetchPluginText(url.href, AbortSignal.any([session.controller.signal, AbortSignal.timeout(15000)]), 256 * 1024);
    }
    if (method === 'native.invoke') {
      const command = String(params.command);
      if (!session.manifest.nativeCommands.includes(command) || !this.services.native || !Object.hasOwn(this.services.native, command)) throw new Error('此本机命令不可用');
      const result = await this.services.native[command](params.args, { workspaceId, pluginId: session.manifest.id, integrity: session.integrity, signal: session.controller.signal });
      this.assert(session); return parsePluginJson(result, 300 * 1024);
    }
    if (method === 'documents.write' || method === 'documents.edit' || method === 'objects.update') {
      const key = `${method.startsWith('documents') ? 'document' : 'object'}:${String(params.fileId ?? (pluginRecord(params.object) ? params.object.id : ''))}:${String(params.baseHash)}`;
      const base = session.reads.get(key);
      if (!base) throw new Error('请先读取目标内容，再使用返回的版本摘要修改');
      params = { ...params, base };
      if (method === 'documents.edit') {
        if (!pluginRecord(base) || typeof base.content !== 'string') throw new Error('编辑基线无效');
        params = { ...params, content: applyPluginTextEdits(base.content, params.edits) };
        method = 'documents.write';
      }
    }
    if (method.endsWith('.query') || method === 'documents.search') params = { ...params, queryScope: session.state.instanceId };
    const result = await this.access.call(method, params, () => this.assert(session));
    this.assert(session);
    const remember = (kind: string, value: unknown) => {
      if (!pluginRecord(value) || typeof value.hash !== 'string') return;
      session.reads.set(`${kind}:${String(value.id)}:${value.hash}`, value);
      if (session.reads.size > 32) session.reads.delete(session.reads.keys().next().value!);
    };
    if (method === 'documents.read') remember('document', result);
    if (method === 'objects.read') remember('object', result);
    if (method === 'objects.list' && Array.isArray(result)) result.forEach(value => remember('object', value));
    if (method === 'objects.query' && pluginRecord(result) && Array.isArray(result.items)) result.items.forEach(value => remember('object', value));
    return result;
  }
  invoke(pluginId: string, kind: 'command' | 'action' | 'message' | 'diagnostic', name: string, payload?: unknown, instanceId?: string) {
    const session = this.sessions.get(pluginId);
    if (!session || session.state.status !== 'running') return Promise.reject(new Error('插件尚未运行'));
    if (instanceId && session.state.instanceId !== instanceId) return Promise.reject(new Error('插件运行版本已变化，请重新打开界面'));
    if (session.pending.size >= 32) return Promise.reject(new Error('插件操作过多，请稍后重试'));
    if (kind === 'diagnostic') {
      if (!session.state.views.some(view => view.id === name && view.custom) || !pluginRecord(payload) || typeof payload.message !== 'string') return Promise.reject(new Error('插件界面日志无效'));
      if (Date.now() - session.windowStart > 1000) { session.windowStart = Date.now(); session.calls = 0; }
      if (++session.calls > 200) return Promise.reject(new Error('插件日志超过速率限制'));
      this.log(session, payload.level === 'warn' ? 'warn' : payload.level === 'error' ? 'error' : 'info', `[界面 ${name}] ${payload.message.slice(0, 1400)}`);
      return Promise.resolve();
    }
    if (kind === 'message') {
      if (!session.state.views.some(view => view.id === name && view.custom)) return Promise.reject(new Error('插件界面已关闭'));
      try { payload = parsePluginJson(payload, 16 * 1024); } catch (error) { return Promise.reject(error); }
    }
    this.assert(session);
    const id = ++session.invocation;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop(session); session.state.status = 'error'; session.state.message = '插件操作超时，已停止运行'; this.log(session, 'error', session.state.message); reject(new Error(session.state.message));
      }, 30000);
      session.pending.set(id, { resolve, reject, timer }); session.sandbox?.send({ type: 'invoke', id, kind, name, payload });
    });
  }
  notify(event: PluginEvent) {
    const permission = event.type === 'documents.changed' ? 'documents.read' : event.type === 'objects.changed' ? 'objects.read' : event.type === 'relations.changed' ? 'relations.read' : undefined;
    for (const session of this.sessions.values()) if (session.state.status === 'running' && (!permission || session.manifest.permissions.includes(permission))) session.sandbox?.send({ type: 'event', event });
  }
}
