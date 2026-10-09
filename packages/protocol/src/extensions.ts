import { parseObjectPlugin, type ObjectPluginManifest } from './plugins';

export const workspacePluginPath = '.tano/plugins.tano.json';
export const pluginPackageLimit = 4 * 1024 * 1024;
export const pluginStorageLimit = 256 * 1024;
export const pluginCacheLimit = 64 * 1024 * 1024;
export interface PluginPackageUsage {
  used: number;
  limit: number;
  entryLimit: number;
  entries: { integrity: string; pluginId: string; version: string; bytes: number;
    state: 'pending' | 'ready' | 'deleting'; pinned: boolean; createdAt: string; removable?: boolean }[];
}
export const pluginPermissions = ['documents.read', 'documents.write', 'objects.read', 'objects.write',
  'relations.read', 'relations.write', 'storage', 'network', 'connections', 'native', 'ui'] as const;
export type PluginPermission = typeof pluginPermissions[number];
export type PluginMode = 'required' | 'recommended' | 'optional' | 'disabled';
export type PluginMenuLocation = 'workspace' | 'document' | 'file';
export interface PluginCommandDefinition { id: string; label: string; shortcut?: string; menus?: PluginMenuLocation[] }
export interface PluginViewDefinition { id: string; label: string; location?: 'panel' | 'tab' | 'sidebar' | 'settings' }
export interface PluginAutomationDefinition { id: string; label: string }
export interface ExecutablePluginManifest extends Omit<ObjectPluginManifest, 'manifestVersion'> {
  manifestVersion: 2;
  apiVersion: 1;
  permissions: PluginPermission[];
  networkOrigins: string[];
  nativeCommands: string[];
  commands: PluginCommandDefinition[];
  views: PluginViewDefinition[];
  /** Server entry points require separate workspace authorization; installation never schedules them. */
  automations?: PluginAutomationDefinition[];
}
export type PluginManifest = ObjectPluginManifest | ExecutablePluginManifest;
export type PluginJson = null | boolean | number | string | PluginJson[] | { [key: string]: PluginJson };
export interface PluginUiBundle { html: string; css: string; source: string }
export interface PluginPackage { packageVersion: 1; manifest: PluginManifest; source?: string; ui?: Record<string, PluginUiBundle>; automationSource?: string }
export interface WorkspacePluginRule {
  manifest: PluginManifest;
  mode: PluginMode;
  /** SHA-256 of the canonical package. Executable code is stored outside the workspace. */
  integrity?: string;
  sourceUrl?: string;
  settings: Record<string, unknown>;
  history?: PluginVersionReference[];
}
export interface PluginVersionReference { manifest: PluginManifest; integrity?: string; sourceUrl?: string; recordedAt: string }
export interface WorkspacePluginPolicy { version: 1; plugins: WorkspacePluginRule[] }

export function pluginRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: unknown, allowed: string[]) {
  if (!pluginRecord(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error('插件数据包含不支持的字段');
}
export function pluginText(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}
export function pluginKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9.-]{0,79}$/.test(value);
}
export function canonicalPluginJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPluginJson).join(',')}]`;
  if (pluginRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalPluginJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function parsePluginSettings(value: unknown): Record<string, unknown> {
  if (!pluginRecord(value)) throw new Error('插件设置必须是 JSON 对象');
  const serialized = JSON.stringify(value);
  if (serialized.length > 32 * 1024) throw new Error('插件设置不能超过 32 KB');
  return JSON.parse(serialized);
}
export function parsePluginManifest(value: unknown): PluginManifest {
  if (!pluginRecord(value)) throw new Error('插件清单无效');
  if (value.manifestVersion === 1) return parseObjectPlugin(JSON.stringify(value));
  keys(value, ['manifestVersion', 'apiVersion', 'id', 'name', 'version', 'description', 'objectTypes',
    'relationTypes', 'permissions', 'networkOrigins', 'nativeCommands', 'commands', 'views', 'automations']);
  if (value.manifestVersion !== 2 || value.apiVersion !== 1) throw new Error('不支持此插件 API 版本');
  const base = parseObjectPlugin(JSON.stringify({ manifestVersion: 1, id: value.id, name: value.name,
    version: value.version, description: value.description, objectTypes: value.objectTypes ?? [], relationTypes: value.relationTypes ?? [] }));
  const uniqueStrings = (input: unknown, check: (item: unknown) => boolean, limit = 50): string[] => {
    if (!Array.isArray(input) || input.length > limit || input.some(item => !check(item)) || new Set(input).size !== input.length)
      throw new Error('插件权限或扩展入口无效');
    return input as string[];
  };
  const permissions = uniqueStrings(value.permissions, item => pluginPermissions.includes(item as PluginPermission)) as PluginPermission[];
  const networkOrigins = uniqueStrings(value.networkOrigins ?? [], item => {
    if (!pluginText(item, 250)) return false;
    try { const url = new URL(item); return url.protocol === 'https:' && url.origin === item && !url.username && !url.password; } catch { return false; }
  });
  const nativeCommands = uniqueStrings(value.nativeCommands ?? [], pluginKey);
  if ((networkOrigins.length && !permissions.includes('network') && !permissions.includes('connections')) || (nativeCommands.length && !permissions.includes('native')))
    throw new Error('网络或本机能力必须声明权限');
  const contributions = (input: unknown, limit: number, kind: 'command' | 'view') => {
    if (!Array.isArray(input) || input.length > limit) throw new Error('插件入口数量无效');
    const ids = new Set<string>();
    return input.map(item => {
      keys(item, kind === 'command' ? ['id', 'label', 'shortcut', 'menus'] : ['id', 'label', 'location']);
      if (!pluginKey(item.id) || !pluginText(item.label, 80) || ids.has(item.id)) throw new Error('插件入口重复或无效');
      ids.add(item.id);
      const entry: PluginCommandDefinition & PluginViewDefinition = { id: item.id, label: item.label };
      if (kind === 'command' && item.shortcut !== undefined) {
        if (typeof item.shortcut !== 'string' || !/^(?:(?:Mod|Alt|Shift)\+){0,3}(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/.test(item.shortcut) ||
          (!item.shortcut.includes('Mod+') && !item.shortcut.includes('Alt+') && !/^F\d+$/.test(item.shortcut)) || item.shortcut.includes('Mod+Alt+')) throw new Error('插件快捷键无效');
        const modifiers = item.shortcut.split('+').slice(0, -1);
        if (new Set(modifiers).size !== modifiers.length || modifiers.join('+') !== ['Mod', 'Alt', 'Shift'].filter(key => modifiers.includes(key)).join('+')) throw new Error('插件快捷键修饰符顺序无效');
        entry.shortcut = item.shortcut;
      }
      if (kind === 'command' && item.menus !== undefined) entry.menus = uniqueStrings(item.menus, location => typeof location === 'string' && ['workspace', 'document', 'file'].includes(location), 3) as PluginMenuLocation[];
      if (kind === 'view' && item.location !== undefined) {
        if (typeof item.location !== 'string' || !['panel', 'tab', 'sidebar', 'settings'].includes(item.location)) throw new Error('插件视图位置无效');
        entry.location = item.location;
      }
      return entry;
    });
  };
  let automations: PluginAutomationDefinition[] | undefined;
  if (value.automations !== undefined) {
    if (!Array.isArray(value.automations) || !value.automations.length || value.automations.length > 10) throw new Error('插件自动化入口数量无效');
    const ids = new Set<string>();
    automations = value.automations.map(item => {
      keys(item, ['id', 'label']);
      if (!pluginKey(item.id) || !pluginText(item.label, 80) || ids.has(item.id)) throw new Error('插件自动化入口重复或无效');
      ids.add(item.id); return { id: item.id, label: item.label };
    });
  }
  return { ...base, manifestVersion: 2, apiVersion: 1, permissions, networkOrigins, nativeCommands,
    commands: contributions(value.commands ?? [], 50, 'command'), views: contributions(value.views ?? [], 10, 'view'),
    ...(automations ? { automations } : {}) };
}
export function parsePluginPackage(content: string): PluginPackage {
  if (new TextEncoder().encode(content).length > pluginPackageLimit) throw new Error('插件包不能超过 4 MiB');
  const value = JSON.parse(content);
  if (value?.manifestVersion === 1) return { packageVersion: 1, manifest: parsePluginManifest(value) };
  keys(value, ['packageVersion', 'manifest', 'source', 'ui', 'automationSource']);
  if (value.packageVersion !== 1) throw new Error('不支持此插件包版本');
  const manifest = parsePluginManifest(value.manifest);
  if (manifest.manifestVersion === 2) {
    if (typeof value.source !== 'string' || !value.source.trim()) throw new Error('代码插件缺少入口脚本');
    const ui: Record<string, PluginUiBundle> = {};
    if (value.ui !== undefined) {
      if (!manifest.permissions.includes('ui')) throw new Error('自定义界面必须声明 ui 权限');
      if (!pluginRecord(value.ui) || Object.keys(value.ui).length > 10) throw new Error('插件界面包无效');
      for (const [id, bundle] of Object.entries(value.ui)) {
        if (!pluginKey(id) || !manifest.views.some(view => view.id === id)) throw new Error('插件界面必须在清单中声明视图');
        if (!pluginRecord(bundle)) throw new Error('插件界面包无效');
        keys(bundle, ['html', 'css', 'source']);
        if (typeof bundle.html !== 'string' || typeof bundle.css !== 'string' || typeof bundle.source !== 'string' || !bundle.source.trim()) throw new Error('插件界面必须包含 HTML、CSS 和脚本');
        ui[id] = { html: bundle.html, css: bundle.css, source: bundle.source };
      }
    }
    if (manifest.automations?.length) {
      if (typeof value.automationSource !== 'string' || !value.automationSource.trim()) throw new Error('自动化插件缺少服务端入口脚本');
    } else if (value.automationSource !== undefined) throw new Error('服务端脚本必须声明自动化入口');
    return { packageVersion: 1, manifest, source: value.source, ...(value.ui === undefined ? {} : { ui }),
      ...(value.automationSource === undefined ? {} : { automationSource: value.automationSource }) };
  }
  if (value.source !== undefined || value.ui !== undefined || value.automationSource !== undefined) throw new Error('声明式插件不能携带脚本');
  return { packageVersion: 1, manifest };
}

/** Validate at both the worker and custom-view boundaries, including non-JSON structured-clone values. */
export function parsePluginJson(value: unknown, limit = 128 * 1024): PluginJson {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 24) throw new Error('插件消息过大或嵌套过深');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return;
    if (Array.isArray(item)) { item.forEach(child => visit(child, depth + 1)); return; }
    if (pluginRecord(item) && Object.getPrototypeOf(item) === Object.prototype) { Object.values(item).forEach(child => visit(child, depth + 1)); return; }
    throw new Error('插件消息必须为 JSON 数据');
  };
  visit(value, 0);
  const content = JSON.stringify(value);
  if (new TextEncoder().encode(content).length > limit) throw new Error('插件消息超过大小限制');
  return JSON.parse(content);
}
export function parsePluginPolicy(content: string): WorkspacePluginPolicy {
  if (content.length > 1024 * 1024) throw new Error('工作区插件规则不能超过 1 MB');
  const value = JSON.parse(content);
  keys(value, ['version', 'plugins']);
  if (value.version !== 1 || !Array.isArray(value.plugins) || value.plugins.length > 100) throw new Error('工作区插件规则无效');
  const ids = new Set<string>();
  const plugins = value.plugins.map((item: unknown): WorkspacePluginRule => {
    keys(item, ['manifest', 'mode', 'integrity', 'sourceUrl', 'settings', 'history']);
    const row = item as Record<string, unknown>;
    const manifest = parsePluginManifest(row.manifest);
    if (ids.has(manifest.id) || !['required', 'recommended', 'optional', 'disabled'].includes(String(row.mode))) throw new Error('插件规则重复或模式无效');
    ids.add(manifest.id);
    if (row.integrity !== undefined && (typeof row.integrity !== 'string' || !/^[a-f0-9]{64}$/.test(row.integrity))) throw new Error('插件内容摘要无效');
    if (manifest.manifestVersion === 2 && !row.integrity) throw new Error('代码插件必须锁定内容摘要');
    if (row.sourceUrl !== undefined) {
      if (!pluginText(row.sourceUrl, 2048)) throw new Error('插件下载地址无效');
      const url = new URL(row.sourceUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('插件下载地址必须为 HTTPS');
    }
    let history: PluginVersionReference[] | undefined;
    if (row.history !== undefined) {
      if (!Array.isArray(row.history) || row.history.length > 10) throw new Error('插件最多保留 10 个历史版本');
      history = row.history.map(value => {
        keys(value, ['manifest', 'integrity', 'sourceUrl', 'recordedAt']);
        if (!pluginRecord(value) || !pluginText(value.recordedAt, 40) || !Number.isFinite(Date.parse(value.recordedAt))) throw new Error('插件历史日期无效');
        const previous = parsePluginPolicy(JSON.stringify({ version: 1, plugins: [{ manifest: value.manifest, integrity: value.integrity, sourceUrl: value.sourceUrl, mode: 'optional', settings: {} }] })).plugins[0]!;
        if (previous.manifest.id !== manifest.id) throw new Error('插件历史身份不一致');
        return { manifest: previous.manifest, ...(previous.integrity ? { integrity: previous.integrity } : {}), ...(previous.sourceUrl ? { sourceUrl: previous.sourceUrl } : {}), recordedAt: value.recordedAt };
      });
    }
    return { manifest, mode: row.mode as PluginMode, settings: parsePluginSettings(row.settings ?? {}), ...(history ? { history } : {}),
      ...(row.integrity ? { integrity: row.integrity as string } : {}), ...(row.sourceUrl ? { sourceUrl: row.sourceUrl as string } : {}) };
  });
  return { version: 1, plugins };
}

/** Bounded host-rendered UI: plugin strings never become HTML, CSS or event handlers. */
export type PluginViewNode = { type: 'text' | 'heading' | 'code'; text: string }
  | { type: 'button'; label: string; action: string }
  | { type: 'input'; label: string; key: string; value: string }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'stack'; children: PluginViewNode[] };
export function parsePluginView(value: unknown): PluginViewNode {
  let count = 0;
  const visit = (node: unknown, depth: number): PluginViewNode => {
    if (++count > 300 || depth > 8 || !pluginRecord(node)) throw new Error('插件视图过大或无效');
    if (node.type === 'stack') {
      if (!Array.isArray(node.children)) throw new Error('插件视图节点无效');
      return { type: 'stack', children: node.children.map(child => visit(child, depth + 1)) };
    }
    if (node.type === 'table') {
      if (!Array.isArray(node.columns) || node.columns.length > 20 || !Array.isArray(node.rows) || node.rows.length > 500 ||
        node.columns.some(cell => !pluginText(cell, 200)) || node.rows.some(row => !Array.isArray(row) || row.length !== (node.columns as unknown[]).length || row.some(cell => typeof cell !== 'string' || cell.length > 4000))) throw new Error('插件表格无效');
      return { type: 'table', columns: node.columns as string[], rows: node.rows as string[][] };
    }
    if (node.type === 'button' && pluginText(node.label, 80) && pluginKey(node.action)) return { type: 'button', label: node.label, action: node.action };
    if (node.type === 'input' && pluginText(node.label, 80) && pluginKey(node.key) && typeof node.value === 'string' && node.value.length <= 4000) return { type: 'input', label: node.label, key: node.key, value: node.value };
    if (['text', 'heading', 'code'].includes(String(node.type)) && typeof node.text === 'string' && node.text.length <= 32000) return { type: node.type as 'text', text: node.text };
    throw new Error('插件视图节点无效');
  };
  if (JSON.stringify(value).length > 256 * 1024) throw new Error('插件视图过大');
  return visit(value, 0);
}
