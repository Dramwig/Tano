import {
  canonicalPluginJson,
  checkPluginCompatibility,
  classifyPluginError,
  parsePluginAiRequest,
  parsePluginEditorDecorations,
  parsePluginFrontmatterPatch,
  parsePluginStatusBarItem,
  parsePluginUiConfirmOptions,
  parsePluginUiPickOptions,
  parsePluginUiPromptOptions,
  parsePluginUiToastOptions,
  parsePluginView,
  parsePluginJson,
  pluginAssistantContextMaxBytes,
  pluginKey,
  pluginRecord,
  pluginText,
  pluginStorageLimit,
  resolvePluginSettingsWithDefaults,
  TANO_PLUGIN_API_VERSION,
  validateAgainstPluginJsonSchema,
} from '@tano/protocol';
import { patchFrontmatterMarkdown, readFrontmatterData } from '@tano/protocol/frontmatter';
import type {
  ExecutablePluginManifest,
  PluginAssistantContextProviderDefinition,
  PluginAssistantToolDefinition,
  PluginCommandDefinition,
  PluginEditorDecoration,
  PluginHostEnvironment,
  PluginStatusBarItem,
  PluginViewDefinition,
  PluginPermission,
  PluginViewNode,
  PluginJson,
  PluginUiBundle,
  Workspace,
  WorkspacePersonalPluginPolicy,
} from '@tano/protocol';
import workbenchPackage from '../../package.json';
import type { InstalledObjectPlugin } from './workspace-plugins';
import { PluginPackageCache, fetchPluginText, pluginApplicationStorage, type PluginPackageRepository } from './packages';
import { createPluginSandbox, type PluginSandbox, type PluginSandboxFactory } from './sandbox';
import { applyPluginTextEdits } from './data';
import type { PluginEvent } from './plugin-sdk';
import type { PluginCatalogProvider } from './catalog';
import { resolveSystemPlugin } from './system';
import { parseViewHeader, type PluginViewHeader } from './view-header';
import { parsePluginConnectionRequest, pluginConnectionOrigin, type PluginConnectionProvider, type PluginAutomationProvider } from '@tano/protocol';

export interface PluginRuntimeServices {
  principal?: string;
  host?: PluginHostEnvironment;
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
  id: string; instanceId: string; name: string; status: 'idle' | 'loading' | 'running' | 'blocked' | 'error'; message: string;
  commands: PluginCommandDefinition[];
  views: (PluginViewDefinition & { header?: PluginViewHeader; tree?: PluginViewNode; custom?: { bundle: PluginUiBundle; state: PluginJson } })[];
  assistantTools?: PluginAssistantToolDefinition[];
  assistantContextProviders?: PluginAssistantContextProviderDefinition[];
  statusBar?: PluginStatusBarItem[];
  decorations?: Record<string, PluginEditorDecoration[]>;
  uiBundles?: Record<string, PluginUiBundle>;
  logs?: { time: string; level: 'info' | 'warn' | 'error'; message: string }[];
}
export interface PluginAccess {
  call(method: string, params: Record<string, unknown>, assertCurrent: () => void): Promise<unknown>;
}
interface Session {
  stamp: string; integrity: string; state: PluginRuntimeState; manifest: ExecutablePluginManifest; controller: AbortController;
  sandbox?: PluginSandbox; timer?: ReturnType<typeof setTimeout>; inFlight: number;
  invocation: number; pending: Map<number, { resolve: (value?: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  reads: Map<string, unknown>; storage: string; seen: Set<number>; windowStart: number; calls: number;
  ui?: Record<string, PluginUiBundle>;
  start?: () => void;
  readyWaiters: { resolve: () => void; reject: (error: Error) => void }[];
  activeDialog: boolean;
  activeAiCall: boolean;
  registeredServices: Set<string>;
  serviceCallDepth: number;
  scope?: 'system' | 'workspace' | 'user';
  personalCodePolicy?: WorkspacePersonalPluginPolicy;
  pathScopes?: string[];
}
const writePermissions = new Set<PluginPermission>([
  'attachments.write',
  'documents.write',
  'documents.move',
  'documents.trash',
  'objects.write',
  'relations.write',
]);
const permissions: Record<string, PluginPermission> = {
  'views.setHeader': 'ui',
  'attachments.read': 'attachments.read',
  'attachments.write': 'attachments.write',
  'views.renderCustom': 'ui',
  'documents.list': 'documents.read', 'documents.read': 'documents.read', 'documents.open': 'documents.read',
  'documents.write': 'documents.write', 'documents.create': 'documents.write',
  'documents.move': 'documents.move', 'documents.trash': 'documents.trash',
  'documents.query': 'documents.read', 'documents.search': 'documents.read', 'documents.edit': 'documents.write',
  'documents.frontmatter.read': 'documents.read', 'documents.frontmatter.update': 'documents.write',
  'editor.active': 'documents.read', 'editor.insert': 'documents.write', 'editor.replaceSelection': 'documents.write',
  'editor.setDecorations': 'documents.read', 'editor.clearDecorations': 'documents.read',
  'objects.query': 'objects.read', 'relations.query': 'relations.read',
  'objects.list': 'objects.read', 'objects.read': 'objects.read', 'objects.create': 'objects.write', 'objects.update': 'objects.write',
  'relations.list': 'relations.read', 'relations.add': 'relations.write', 'relations.remove': 'relations.write',
  'storage.get': 'storage', 'storage.set': 'storage', 'network.get': 'network', 'native.invoke': 'native',
  'storage.remove': 'storage', 'storage.usage': 'storage',
  'connections.request': 'connections',
  'ai.complete': 'ai.invoke', 'ai.structured': 'ai.invoke',
};
export class PluginExecutionHost {
  private workspace = '';
  private sessions = new Map<string, Session>();
  private logs = new Map<string, NonNullable<PluginRuntimeState['logs']>>();
  constructor(private access: PluginAccess, private changed: (states: PluginRuntimeState[]) => void,
    private services: PluginRuntimeServices = {}, private storage: Pick<Storage, 'getItem' | 'setItem'> = pluginApplicationStorage(),
    private factory: PluginSandboxFactory = createPluginSandbox) {}
  private publish() {
    this.changed(
      [...this.sessions.values()].map(session => ({
        ...session.state,
        logs: [...(this.logs.get(session.manifest.id) ?? [])],
        commands: [...session.state.commands],
        views: [...session.state.views],
        assistantTools: [...(session.state.assistantTools ?? [])],
        assistantContextProviders: [...(session.state.assistantContextProviders ?? [])],
        statusBar: [...(session.state.statusBar ?? [])],
        decorations: session.state.decorations
          ? Object.fromEntries(Object.entries(session.state.decorations).map(([k, v]) => [k, [...v]]))
          : undefined,
        uiBundles: session.state.uiBundles ? { ...session.state.uiBundles } : undefined,
      })),
    );
  }
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
  private hostEnvironment(): PluginHostEnvironment {
    return this.services.host ?? { coreVersion: workbenchPackage.version, platform: 'web' };
  }
  private hostCapabilities(): string[] {
    return [
      'documents',
      'documents.frontmatter',
      'documents.move',
      'documents.trash',
      'editor.active',
      'editor.insert',
      'editor.replaceSelection',
      'editor.slashCommands',
      'editor.decorations',
      'editor.codeBlockRenderers',
      'objects',
      'relations',
      'attachments.read',
      'attachments.write',
      'security.pathScopes',
      'security.personalCodePlugins',
      'ai.invoke',
      'assistant.tools',
      'assistant.contextProviders',
      'services.rpc',
      'package.v2.zip',
      'assets.binary',
      'views.homeTab',
      'views.newTab',
      'ui',
      'ui.dialogs',
      'ui.statusBar',
      'views.documentSidebar',
      'views.documentHeader',
      'views.documentFooter',
      'fileHandlers',
      'settingsSchema',
      'activationEvents',
      'lifecycle.deactivate',
      'storage',
      'network',
      ...(this.services.connections ? ['connections'] : []),
      ...(this.services.connections?.oauth ? ['oauth'] : []),
      ...(this.services.automations ? ['automations'] : []),
      ...Object.keys(this.services.native ?? {}).map(command => `native:${command}`),
    ];
  }
  private settleWaiters(session: Session, error?: Error) {
    const waiters = session.readyWaiters.splice(0);
    for (const waiter of waiters) if (error) waiter.reject(error); else waiter.resolve();
  }
  private stop(session: Session, graceful = true) {
    const wasRunning = session.state.status === 'running';
    session.activeDialog = false;
    session.activeAiCall = false;
    session.registeredServices.clear();
    session.serviceCallDepth = 0;
    session.controller.abort(); clearTimeout(session.timer);
    if (graceful && wasRunning && session.sandbox?.gracefulDispose) session.sandbox.gracefulDispose();
    else session.sandbox?.dispose();
    this.settleWaiters(session, new Error('插件已停止'));
    for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('插件已停止')); }
    session.pending.clear(); session.state.commands = []; session.state.views = []; session.state.assistantTools = []; session.state.assistantContextProviders = []; session.state.statusBar = [];
    session.state.decorations = undefined; session.state.uiBundles = undefined; session.reads.clear();
  }
  dispose() { for (const session of this.sessions.values()) this.stop(session); this.sessions.clear(); this.logs.clear(); this.workspace = ''; this.publish(); }
  invalidate(id: string) { const session = this.sessions.get(id); if (session) this.stop(session); this.sessions.delete(id); this.publish(); }
  private activateSession(session: Session, workspaceId: string, installation: InstalledObjectPlugin, rule: NonNullable<InstalledObjectPlugin['rule']>) {
    if (session.controller.signal.aborted || session.state.status === 'loading' || session.state.status === 'running') return;
    session.state.status = 'loading'; session.state.message = '正在校验并加载';
    // Clear pre-populated idle commands so the running plugin explicitly registers its live handlers.
    session.state.commands = [];
    session.state.assistantTools = [];
    session.state.assistantContextProviders = [];
    this.publish();
    const fail = (message: string) => {
      if (session.controller.signal.aborted) return;
      this.stop(session, false); session.state.status = 'error'; session.state.message = message.slice(0, 1000); this.log(session, 'error', message);
    };
    session.timer = setTimeout(() => fail('插件启动超时，已停止运行'), 15000);
    const packageSource = installation.system ? resolveSystemPlugin(rule)
      : new PluginPackageCache(this.storage).resolve(
          workspaceId,
          rule,
          session.controller.signal,
          installation.scope === 'user' ? undefined : this.services.repository,
        );
    void packageSource.then(pkg => {
      if (session.controller.signal.aborted) return;
      session.ui = pkg.ui;
      session.state.uiBundles = pkg.ui ? { ...pkg.ui } : undefined;
      session.sandbox = this.factory(pkg.source!, message => this.receive(session, workspaceId, rule.settings, message, fail), fail);
    }).catch(error => fail(String(error)));
  }
  ensureActivated(pluginId: string): Promise<void> {
    const session = this.sessions.get(pluginId);
    if (!session) return Promise.reject(new Error('插件尚未运行'));
    if (session.state.status === 'running') return Promise.resolve();
    if (session.state.status === 'idle' && session.start) {
      const start = session.start;
      session.start = undefined;
      return new Promise<void>((resolve, reject) => {
        session.readyWaiters.push({ resolve, reject });
        start();
      });
    }
    if (session.state.status === 'loading') {
      return new Promise<void>((resolve, reject) => { session.readyWaiters.push({ resolve, reject }); });
    }
    return Promise.reject(new Error(session.state.message || '插件尚未运行'));
  }
  sync(workspace: Workspace, plugins: InstalledObjectPlugin[], safeMode = false) {
    const scope = `${workspace.id}:${workspace.path}`;
    if (this.workspace !== scope) { this.dispose(); this.workspace = scope; }
    const active = new Set<string>();
    const hostEnv = this.hostEnvironment();
    for (const installation of plugins) {
      const { manifest, rule } = installation;
      if (manifest.manifestVersion !== 2 || !installation.enabled || !rule) continue;
      active.add(manifest.id);
      const pathScopes = installation.pathScopes ?? rule.pathScopes;
      const stamp = canonicalPluginJson([
        rule,
        installation.authorized,
        installation.scope,
        installation.personalCodePolicy,
        pathScopes,
        workspace.readOnly,
        hostEnv,
        safeMode && !installation.system,
      ]);
      if (this.sessions.get(manifest.id)?.stamp === stamp) continue;
      const prior = this.sessions.get(manifest.id); if (prior) this.stop(prior);
      const safeBlocked = safeMode && !installation.system;
      const session: Session = {
        stamp,
        integrity: rule.integrity ?? '',
        manifest,
        controller: new AbortController(),
        inFlight: 0,
        invocation: 0,
        pending: new Map(),
        reads: new Map(),
        seen: new Set(),
        windowStart: Date.now(),
        calls: 0,
        readyWaiters: [],
        activeDialog: false,
        activeAiCall: false,
        registeredServices: new Set(),
        serviceCallDepth: 0,
        scope: installation.scope,
        personalCodePolicy: installation.personalCodePolicy,
        pathScopes: pathScopes?.length ? [...pathScopes] : undefined,
        storage: `tano.plugin-data.v1.${encodeURIComponent(this.services.principal ?? 'device')}.${encodeURIComponent(workspace.id)}.${manifest.id}`,
        state: {
          id: manifest.id,
          instanceId: crypto.randomUUID(),
          name: manifest.name,
          status: 'blocked',
          message: safeBlocked
            ? '安全模式已启用，已跳过第三方代码插件'
            : installation.scope === 'user' && installation.personalCodePolicy === 'block'
              ? '此工作区管理员策略禁止个人代码插件访问工作区数据'
              : '等待此设备授权',
          commands: [],
          views: [],
          assistantTools: [],
          assistantContextProviders: [],
          statusBar: [],
        },
      };
      this.sessions.set(manifest.id, session);
      if (safeBlocked) continue;
      if (installation.scope === 'user' && installation.personalCodePolicy === 'block') continue;
      if (!installation.authorized) continue;
      const compatibility = checkPluginCompatibility(manifest, hostEnv);
      if (!compatibility.compatible) {
        session.state.message = compatibility.reason ?? '当前运行环境不兼容此插件'; continue;
      }
      if (manifest.nativeCommands.some(command => !this.services.native || !Object.hasOwn(this.services.native, command))) {
        session.state.message = '当前运行环境不提供此插件要求的本机能力'; continue;
      }
      const lazy = !!manifest.activationEvents?.length && !manifest.activationEvents.includes('onStartup');
      if (lazy) {
        session.state.status = 'idle';
        session.state.message = '按需激活（等待触发）';
        session.state.commands = [...manifest.commands];
        session.state.assistantTools = [...(manifest.assistantTools ?? [])];
        session.state.assistantContextProviders = [...(manifest.assistantContextProviders ?? [])];
        session.start = () => this.activateSession(session, workspace.id, installation, rule);
        continue;
      }
      this.activateSession(session, workspace.id, installation, rule);
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
    if (message.type === 'ready') { clearTimeout(session.timer); session.state.status = 'running'; session.state.message = ''; this.settleWaiters(session); this.log(session, 'info', `已启动 ${session.manifest.version}`); return; }
    if (message.type === 'failed') { fail(String(message.error)); return; }
    if (message.type === 'log') { this.log(session, message.level === 'warn' ? 'warn' : message.level === 'info' ? 'info' : 'error', message.message ?? message.error); return; }
    if (message.type === 'invoked') {
      const pending = session.pending.get(Number(message.id));
      if (pending) { clearTimeout(pending.timer); session.pending.delete(Number(message.id)); if (message.error) { this.log(session, 'error', message.error); pending.reject(new Error(String(message.error))); } else pending.resolve(message.result); }
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
      if (!session.controller.signal.aborted) {
        const classified = classifyPluginError(error);
        this.log(session, 'error', `${message.method}: ${classified.message}`);
        session.sandbox?.send({ type: 'result', id, error: classified.message, code: classified.code, retryable: classified.retryable });
      }
    }).finally(() => { session.inFlight--; });
  }
  private async dispatch(session: Session, workspaceId: string, settings: Record<string, unknown>, method: string, params: Record<string, unknown>) {
    this.assert(session);
    const permission = permissions[method];
    if (permission && !session.manifest.permissions.includes(permission)) throw new Error(`插件没有 ${permission} 权限`);
    if (session.scope === 'user' && session.personalCodePolicy === 'read-only' && permission && writePermissions.has(permission))
      throw new Error('此工作区管理员策略仅允许个人代码插件只读访问');
    // Workspace rules can be reactive Vue state. MessagePort requires plain data,
    // and plugins must receive a detached settings snapshot rather than host state.
    if (method === 'context') {
      return {
        workspaceId,
        pluginId: session.manifest.id,
        settings: resolvePluginSettingsWithDefaults(settings, session.manifest.settingsSchema),
      };
    }
    if (method === 'hostInfo') {
      const env = this.hostEnvironment();
      return {
        coreVersion: env.coreVersion,
        apiVersion: TANO_PLUGIN_API_VERSION,
        platform: env.platform,
        capabilities: this.hostCapabilities(),
      };
    }
    if (method === 'commands.register') {
      const command = session.manifest.commands.find(item => item.id === params.id);
      if (!command) throw new Error('命令没有在清单中声明');
      if (!session.state.commands.some(item => item.id === command.id)) session.state.commands.push(command);
      this.publish(); return null;
    }
    if (method === 'assistant.registerTool') {
      const tool = session.manifest.assistantTools?.find(item => item.name === params.name);
      if (!tool) throw new Error('助手工具没有在清单中声明');
      const list = session.state.assistantTools ?? [];
      if (!list.some(item => item.name === tool.name)) session.state.assistantTools = [...list, tool];
      this.publish(); return null;
    }
    if (method === 'assistant.registerContextProvider') {
      const provider = session.manifest.assistantContextProviders?.find(item => item.id === params.id);
      if (!provider) throw new Error('助手上下文提供者没有在清单中声明');
      const list = session.state.assistantContextProviders ?? [];
      if (!list.some(item => item.id === provider.id)) session.state.assistantContextProviders = [...list, provider];
      this.publish(); return null;
    }
    if (method === 'services.register') {
      const serviceDef = session.manifest.services?.find(item => item.name === params.name);
      if (!serviceDef) throw new Error('插件服务没有在清单中声明');
      session.registeredServices.add(serviceDef.name);
      return null;
    }
    if (method === 'services.available') {
      const targetId = String(params.pluginId ?? '');
      const serviceName = String(params.service ?? '');
      const declaredDep = session.manifest.usesServices?.some(
        dep => dep.pluginId === targetId && dep.service === serviceName,
      );
      if (!declaredDep) throw new Error('目标插件服务未在清单 usesServices 中声明');
      const target = this.sessions.get(targetId);
      if (!target || (target.state.status !== 'running' && target.state.status !== 'idle')) return false;
      return !!target.manifest.services?.some(item => item.name === serviceName);
    }
    if (method === 'services.call') {
      const targetId = String(params.pluginId ?? '');
      const serviceName = String(params.service ?? '');
      const declaredDep = session.manifest.usesServices?.some(
        dep => dep.pluginId === targetId && dep.service === serviceName,
      );
      if (!declaredDep) throw new Error('目标插件服务未在清单 usesServices 中声明');
      if (targetId === session.manifest.id) throw new Error('不能通过跨插件服务总线递归调用自身');
      if (session.serviceCallDepth >= 4) throw new Error('跨插件服务调用深度超过限制（可能存在循环依赖）');
      let target = this.sessions.get(targetId);
      if (!target || target.state.status === 'blocked' || target.state.status === 'error') {
        throw new Error(`服务提供方插件 ${targetId} 未启用或未授权`);
      }
      const serviceDef = target.manifest.services?.find(item => item.name === serviceName);
      if (!serviceDef) throw new Error(`插件 ${targetId} 未声明服务 ${serviceName}`);
      const payload = parsePluginJson(params.payload ?? null, 64 * 1024);
      if (serviceDef.parameters) {
        validateAgainstPluginJsonSchema(payload, serviceDef.parameters);
      }
      if (target.state.status === 'idle' || target.state.status === 'loading') {
        await this.ensureActivated(targetId);
        this.assert(session);
        target = this.sessions.get(targetId);
        if (!target || target.state.status !== 'running') {
          throw new Error(`服务提供方插件 ${targetId} 激活失败`);
        }
      }
      if (target.pending.size >= 32) throw new Error('目标插件服务请求过多，请稍后重试');
      const id = ++target.invocation;
      target.serviceCallDepth = Math.max(target.serviceCallDepth, session.serviceCallDepth + 1);
      try {
        const raw = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            target!.pending.delete(id);
            reject(new Error(`跨插件服务 ${targetId}.${serviceName} 调用超时`));
          }, 15000);
          target!.pending.set(id, { resolve, reject, timer });
          target!.sandbox?.send({
            type: 'invoke',
            id,
            kind: 'service',
            name: serviceName,
            payload: { args: payload, callerPluginId: session.manifest.id },
          });
        });
        this.assert(session);
        const result = parsePluginJson(raw ?? null, 64 * 1024);
        if (serviceDef.returns) {
          validateAgainstPluginJsonSchema(result, serviceDef.returns);
        }
        return result;
      } finally {
        target.serviceCallDepth = Math.max(0, target.serviceCallDepth - 1);
      }
    }
    if (method === 'views.render') {
      const definition = session.manifest.views.find(item => item.id === params.id);
      if (!definition) throw new Error('视图没有在清单中声明');
      const tree = parsePluginView(params.tree);
      const previous = session.state.views.find(view => view.id === definition.id);
      session.state.views = [...session.state.views.filter(view => view.id !== definition.id), { ...definition, header: previous?.header, tree }]; this.publish(); return null;
    }
    if (method === 'views.setHeader') {
      const definition = session.manifest.views.find(item => item.id === params.id);
      if (!definition) throw new Error('视图没有在清单中声明');
      const header = parseViewHeader(parsePluginJson(params.header, 8192));
      const previous = session.state.views.find(view => view.id === definition.id);
      session.state.views = [...session.state.views.filter(view => view.id !== definition.id), { ...previous, ...definition, header }];
      this.publish(); return null;
    }
    if (method === 'views.renderCustom') {
      const definition = session.manifest.views.find(item => item.id === params.id);
      const bundle = definition && session.ui && Object.hasOwn(session.ui, definition.id) ? session.ui[definition.id] : undefined;
      if (!definition || !bundle) throw new Error('插件包没有提供此视图的界面');
      const state = parsePluginJson(params.state);
      const previous = session.state.views.find(view => view.id === definition.id);
      session.state.views = [...session.state.views.filter(view => view.id !== definition.id), { ...previous, ...definition, custom: { bundle, state } }];
      this.publish(); return null;
    }
    if (method === 'views.open') {
      const definition = session.manifest.views.find(item => item.id === params.id);
      if (!definition) throw new Error('视图没有在清单中声明');
      return this.access.call('views.open', { pluginId: session.manifest.id, viewId: definition.id }, () => this.assert(session));
    }
    if (method === 'ui.setStatusBar') {
      const item = parsePluginStatusBarItem(params.item);
      if (item.command && !session.manifest.commands.some(cmd => cmd.id === item.command))
        throw new Error('状态栏绑定的命令没有在清单中声明');
      const existing = session.state.statusBar ?? [];
      const next = [...existing.filter(row => row.id !== item.id), item];
      if (next.length > 4) throw new Error('单个插件最多只能注册 4 个状态栏项');
      session.state.statusBar = next;
      this.publish();
      return null;
    }
    if (method === 'ui.removeStatusBar') {
      if (!pluginKey(params.id)) throw new Error('插件状态栏项 ID 无效');
      session.state.statusBar = (session.state.statusBar ?? []).filter(row => row.id !== params.id);
      this.publish();
      return null;
    }
    if (method === 'ui.toast') {
      const toast = parsePluginUiToastOptions(params);
      session.state.message = toast.message;
      this.publish();
      await this.access.call(
        'ui.toast',
        { pluginId: session.manifest.id, pluginName: session.manifest.name, message: toast.message, tone: toast.tone },
        () => this.assert(session),
      ).catch(() => {});
      return null;
    }
    if (method === 'ui.pick' || method === 'ui.prompt' || method === 'ui.confirm') {
      const parsedOptions =
        method === 'ui.pick'
          ? parsePluginUiPickOptions(params.options)
          : method === 'ui.prompt'
            ? parsePluginUiPromptOptions(params.options)
            : parsePluginUiConfirmOptions(params.options);
      if (session.activeDialog) throw new Error('已有进行中的交互弹窗，请等待用户完成');
      session.activeDialog = true;
      try {
        const answer = await this.access.call(
          method,
          {
            pluginId: session.manifest.id,
            pluginName: session.manifest.name,
            instanceId: session.state.instanceId,
            options: parsedOptions,
            signal: session.controller.signal,
          },
          () => this.assert(session),
        );
        this.assert(session);
        if (method === 'ui.confirm') return Boolean(answer);
        return typeof answer === 'string' ? answer : null;
      } finally {
        session.activeDialog = false;
      }
    }
    if (method === 'assets.list') {
      const cache = new PluginPackageCache(this.storage);
      return cache.listBinaryAssets(session.integrity);
    }
    if (method === 'assets.read') {
      if (typeof params.path !== 'string' || !params.path.trim()) {
        throw new Error('插件资产路径无效');
      }
      const cache = new PluginPackageCache(this.storage);
      const asset = await cache.getBinaryAsset(session.integrity, params.path);
      if (!asset) throw new Error(`插件包中不存在资产：${params.path}`);
      return asset;
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
    if (method === 'ai.complete' || method === 'ai.structured') {
      const structured = method === 'ai.structured';
      const request = structured
        ? parsePluginAiRequest(params.request, true)
        : parsePluginAiRequest(params.request, false);
      if (session.activeAiCall) throw new Error('插件已有进行中的 AI 推理请求，请等待完成');
      session.activeAiCall = true;
      try {
        const result = await this.access.call(
          method,
          {
            pluginId: session.manifest.id,
            pluginName: session.manifest.name,
            request,
            signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(60_000)]),
          },
          () => this.assert(session),
        );
        this.assert(session);
        return parsePluginJson(result, 256 * 1024);
      } finally {
        session.activeAiCall = false;
      }
    }
    if (method === 'editor.setDecorations') {
      if (!pluginText(params.fileId, 80)) throw new Error('目标文档 ID 无效');
      const items = parsePluginEditorDecorations(params.decorations);
      for (const item of items) {
        if (item.command && !session.manifest.commands.some(cmd => cmd.id === item.command))
          throw new Error('插件装饰绑定的命令没有在清单中声明');
      }
      const next = { ...(session.state.decorations ?? {}) };
      if (!items.length) delete next[params.fileId];
      else {
        next[params.fileId] = items;
        if (Object.keys(next).length > 20) throw new Error('单个插件最多同时装饰 20 篇文档');
      }
      session.state.decorations = Object.keys(next).length ? next : undefined;
      this.publish();
      return null;
    }
    if (method === 'editor.clearDecorations') {
      if (params.fileId !== undefined) {
        if (!pluginText(params.fileId, 80)) throw new Error('目标文档 ID 无效');
        if (session.state.decorations) {
          const next = { ...session.state.decorations };
          delete next[params.fileId];
          session.state.decorations = Object.keys(next).length ? next : undefined;
        }
      } else {
        session.state.decorations = undefined;
      }
      this.publish();
      return null;
    }
    if (method === 'editor.insert' || method === 'editor.replaceSelection') {
      if (typeof params.text !== 'string' || params.text.length > 200 * 1024)
        throw new Error('编辑器插入文本无效或超过 200 KB 限制');
      params = { text: params.text };
    }
    const frontmatterRead = method === 'documents.frontmatter.read';
    let frontmatterWriteData: Record<string, unknown> | undefined;
    if (frontmatterRead) {
      method = 'documents.read';
    }
    if (
      method === 'documents.write' ||
      method === 'documents.edit' ||
      method === 'documents.frontmatter.update' ||
      method === 'documents.move' ||
      method === 'documents.trash' ||
      method === 'objects.update'
    ) {
      const key = `${method.startsWith('documents') ? 'document' : 'object'}:${String(params.fileId ?? (pluginRecord(params.object) ? params.object.id : ''))}:${String(params.baseHash)}`;
      const base = session.reads.get(key);
      if (!base) throw new Error('请先读取目标内容，再使用返回的版本摘要修改');
      params = { ...params, base };
      if (method === 'documents.edit') {
        if (!pluginRecord(base) || typeof base.content !== 'string') throw new Error('编辑基线无效');
        params = { ...params, content: applyPluginTextEdits(base.content, params.edits) };
        method = 'documents.write';
      } else if (method === 'documents.frontmatter.update') {
        if (!pluginRecord(base) || typeof base.content !== 'string') throw new Error('编辑基线无效');
        const patch = parsePluginFrontmatterPatch(params.patch);
        const patchedContent = patchFrontmatterMarkdown(base.content, patch);
        frontmatterWriteData = readFrontmatterData(patchedContent).data;
        params = { ...params, content: patchedContent };
        method = 'documents.write';
      }
    }
    if (method.endsWith('.query') || method === 'documents.search' || method === 'attachments.read') params = { ...params, queryScope: session.state.instanceId };
    if (
      session.pathScopes?.length &&
      (method.startsWith('documents.') || method.startsWith('editor.') || method.startsWith('attachments.'))
    ) {
      params = { ...params, pathScopes: session.pathScopes };
    }
    const result = await this.access.call(method, params, () => this.assert(session));
    this.assert(session);
    const remember = (kind: string, value: unknown) => {
      if (!pluginRecord(value) || typeof value.hash !== 'string') return;
      session.reads.set(`${kind}:${String(value.id)}:${value.hash}`, value);
      if (session.reads.size > 32) session.reads.delete(session.reads.keys().next().value!);
    };
    if (method === 'documents.read') {
      remember('document', result);
      if (frontmatterRead && pluginRecord(result) && typeof result.content === 'string') {
        const parsed = readFrontmatterData(result.content);
        return {
          id: result.id,
          hasFrontmatter: parsed.hasFrontmatter,
          data: parsed.data,
          hash: result.hash,
        };
      }
    }
    if (frontmatterWriteData !== undefined && pluginRecord(result)) {
      return { ...result, data: frontmatterWriteData };
    }
    if (method === 'objects.read') remember('object', result);
    if (method === 'objects.list' && Array.isArray(result)) result.forEach(value => remember('object', value));
    if (method === 'objects.query' && pluginRecord(result) && Array.isArray(result.items)) result.items.forEach(value => remember('object', value));
    return result;
  }
  async invoke(pluginId: string, kind: 'command' | 'action' | 'message' | 'diagnostic', name: string, payload?: unknown, instanceId?: string) {
    let session = this.sessions.get(pluginId);
    if (!session) throw new Error('插件尚未运行');
    if (instanceId && session.state.instanceId !== instanceId) throw new Error('插件运行版本已变化，请重新打开界面');
    if ((session.state.status === 'idle' || session.state.status === 'loading') && kind !== 'diagnostic') {
      await this.ensureActivated(pluginId);
      session = this.sessions.get(pluginId);
      if (!session || (instanceId && session.state.instanceId !== instanceId)) throw new Error('插件运行版本已变化，请重新打开界面');
    }
    if (session.state.status !== 'running') throw new Error('插件尚未运行');
    if (session.pending.size >= 32) throw new Error('插件操作过多，请稍后重试');
    const hasUiTarget =
      session.state.views.some(view => view.id === name && view.custom) ||
      (!!session.ui && Object.hasOwn(session.ui, name) && !!session.manifest.codeBlockRenderers?.some(r => r.view === name));
    if (kind === 'diagnostic') {
      if (!hasUiTarget || !pluginRecord(payload) || typeof payload.message !== 'string') throw new Error('插件界面日志无效');
      if (Date.now() - session.windowStart > 1000) { session.windowStart = Date.now(); session.calls = 0; }
      if (++session.calls > 200) throw new Error('插件日志超过速率限制');
      this.log(session, payload.level === 'warn' ? 'warn' : payload.level === 'error' ? 'error' : 'info', `[界面 ${name}] ${payload.message.slice(0, 1400)}`);
      return;
    }
    if (kind === 'message') {
      if (!hasUiTarget) throw new Error('插件界面已关闭');
      payload = parsePluginJson(payload, 16 * 1024);
    }
    this.assert(session);
    const id = ++session.invocation;
    const deadline = Date.now() + 300000;
    return new Promise<void>((resolve, reject) => {
      const arm = () =>
        setTimeout(() => {
          if (session!.activeDialog && Date.now() < deadline && !session!.controller.signal.aborted) {
            const entry = session!.pending.get(id);
            if (entry) entry.timer = arm();
            return;
          }
          this.stop(session!, false); session!.state.status = 'error'; session!.state.message = '插件操作超时，已停止运行'; this.log(session!, 'error', session!.state.message); reject(new Error(session!.state.message));
        }, 30000);
      const timer = arm();
      session!.pending.set(id, { resolve: () => resolve(), reject, timer }); session!.sandbox?.send({ type: 'invoke', id, kind, name, payload });
    });
  }
  async invokeAssistantTool(
    pluginId: string,
    toolName: string,
    args: Record<string, unknown>,
    context: { workspaceId: string; activeFileId?: string },
  ): Promise<PluginJson> {
    let session = this.sessions.get(pluginId);
    if (!session) throw new Error('插件尚未运行');
    const definition = session.manifest.assistantTools?.find(item => item.name === toolName);
    if (!definition) throw new Error('助手工具没有在插件清单中声明');
    if (session.scope === 'user' && session.personalCodePolicy === 'block')
      throw new Error('此工作区管理员策略禁止个人代码插件运行');
    if (session.scope === 'user' && session.personalCodePolicy === 'read-only' && definition.effect === 'write')
      throw new Error('此工作区管理员策略仅允许个人代码插件只读访问');
    validateAgainstPluginJsonSchema(args, definition.parameters);
    if (session.state.status === 'idle' || session.state.status === 'loading') {
      await this.ensureActivated(pluginId);
      session = this.sessions.get(pluginId);
      if (!session) throw new Error('插件运行实例已失效');
    }
    if (session.state.status !== 'running') throw new Error(session.state.message || '插件尚未运行');
    if (session.pending.size >= 32) throw new Error('插件操作过多，请稍后重试');
    this.assert(session);
    const id = ++session.invocation;
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        session!.pending.delete(id);
        reject(new Error('插件助手工具执行超时'));
      }, 30000);
      session!.pending.set(id, { resolve, reject, timer });
      session!.sandbox?.send({ type: 'invoke', id, kind: 'assistant-tool', name: toolName, payload: { args, context } });
    });
    return parsePluginJson(raw ?? null, 32 * 1024);
  }
  async queryAssistantContext(
    pluginId: string,
    providerId: string,
    query: string,
    context: { workspaceId: string; activeFileId?: string },
  ): Promise<{ title: string; content: string; metadata?: PluginJson }> {
    let session = this.sessions.get(pluginId);
    if (!session) throw new Error('插件尚未运行');
    const definition = session.manifest.assistantContextProviders?.find(item => item.id === providerId);
    if (!definition) throw new Error('助手上下文提供者没有在插件清单中声明');
    if (session.scope === 'user' && session.personalCodePolicy === 'block')
      throw new Error('此工作区管理员策略禁止个人代码插件运行');
    if (session.state.status === 'idle' || session.state.status === 'loading') {
      await this.ensureActivated(pluginId);
      session = this.sessions.get(pluginId);
      if (!session) throw new Error('插件运行实例已失效');
    }
    if (session.state.status !== 'running') throw new Error(session.state.message || '插件尚未运行');
    if (session.pending.size >= 32) throw new Error('插件操作过多，请稍后重试');
    this.assert(session);
    const id = ++session.invocation;
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        session!.pending.delete(id);
        reject(new Error('插件上下文读取超时'));
      }, 10000);
      session!.pending.set(id, { resolve, reject, timer });
      session!.sandbox?.send({
        type: 'invoke',
        id,
        kind: 'assistant-context',
        name: providerId,
        payload: { query: query.slice(0, 500), context },
      });
    });
    const maxBytes = Math.min(definition.maxBytes ?? pluginAssistantContextMaxBytes, pluginAssistantContextMaxBytes);
    let title = definition.label;
    let content = '';
    let metadata: PluginJson | undefined;
    if (typeof raw === 'string') {
      content = raw;
    } else if (pluginRecord(raw) && typeof raw.content === 'string') {
      if (typeof raw.title === 'string' && raw.title.trim()) title = raw.title.trim().slice(0, 80);
      content = raw.content;
      if (raw.metadata !== undefined) metadata = parsePluginJson(raw.metadata, 4096);
    } else {
      throw new Error('插件上下文返回值无效');
    }
    const encoded = new TextEncoder().encode(content);
    if (encoded.length > maxBytes) {
      content = new TextDecoder('utf-8', { fatal: false }).decode(encoded.subarray(0, maxBytes)) + '\n...[已按上下文上限截断]';
    }
    return { title, content, ...(metadata !== undefined ? { metadata } : {}) };
  }
  notify(event: PluginEvent) {
    const permission = event.type === 'documents.changed' ? 'documents.read' : event.type === 'objects.changed' ? 'objects.read' : event.type === 'relations.changed' ? 'relations.read' : undefined;
    for (const session of this.sessions.values()) if (session.state.status === 'running' && (!permission || session.manifest.permissions.includes(permission))) session.sandbox?.send({ type: 'event', event });
  }
}
