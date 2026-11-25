import { parseFileIconTheme, type FileIconTheme, type FileIconThemeRef } from './appearance';
import { parseObjectPlugin, type ObjectPluginManifest } from './plugins';

export const workspacePluginPath = '.tano/plugins.tano.json';
export const pluginPackageLimit = 4 * 1024 * 1024;
export const pluginStorageLimit = 256 * 1024;
export const pluginCacheLimit = 64 * 1024 * 1024;
/** Target limit for modern portable policies without inline raster PNGs. */
export const workspacePluginPolicyLimit = 1 * 1024 * 1024;
/** Backward-compatible read limit for legacy policies containing pre-migration inline PNG icons. */
export const legacyWorkspacePluginPolicyLimit = 16 * 1024 * 1024;
export interface PluginPackageUsage {
  used: number;
  limit: number;
  entryLimit: number;
  entries: { integrity: string; pluginId: string; version: string; bytes: number;
    state: 'pending' | 'ready' | 'deleting'; pinned: boolean; createdAt: string; removable?: boolean }[];
}
export const pluginPermissions = ['attachments.read', 'attachments.write', 'documents.read', 'documents.write', 'documents.move', 'documents.trash', 'objects.read', 'objects.write',
  'relations.read', 'relations.write', 'storage', 'network', 'connections', 'native', 'ui', 'ai.invoke'] as const;
export type PluginPermission = typeof pluginPermissions[number];
export type WorkspacePersonalPluginPolicy = 'allow' | 'read-only' | 'block';
export interface PluginAttachmentWriteRequest {
  name: string;
  contentBase64: string;
  documentPath?: string;
  mimeType?: string;
}
export const pluginAttachmentWriteLimit = 400 * 1024;
export const pluginAttachmentWriteExtensions = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.pdf', '.txt', '.csv', '.json', '.bib', '.mermaid',
  '.docx', '.xlsx', '.pptx', '.mp3', '.wav', '.mp4', '.zip',
] as const;
export type PluginMode = 'required' | 'recommended' | 'optional' | 'disabled';
export type PluginMenuLocation = 'workspace' | 'document' | 'file';
export interface PluginCommandDefinition { id: string; label: string; shortcut?: string; menus?: PluginMenuLocation[] }
export interface PluginSlashCommandDefinition {
  id: string;
  label: string;
  command: string;
  description?: string;
  keywords?: string[];
}
export interface PluginActiveEditorSnapshot {
  fileId: string;
  path: string;
  mode: 'rich' | 'source';
  readOnly: boolean;
  selection: { from: number; to: number; empty: boolean };
  selectedText: string;
  blockType?: string;
  hash: string;
}
export interface PluginFrontmatterPatch {
  set?: Record<string, PluginJson>;
  remove?: string[];
}
export interface PluginCodeBlockRendererDefinition {
  languages: string[];
  view: string;
  label?: string;
  height?: number;
}
export type PluginEditorDecorationTone = 'info' | 'accent' | 'warning' | 'danger' | 'muted';
export interface PluginEditorDecoration {
  id?: string;
  from: number;
  to: number;
  tone?: PluginEditorDecorationTone;
  badge?: string;
  tooltip?: string;
  command?: string;
}
export type PluginViewLayout = 'contained' | 'fill';
export const pluginViewLocations = [
  'panel',
  'tab',
  'sidebar',
  'settings',
  'documentSidebar',
  'documentHeader',
  'documentFooter',
  'homeTab',
  'newTab',
] as const;
export type PluginViewLocation = typeof pluginViewLocations[number];
export interface PluginViewDefinition { id: string; label: string; location?: PluginViewLocation; layout?: PluginViewLayout }
export type PluginStatusBarAlign = 'left' | 'right';
export type PluginStatusBarTone = 'default' | 'accent' | 'warning' | 'danger';
export interface PluginStatusBarItem {
  id: string;
  text: string;
  tooltip?: string;
  align?: PluginStatusBarAlign;
  priority?: number;
  tone?: PluginStatusBarTone;
  command?: string;
}
export type PluginUiTone = 'info' | 'success' | 'warning' | 'error';
export interface PluginUiPickItem {
  id: string;
  label: string;
  description?: string;
  detail?: string;
}
export interface PluginUiPickOptions {
  title: string;
  placeholder?: string;
  items: PluginUiPickItem[];
}
export interface PluginUiPromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
}
export interface PluginUiConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
export interface PluginUiToastOptions {
  message: string;
  tone?: PluginUiTone;
}
export type PluginFileHandlerMode = 'preview' | 'editor';
export interface PluginFileHandlerDefinition { extensions: string[]; mode: PluginFileHandlerMode; view: string; command: string }
export type PluginSettingFieldType = 'string' | 'number' | 'boolean' | 'select';
export interface PluginSettingField {
  key: string;
  label: string;
  description?: string;
  type: PluginSettingFieldType;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  required?: boolean;
}
export type PluginAssistantToolEffect = 'read' | 'write' | 'external';
export interface PluginAssistantToolDefinition {
  name: string;
  label: string;
  description: string;
  effect: PluginAssistantToolEffect;
  parameters: Record<string, unknown>;
}
export const pluginAssistantContextMaxBytes = 16_000;
export interface PluginAssistantContextProviderDefinition {
  id: string;
  label: string;
  description: string;
  maxBytes?: number;
}
export interface PluginAiCompleteRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}
export interface PluginAiStructuredRequest extends PluginAiCompleteRequest {
  schema: Record<string, unknown>;
}
export interface PluginAiCompleteResult {
  text: string;
  model: string;
  usage?: { input: number; output: number };
}
export interface PluginAiStructuredResult<T = unknown> {
  data: T;
  rawText: string;
  model: string;
  usage?: { input: number; output: number };
}
export interface PluginServiceDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  returns?: Record<string, unknown>;
}
export interface PluginServiceDependency {
  pluginId: string;
  service: string;
  optional?: boolean;
}
export type PluginActivationEvent =
  | 'onStartup'
  | `onCommand:${string}`
  | `onView:${string}`
  | `onFile:${string}`
  | `onAssistantTool:${string}`
  | `onAssistantContext:${string}`
  | `onService:${string}`;
export interface PluginAutomationDefinition { id: string; label: string }
export interface ExecutablePluginManifest extends Omit<ObjectPluginManifest, 'manifestVersion'> {
  manifestVersion: 2;
  apiVersion: 1;
  permissions: PluginPermission[];
  networkOrigins: string[];
  nativeCommands: string[];
  commands: PluginCommandDefinition[];
  /** Optional editor `/` slash menu entries routing to declared commands. */
  slashCommands?: PluginSlashCommandDefinition[];
  views: PluginViewDefinition[];
  /** Optional fenced code block languages rendered via isolated sandboxed UI views. */
  codeBlockRenderers?: PluginCodeBlockRendererDefinition[];
  /** Optional file open handlers for attachments (preview) or compound-suffix Markdown (editor). */
  fileHandlers?: PluginFileHandlerDefinition[];
  /** Optional tools contributed to Tano Assistant (write/external tools require proposal confirmation). */
  assistantTools?: PluginAssistantToolDefinition[];
  /** Optional `@mention` domain context providers for Tano Assistant. */
  assistantContextProviders?: PluginAssistantContextProviderDefinition[];
  /** Optional stateless RPC services exposed to other plugins via the host message bus. */
  services?: PluginServiceDefinition[];
  /** Optional declarations of services consumed from other plugins. */
  usesServices?: PluginServiceDependency[];
  /** Optional declarative settings form schema; host renders controls and merges defaults. */
  settingsSchema?: PluginSettingField[];
  /** Optional lazy activation triggers; omitting activates on workspace startup. */
  activationEvents?: PluginActivationEvent[];
  /** Server entry points require separate workspace authorization; installation never schedules them. */
  automations?: PluginAutomationDefinition[];
}
export type PluginManifest = ObjectPluginManifest | ExecutablePluginManifest;
export type PluginJson = null | boolean | number | string | PluginJson[] | { [key: string]: PluginJson };
export interface PluginUiBundle { html: string; css: string; source: string }
export interface PluginPackageAssets { icons?: FileIconTheme[] }
export interface PluginPackage { packageVersion: 1; manifest: PluginManifest; source?: string; ui?: Record<string, PluginUiBundle>; automationSource?: string; assets?: PluginPackageAssets }
export interface WorkspacePluginRule {
  manifest: PluginManifest;
  mode: PluginMode;
  /** SHA-256 of the canonical package. Executable code is stored outside the workspace. */
  integrity?: string;
  sourceUrl?: string;
  settings: Record<string, unknown>;
  /** Optional directory prefix allowlist restricting document/attachment access (each ends with '/'). */
  pathScopes?: string[];
  history?: PluginVersionReference[];
}
export interface PluginVersionReference { manifest: PluginManifest; integrity?: string; sourceUrl?: string; recordedAt: string }
export interface WorkspacePluginPolicy {
  version: 1;
  /** Team workspace policy controlling user-scoped executable (v2) plugins accessing this workspace. */
  personalCodePlugins?: WorkspacePersonalPluginPolicy;
  plugins: WorkspacePluginRule[];
}

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
    'relationTypes', 'permissions', 'networkOrigins', 'nativeCommands', 'commands', 'slashCommands', 'views',
    'codeBlockRenderers', 'fileHandlers', 'assistantTools', 'assistantContextProviders', 'services', 'usesServices',
    'settingsSchema', 'activationEvents', 'automations', 'appearance', 'engines', 'platforms']);
  if (value.manifestVersion !== 2 || value.apiVersion !== 1) throw new Error('不支持此插件 API 版本');
  const base = parseObjectPlugin(JSON.stringify({ manifestVersion: 1, id: value.id, name: value.name,
    version: value.version, description: value.description, objectTypes: value.objectTypes ?? [], relationTypes: value.relationTypes ?? [],
    ...(value.appearance === undefined ? {} : { appearance: value.appearance }),
    ...(value.engines === undefined ? {} : { engines: value.engines }),
    ...(value.platforms === undefined ? {} : { platforms: value.platforms }) }));
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
      keys(item, kind === 'command' ? ['id', 'label', 'shortcut', 'menus'] : ['id', 'label', 'location', 'layout']);
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
        if (typeof item.location !== 'string' || !pluginViewLocations.includes(item.location as PluginViewLocation)) throw new Error('插件视图位置无效');
        entry.location = item.location as PluginViewLocation;
      }
      if (kind === 'view' && item.layout !== undefined) {
        if (typeof item.layout !== 'string' || !['contained', 'fill'].includes(item.layout)) throw new Error('插件视图布局无效');
        if (item.layout === 'fill' && entry.location !== 'tab') throw new Error('只有标签页视图支持全高填充布局');
        entry.layout = item.layout as PluginViewLayout;
      }
      return entry;
    });
  };
  const commands = contributions(value.commands ?? [], 50, 'command');
  let slashCommands: PluginSlashCommandDefinition[] | undefined;
  if (value.slashCommands !== undefined) {
    if (!Array.isArray(value.slashCommands) || !value.slashCommands.length || value.slashCommands.length > 20)
      throw new Error('插件斜杠命令数量无效');
    const seenSlash = new Set<string>();
    slashCommands = value.slashCommands.map((item: unknown): PluginSlashCommandDefinition => {
      keys(item, ['id', 'label', 'command', 'description', 'keywords']);
      const row = item as Record<string, unknown>;
      if (!pluginKey(row.id) || seenSlash.has(row.id) || !pluginText(row.label, 80))
        throw new Error('插件斜杠命令 ID 重复或名称无效');
      if (typeof row.command !== 'string' || !commands.some(command => command.id === row.command))
        throw new Error('斜杠命令必须引用已声明的插件命令');
      if (row.description !== undefined && !pluginText(row.description, 120))
        throw new Error('插件斜杠命令说明无效');
      const keywords =
        row.keywords === undefined
          ? undefined
          : uniqueStrings(row.keywords, word => pluginText(word, 40), 10);
      seenSlash.add(row.id);
      return {
        id: row.id,
        label: row.label,
        command: row.command,
        ...(row.description !== undefined ? { description: row.description } : {}),
        ...(keywords?.length ? { keywords } : {}),
      };
    });
  }
  const views = contributions(value.views ?? [], 10, 'view');
  let codeBlockRenderers: PluginCodeBlockRendererDefinition[] | undefined;
  if (value.codeBlockRenderers !== undefined) {
    if (!permissions.includes('ui')) throw new Error('代码块渲染器必须声明 ui 权限');
    if (!Array.isArray(value.codeBlockRenderers) || !value.codeBlockRenderers.length || value.codeBlockRenderers.length > 10)
      throw new Error('插件代码块渲染器数量无效');
    const seenLanguages = new Set<string>();
    const reservedLanguages = new Set(['mermaid']);
    codeBlockRenderers = value.codeBlockRenderers.map((item: unknown): PluginCodeBlockRendererDefinition => {
      keys(item, ['languages', 'view', 'label', 'height']);
      const row = item as Record<string, unknown>;
      if (typeof row.view !== 'string' || !views.some(view => view.id === row.view))
        throw new Error('代码块渲染器必须引用已声明的视图');
      if (!Array.isArray(row.languages) || !row.languages.length || row.languages.length > 8)
        throw new Error('代码块渲染器语言数量无效');
      const languages = uniqueStrings(
        row.languages,
        lang =>
          typeof lang === 'string' &&
          /^[a-z][a-z0-9-]{0,31}$/.test(lang) &&
          !reservedLanguages.has(lang) &&
          !seenLanguages.has(lang),
        8,
      );
      languages.forEach(lang => seenLanguages.add(lang));
      if (row.label !== undefined && !pluginText(row.label, 80)) throw new Error('代码块渲染器名称无效');
      if (
        row.height !== undefined &&
        (typeof row.height !== 'number' || !Number.isInteger(row.height) || row.height < 120 || row.height > 720)
      )
        throw new Error('代码块渲染器高度必须为 120 至 720 像素的整数');
      return {
        languages,
        view: row.view,
        ...(row.label !== undefined ? { label: row.label } : {}),
        ...(row.height !== undefined ? { height: row.height } : {}),
      };
    });
  }
  let fileHandlers: PluginFileHandlerDefinition[] | undefined;
  if (value.fileHandlers !== undefined) {
    if (!Array.isArray(value.fileHandlers) || !value.fileHandlers.length || value.fileHandlers.length > 10) throw new Error('插件文件打开器数量无效');
    const seenExtensions = new Set<string>();
    const reservedPreviewExtensions = new Set(['.md', '.markdown', '.tano']);
    fileHandlers = value.fileHandlers.map(item => {
      keys(item, ['extensions', 'mode', 'view', 'command']);
      if (item.mode !== 'preview' && item.mode !== 'editor') throw new Error('插件文件打开器模式无效');
      if (item.mode === 'editor' && !permissions.includes('documents.read')) throw new Error('Markdown 文件打开器必须声明 documents.read 权限');
      if (item.mode === 'preview' && !permissions.includes('attachments.read')) throw new Error('附件预览打开器必须声明 attachments.read 权限');
      if (typeof item.view !== 'string' || !views.some(view => view.id === item.view && view.location === 'tab')) throw new Error('文件打开器必须引用已声明的标签页视图');
      if (typeof item.command !== 'string' || !commands.some(command => command.id === item.command)) throw new Error('文件打开器必须引用已声明的命令');
      if (!Array.isArray(item.extensions) || !item.extensions.length || item.extensions.length > 16) throw new Error('文件打开器扩展名数量无效');
      const extensions = uniqueStrings(item.extensions, ext => {
        if (typeof ext !== 'string' || seenExtensions.has(ext)) return false;
        if (item.mode === 'editor') return /^\.[a-z0-9][a-z0-9-]{0,30}\.(?:md|markdown)$/.test(ext);
        return /^\.[a-z0-9][a-z0-9-]{0,15}$/.test(ext) && !reservedPreviewExtensions.has(ext);
      }, 16);
      extensions.forEach(ext => seenExtensions.add(ext));
      return { extensions, mode: item.mode as PluginFileHandlerMode, view: item.view, command: item.command };
    });
  }
  let settingsSchema: PluginSettingField[] | undefined;
  if (value.settingsSchema !== undefined) {
    if (!Array.isArray(value.settingsSchema) || !value.settingsSchema.length || value.settingsSchema.length > 30)
      throw new Error('插件设置表单定义数量无效');
    const fieldKeys = new Set<string>();
    settingsSchema = value.settingsSchema.map(item => {
      keys(item, ['key', 'label', 'description', 'type', 'default', 'options', 'min', 'max', 'required']);
      if (!pluginKey(item.key) || fieldKeys.has(item.key) || !pluginText(item.label, 80))
        throw new Error('插件设置字段键或名称无效');
      if (item.description !== undefined && !pluginText(item.description, 200))
        throw new Error('插件设置字段说明无效');
      if (item.required !== undefined && typeof item.required !== 'boolean')
        throw new Error('插件设置字段必填声明无效');
      if (!['string', 'number', 'boolean', 'select'].includes(String(item.type)))
        throw new Error('插件设置字段类型无效');
      const type = item.type as PluginSettingFieldType;
      const field: PluginSettingField = { key: item.key, label: item.label, type };
      if (item.description !== undefined) field.description = item.description;
      if (item.required !== undefined) field.required = item.required;
      if (type === 'select') {
        if (!Array.isArray(item.options) || !item.options.length || item.options.length > 30)
          throw new Error('下拉设置字段必须提供 1 至 30 个选项');
        const optionValues = new Set<string>();
        field.options = item.options.map((opt: unknown) => {
          keys(opt, ['value', 'label']);
          const option = opt as Record<string, unknown>;
          if (!pluginText(option.value, 100) || !pluginText(option.label, 80) || optionValues.has(option.value))
            throw new Error('下拉设置选项无效或重复');
          optionValues.add(option.value);
          return { value: option.value, label: option.label };
        });
        if (item.default !== undefined) {
          if (typeof item.default !== 'string' || !optionValues.has(item.default))
            throw new Error('下拉设置默认值必须在选项列表中');
          field.default = item.default;
        }
        if (item.min !== undefined || item.max !== undefined) throw new Error('只有数字设置字段支持范围限制');
      } else {
        if (item.options !== undefined) throw new Error('只有下拉设置字段支持 options');
        if (type === 'number') {
          if (item.min !== undefined && (typeof item.min !== 'number' || !Number.isFinite(item.min)))
            throw new Error('数字设置最小值无效');
          if (item.max !== undefined && (typeof item.max !== 'number' || !Number.isFinite(item.max)))
            throw new Error('数字设置最大值无效');
          if (item.min !== undefined && item.max !== undefined && item.min > item.max)
            throw new Error('数字设置最小值不能大于最大值');
          if (item.min !== undefined) field.min = item.min;
          if (item.max !== undefined) field.max = item.max;
          if (item.default !== undefined) {
            if (typeof item.default !== 'number' || !Number.isFinite(item.default))
              throw new Error('数字设置默认值无效');
            if ((field.min !== undefined && item.default < field.min) || (field.max !== undefined && item.default > field.max))
              throw new Error('数字设置默认值超出允许范围');
            field.default = item.default;
          }
        } else {
          if (item.min !== undefined || item.max !== undefined) throw new Error('只有数字设置字段支持范围限制');
          if (item.default !== undefined) {
            if (type === 'string' && (typeof item.default !== 'string' || item.default.length > 2000))
              throw new Error('文本设置默认值无效');
            if (type === 'boolean' && typeof item.default !== 'boolean')
              throw new Error('开关设置默认值无效');
            field.default = item.default;
          }
        }
      }
      fieldKeys.add(item.key);
      return field;
    });
  }
  let assistantTools: PluginAssistantToolDefinition[] | undefined;
  if (value.assistantTools !== undefined) {
    if (!Array.isArray(value.assistantTools) || !value.assistantTools.length || value.assistantTools.length > 16)
      throw new Error('插件助手工具数量无效');
    const seenTools = new Set<string>();
    assistantTools = value.assistantTools.map((item: unknown): PluginAssistantToolDefinition => {
      keys(item, ['name', 'label', 'description', 'effect', 'parameters']);
      const row = item as Record<string, unknown>;
      if (typeof row.name !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(row.name) || seenTools.has(row.name))
        throw new Error('插件助手工具名称重复或无效');
      if (!pluginText(row.label, 60) || !pluginText(row.description, 300))
        throw new Error('插件助手工具标题或说明无效');
      if (row.effect !== 'read' && row.effect !== 'write' && row.effect !== 'external')
        throw new Error('插件助手工具副作用等级无效');
      const parameters = parsePluginJsonSchemaObject(row.parameters);
      seenTools.add(row.name);
      return {
        name: row.name,
        label: row.label,
        description: row.description,
        effect: row.effect,
        parameters,
      };
    });
  }
  let assistantContextProviders: PluginAssistantContextProviderDefinition[] | undefined;
  if (value.assistantContextProviders !== undefined) {
    if (
      !Array.isArray(value.assistantContextProviders) ||
      !value.assistantContextProviders.length ||
      value.assistantContextProviders.length > 8
    )
      throw new Error('插件助手上下文提供者数量无效');
    const seenProviders = new Set<string>();
    assistantContextProviders = value.assistantContextProviders.map(
      (item: unknown): PluginAssistantContextProviderDefinition => {
        keys(item, ['id', 'label', 'description', 'maxBytes']);
        const row = item as Record<string, unknown>;
        if (typeof row.id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(row.id) || seenProviders.has(row.id))
          throw new Error('插件助手上下文提供者 ID 重复或无效');
        if (!pluginText(row.label, 60) || !pluginText(row.description, 200))
          throw new Error('插件助手上下文提供者标题或说明无效');
        let maxBytes: number | undefined;
        if (row.maxBytes !== undefined) {
          if (
            typeof row.maxBytes !== 'number' ||
            !Number.isInteger(row.maxBytes) ||
            row.maxBytes < 256 ||
            row.maxBytes > pluginAssistantContextMaxBytes
          )
            throw new Error(`插件上下文上限必须为 256 至 ${pluginAssistantContextMaxBytes} 字节的整数`);
          maxBytes = row.maxBytes;
        }
        seenProviders.add(row.id);
        return {
          id: row.id,
          label: row.label,
          description: row.description,
          ...(maxBytes !== undefined ? { maxBytes } : {}),
        };
      },
    );
  }
  let services: PluginServiceDefinition[] | undefined;
  if (value.services !== undefined) {
    if (!Array.isArray(value.services) || !value.services.length || value.services.length > 16)
      throw new Error('插件公开服务数量无效');
    const seenServices = new Set<string>();
    services = value.services.map((item: unknown): PluginServiceDefinition => {
      keys(item, ['name', 'description', 'parameters', 'returns']);
      const row = item as Record<string, unknown>;
      if (typeof row.name !== 'string' || !/^[a-z][a-z0-9_.-]{0,47}$/.test(row.name) || seenServices.has(row.name))
        throw new Error('插件服务名称重复或无效');
      if (!pluginText(row.description, 240)) throw new Error('插件服务说明无效');
      const parameters = row.parameters !== undefined ? parsePluginJsonSchemaObject(row.parameters) : undefined;
      const returns = row.returns !== undefined ? parsePluginJsonSchemaObject(row.returns) : undefined;
      seenServices.add(row.name);
      return {
        name: row.name,
        description: row.description,
        ...(parameters ? { parameters } : {}),
        ...(returns ? { returns } : {}),
      };
    });
  }
  let usesServices: PluginServiceDependency[] | undefined;
  if (value.usesServices !== undefined) {
    if (!Array.isArray(value.usesServices) || !value.usesServices.length || value.usesServices.length > 20)
      throw new Error('插件依赖服务数量无效');
    const seenDeps = new Set<string>();
    usesServices = value.usesServices.map((item: unknown): PluginServiceDependency => {
      keys(item, ['pluginId', 'service', 'optional']);
      const row = item as Record<string, unknown>;
      if (!pluginKey(row.pluginId) || typeof row.service !== 'string' || !/^[a-z][a-z0-9_.-]{0,47}$/.test(row.service))
        throw new Error('插件依赖服务声明无效');
      if (row.optional !== undefined && typeof row.optional !== 'boolean')
        throw new Error('插件依赖服务 optional 字段必须为布尔值');
      const depKey = `${row.pluginId}:${row.service}`;
      if (seenDeps.has(depKey)) throw new Error('插件依赖服务声明重复');
      seenDeps.add(depKey);
      return {
        pluginId: row.pluginId,
        service: row.service,
        ...(row.optional !== undefined ? { optional: row.optional } : {}),
      };
    });
  }
  let activationEvents: PluginActivationEvent[] | undefined;
  if (value.activationEvents !== undefined) {
    if (!Array.isArray(value.activationEvents) || !value.activationEvents.length || value.activationEvents.length > 20)
      throw new Error('插件激活事件数量无效');
    const declaredExtensions = new Set((fileHandlers ?? []).flatMap(handler => handler.extensions));
    const declaredTools = new Set((assistantTools ?? []).map(tool => tool.name));
    const declaredProviders = new Set((assistantContextProviders ?? []).map(provider => provider.id));
    const declaredServices = new Set((services ?? []).map(service => service.name));
    activationEvents = uniqueStrings(value.activationEvents, item => {
      if (typeof item !== 'string') return false;
      if (item === 'onStartup') return true;
      if (item.startsWith('onCommand:')) return commands.some(command => command.id === item.slice('onCommand:'.length));
      if (item.startsWith('onView:')) return views.some(view => view.id === item.slice('onView:'.length));
      if (item.startsWith('onFile:')) return declaredExtensions.has(item.slice('onFile:'.length));
      if (item.startsWith('onAssistantTool:')) return declaredTools.has(item.slice('onAssistantTool:'.length));
      if (item.startsWith('onAssistantContext:')) return declaredProviders.has(item.slice('onAssistantContext:'.length));
      if (item.startsWith('onService:')) return declaredServices.has(item.slice('onService:'.length));
      return false;
    }, 20) as PluginActivationEvent[];
  }
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
    commands,
    ...(slashCommands ? { slashCommands } : {}),
    views,
    ...(codeBlockRenderers ? { codeBlockRenderers } : {}),
    ...(fileHandlers ? { fileHandlers } : {}),
    ...(assistantTools ? { assistantTools } : {}),
    ...(assistantContextProviders ? { assistantContextProviders } : {}),
    ...(services ? { services } : {}),
    ...(usesServices ? { usesServices } : {}),
    ...(settingsSchema ? { settingsSchema } : {}),
    ...(activationEvents ? { activationEvents } : {}),
    ...(automations ? { automations } : {}) };
}
export function resolvePluginSettingsWithDefaults(
  settings: Record<string, unknown>,
  schema?: readonly PluginSettingField[],
): Record<string, unknown> {
  const result = parsePluginSettings(settings);
  if (!schema?.length) return result;
  for (const field of schema) {
    if (result[field.key] === undefined && field.default !== undefined) result[field.key] = field.default;
  }
  return result;
}
export function validatePluginSettingsAgainstSchema(
  settings: Record<string, unknown>,
  schema?: readonly PluginSettingField[],
): Record<string, unknown> {
  const parsed = parsePluginSettings(settings);
  if (!schema?.length) return parsed;
  for (const field of schema) {
    const val = parsed[field.key];
    if (val === undefined || val === null || val === '') {
      if (field.required && field.default === undefined)
        throw new Error(`插件设置项「${field.label}」为必填项`);
      continue;
    }
    if (field.type === 'string' && typeof val !== 'string')
      throw new Error(`插件设置项「${field.label}」必须为文本`);
    if (field.type === 'boolean' && typeof val !== 'boolean')
      throw new Error(`插件设置项「${field.label}」必须为布尔值`);
    if (field.type === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val))
        throw new Error(`插件设置项「${field.label}」必须为数字`);
      if (field.min !== undefined && val < field.min)
        throw new Error(`插件设置项「${field.label}」不能小于 ${field.min}`);
      if (field.max !== undefined && val > field.max)
        throw new Error(`插件设置项「${field.label}」不能大于 ${field.max}`);
    }
    if (field.type === 'select') {
      if (typeof val !== 'string' || !field.options?.some(opt => opt.value === val))
        throw new Error(`插件设置项「${field.label}」取值不在允许选项中`);
    }
  }
  return parsed;
}
export function matchPluginFileExtension(path: string, extension: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  const suffix = extension.toLowerCase();
  return suffix.startsWith('.') && name.length > suffix.length && name.endsWith(suffix);
}
export function parsePluginPackage(content: string): PluginPackage {
  if (new TextEncoder().encode(content).length > pluginPackageLimit) throw new Error('插件包不能超过 4 MiB');
  const value = JSON.parse(content);
  if (value?.manifestVersion === 1) return { packageVersion: 1, manifest: parsePluginManifest(value) };
  keys(value, ['packageVersion', 'manifest', 'source', 'ui', 'automationSource', 'assets']);
  if (value.packageVersion !== 1) throw new Error('不支持此插件包版本');
  const manifest = parsePluginManifest(value.manifest);
  const iconRefs = manifest.appearance?.iconRefs ?? [];
  let assets: PluginPackageAssets | undefined;
  if (value.assets !== undefined) {
    keys(value.assets, ['icons']);
    if (!Array.isArray(value.assets.icons) || !value.assets.icons.length || value.assets.icons.length > 12)
      throw new Error('插件静态图标资产无效');
    const icons: FileIconTheme[] = value.assets.icons.map((item: unknown) => parseFileIconTheme(item));
    if (new Set(icons.map(theme => theme.id)).size !== icons.length) throw new Error('插件静态图标资产 ID 重复');
    if (icons.length !== iconRefs.length) throw new Error('插件静态图标资产与清单 iconRefs 不一致');
    for (const ref of iconRefs) {
      const target = icons.find(theme => theme.id === ref.id);
      if (!target || target.label !== ref.label || (ref.notice !== undefined && target.notice !== ref.notice))
        throw new Error('插件静态图标资产与清单声明不匹配');
    }
    assets = { icons };
  } else if (iconRefs.length) {
    throw new Error('声明了 iconRefs 的插件包必须附带 assets.icons');
  }
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
    if (manifest.codeBlockRenderers?.length) {
      for (const renderer of manifest.codeBlockRenderers) {
        if (!Object.hasOwn(ui, renderer.view))
          throw new Error(`代码块渲染器引用的视图「${renderer.view}」缺少 UI 界面包`);
      }
    }
    if (manifest.automations?.length) {
      if (typeof value.automationSource !== 'string' || !value.automationSource.trim()) throw new Error('自动化插件缺少服务端入口脚本');
    } else if (value.automationSource !== undefined) throw new Error('服务端脚本必须声明自动化入口');
    return { packageVersion: 1, manifest, source: value.source, ...(value.ui === undefined ? {} : { ui }),
      ...(value.automationSource === undefined ? {} : { automationSource: value.automationSource }),
      ...(assets ? { assets } : {}) };
  }
  if (value.source !== undefined || value.ui !== undefined || value.automationSource !== undefined) throw new Error('声明式插件不能携带脚本');
  return { packageVersion: 1, manifest, ...(assets ? { assets } : {}) };
}

export function isRasterIconTheme(theme: FileIconTheme): boolean {
  return Object.values(theme.icons).some(icon => icon.image !== undefined || icon.lightImage !== undefined);
}

export function hasRasterIconAssets(manifest: PluginManifest): boolean {
  return !!manifest.appearance?.icons?.some(isRasterIconTheme);
}

/** Moves heavy raster PNG icon themes out of manifest.appearance.icons into pkg.assets.icons + manifest.appearance.iconRefs. */
export function externalizeHeavyIconAssets(pkg: PluginPackage): PluginPackage {
  const inlineIcons = pkg.manifest.appearance?.icons;
  if (!inlineIcons?.some(isRasterIconTheme)) return pkg;
  const keptInline: FileIconTheme[] = [];
  const externalIcons: FileIconTheme[] = [...(pkg.assets?.icons ?? [])];
  const refs: FileIconThemeRef[] = [...(pkg.manifest.appearance?.iconRefs ?? [])];
  for (const theme of inlineIcons) {
    if (isRasterIconTheme(theme)) {
      externalIcons.push(theme);
      refs.push({ id: theme.id, label: theme.label, ...(theme.notice === undefined ? {} : { notice: theme.notice }) });
    } else {
      keptInline.push(theme);
    }
  }
  const { icons: _removed, ...restAppearance } = pkg.manifest.appearance!;
  const manifest: PluginManifest = {
    ...pkg.manifest,
    appearance: {
      ...restAppearance,
      ...(keptInline.length ? { icons: keptInline } : {}),
      iconRefs: refs,
    },
  };
  return parsePluginPackage(JSON.stringify({ ...pkg, manifest, assets: { icons: externalIcons } }));
}

/** Hydrates externalized pkg.assets.icons into an in-memory manifest copy for AppearanceController/FileIconRegistry. */
export function hydratePluginPackageAssets(manifest: PluginManifest, pkg?: PluginPackage): PluginManifest {
  const externalIcons = pkg?.assets?.icons;
  if (!externalIcons?.length || !manifest.appearance?.iconRefs?.length) return manifest;
  const existing = manifest.appearance.icons ?? [];
  const existingIds = new Set(existing.map(theme => theme.id));
  const merged = [...existing, ...externalIcons.filter(theme => !existingIds.has(theme.id))];
  const mergedIds = new Set(merged.map(theme => theme.id));
  const remainingRefs = manifest.appearance.iconRefs.filter(ref => !mergedIds.has(ref.id));
  const { iconRefs: _hydratedRefs, ...restAppearance } = manifest.appearance;
  return {
    ...manifest,
    appearance: {
      ...restAppearance,
      icons: merged,
      ...(remainingRefs.length ? { iconRefs: remainingRefs } : {}),
    },
  };
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
  const bytes = new TextEncoder().encode(content).length;
  const hasLegacyInlinePng = content.includes('data:image/png;base64,');
  const limit = hasLegacyInlinePng ? legacyWorkspacePluginPolicyLimit : workspacePluginPolicyLimit;
  if (bytes > limit) throw new Error(hasLegacyInlinePng ? '工作区插件规则不能超过 16 MiB' : '工作区插件规则不能超过 1 MiB');
  const value = JSON.parse(content);
  keys(value, ['version', 'personalCodePlugins', 'plugins']);
  if (value.version !== 1 || !Array.isArray(value.plugins) || value.plugins.length > 100) throw new Error('工作区插件规则无效');
  let personalCodePlugins: WorkspacePersonalPluginPolicy | undefined;
  if (value.personalCodePlugins !== undefined) {
    if (!['allow', 'read-only', 'block'].includes(String(value.personalCodePlugins)))
      throw new Error('个人代码插件访问策略无效');
    personalCodePlugins = value.personalCodePlugins as WorkspacePersonalPluginPolicy;
  }
  const ids = new Set<string>();
  const plugins = value.plugins.map((item: unknown): WorkspacePluginRule => {
    keys(item, ['manifest', 'mode', 'integrity', 'sourceUrl', 'settings', 'pathScopes', 'history']);
    const row = item as Record<string, unknown>;
    const manifest = parsePluginManifest(row.manifest);
    if (ids.has(manifest.id) || !['required', 'recommended', 'optional', 'disabled'].includes(String(row.mode))) throw new Error('插件规则重复或模式无效');
    ids.add(manifest.id);
    if (row.integrity !== undefined && (typeof row.integrity !== 'string' || !/^[a-f0-9]{64}$/.test(row.integrity))) throw new Error('插件内容摘要无效');
    if (manifest.manifestVersion === 2 && !row.integrity) throw new Error('代码插件必须锁定内容摘要');
    if (manifest.appearance?.iconRefs?.length && !row.integrity) throw new Error('包含外置图标资产的插件必须锁定内容摘要');
    if (row.sourceUrl !== undefined) {
      if (!pluginText(row.sourceUrl, 2048)) throw new Error('插件下载地址无效');
      const url = new URL(row.sourceUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('插件下载地址必须为 HTTPS');
    }
    const pathScopes = row.pathScopes === undefined ? undefined : parsePluginPathScopes(row.pathScopes);
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
    return { manifest, mode: row.mode as PluginMode, settings: parsePluginSettings(row.settings ?? {}),
      ...(pathScopes?.length ? { pathScopes } : {}),
      ...(history ? { history } : {}),
      ...(row.integrity ? { integrity: row.integrity as string } : {}), ...(row.sourceUrl ? { sourceUrl: row.sourceUrl as string } : {}) };
  });
  return { version: 1, ...(personalCodePlugins ? { personalCodePlugins } : {}), plugins };
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

function pluginMultilineText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0009\u000b-\u001f]/.test(value);
}

export function parsePluginStatusBarItem(value: unknown): PluginStatusBarItem {
  keys(value, ['id', 'text', 'tooltip', 'align', 'priority', 'tone', 'command']);
  const item = value as Record<string, unknown>;
  if (!pluginKey(item.id) || !pluginText(item.text, 60)) throw new Error('插件状态栏项 ID 或文本无效');
  if (item.tooltip !== undefined && !pluginText(item.tooltip, 200)) throw new Error('插件状态栏提示无效');
  if (item.align !== undefined && item.align !== 'left' && item.align !== 'right')
    throw new Error('插件状态栏对齐方式无效');
  if (
    item.priority !== undefined &&
    (typeof item.priority !== 'number' || !Number.isInteger(item.priority) || item.priority < -1000 || item.priority > 1000)
  )
    throw new Error('插件状态栏优先级必须为 -1000 至 1000 的整数');
  if (item.tone !== undefined && !['default', 'accent', 'warning', 'danger'].includes(String(item.tone)))
    throw new Error('插件状态栏样式类型无效');
  if (item.command !== undefined && !pluginKey(item.command)) throw new Error('插件状态栏命令标识无效');
  return {
    id: item.id,
    text: item.text,
    ...(item.tooltip !== undefined ? { tooltip: item.tooltip } : {}),
    align: (item.align as PluginStatusBarAlign | undefined) ?? 'right',
    priority: (item.priority as number | undefined) ?? 0,
    tone: (item.tone as PluginStatusBarTone | undefined) ?? 'default',
    ...(item.command !== undefined ? { command: item.command } : {}),
  };
}

export function parsePluginUiPickOptions(value: unknown): PluginUiPickOptions {
  keys(value, ['title', 'placeholder', 'items']);
  const opts = value as Record<string, unknown>;
  if (!pluginText(opts.title, 120)) throw new Error('选择框标题无效');
  if (opts.placeholder !== undefined && !pluginText(opts.placeholder, 120)) throw new Error('选择框占位提示无效');
  if (!Array.isArray(opts.items) || !opts.items.length || opts.items.length > 200)
    throw new Error('选择框必须提供 1 至 200 个选项');
  const seen = new Set<string>();
  const items = opts.items.map((raw: unknown): PluginUiPickItem => {
    keys(raw, ['id', 'label', 'description', 'detail']);
    const entry = raw as Record<string, unknown>;
    if (!pluginText(entry.id, 120) || seen.has(entry.id) || !pluginText(entry.label, 120))
      throw new Error('选择框选项 ID 重复或名称无效');
    seen.add(entry.id);
    if (entry.description !== undefined && !pluginText(entry.description, 160)) throw new Error('选择框选项摘要无效');
    if (entry.detail !== undefined && !pluginText(entry.detail, 240)) throw new Error('选择框选项详情无效');
    return {
      id: entry.id,
      label: entry.label,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    };
  });
  return {
    title: opts.title,
    ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
    items,
  };
}

export function parsePluginUiPromptOptions(value: unknown): PluginUiPromptOptions {
  keys(value, ['title', 'message', 'placeholder', 'defaultValue', 'confirmLabel']);
  const opts = value as Record<string, unknown>;
  if (!pluginText(opts.title, 120)) throw new Error('输入框标题无效');
  if (opts.message !== undefined && !pluginMultilineText(opts.message, 500)) throw new Error('输入框说明无效');
  if (opts.placeholder !== undefined && !pluginText(opts.placeholder, 120)) throw new Error('输入框占位提示无效');
  if (opts.defaultValue !== undefined && (typeof opts.defaultValue !== 'string' || opts.defaultValue.length > 2000 || /[\u0000-\u001f]/.test(opts.defaultValue)))
    throw new Error('输入框默认值无效');
  if (opts.confirmLabel !== undefined && !pluginText(opts.confirmLabel, 40)) throw new Error('输入框确认按钮文案无效');
  return {
    title: opts.title,
    ...(opts.message !== undefined ? { message: opts.message } : {}),
    ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
    ...(opts.defaultValue !== undefined ? { defaultValue: opts.defaultValue } : {}),
    ...(opts.confirmLabel !== undefined ? { confirmLabel: opts.confirmLabel } : {}),
  };
}

export function parsePluginUiConfirmOptions(value: unknown): PluginUiConfirmOptions {
  keys(value, ['title', 'message', 'confirmLabel', 'cancelLabel', 'danger']);
  const opts = value as Record<string, unknown>;
  if (!pluginText(opts.title, 120)) throw new Error('确认框标题无效');
  if (opts.message !== undefined && !pluginMultilineText(opts.message, 500)) throw new Error('确认框说明无效');
  if (opts.confirmLabel !== undefined && !pluginText(opts.confirmLabel, 40)) throw new Error('确认框确认按钮文案无效');
  if (opts.cancelLabel !== undefined && !pluginText(opts.cancelLabel, 40)) throw new Error('确认框取消按钮文案无效');
  if (opts.danger !== undefined && typeof opts.danger !== 'boolean') throw new Error('确认框危险标记无效');
  return {
    title: opts.title,
    ...(opts.message !== undefined ? { message: opts.message } : {}),
    ...(opts.confirmLabel !== undefined ? { confirmLabel: opts.confirmLabel } : {}),
    ...(opts.cancelLabel !== undefined ? { cancelLabel: opts.cancelLabel } : {}),
    ...(opts.danger !== undefined ? { danger: opts.danger } : {}),
  };
}

export function parsePluginUiToastOptions(value: unknown): PluginUiToastOptions {
  keys(value, ['message', 'tone']);
  const opts = value as Record<string, unknown>;
  if (!pluginText(opts.message, 300)) throw new Error('提示消息无效');
  if (opts.tone !== undefined && !['info', 'success', 'warning', 'error'].includes(String(opts.tone)))
    throw new Error('提示消息类型无效');
  return {
    message: opts.message,
    tone: (opts.tone as PluginUiTone | undefined) ?? 'info',
  };
}

export function parsePluginFrontmatterPatch(value: unknown): PluginFrontmatterPatch {
  keys(value, ['set', 'remove']);
  const patch = value as Record<string, unknown>;
  let set: Record<string, PluginJson> | undefined;
  let remove: string[] | undefined;
  if (patch.set !== undefined) {
    if (!pluginRecord(patch.set)) throw new Error('frontmatter.set 必须为键值对对象');
    const entries = Object.entries(patch.set);
    if (entries.length > 50) throw new Error('单次最多更新 50 个文档属性');
    const normalized: Record<string, PluginJson> = {};
    for (const [key, raw] of entries) {
      const trimmed = key.trim();
      if (!trimmed || trimmed !== key || !pluginText(trimmed, 100))
        throw new Error(`文档属性名无效：${key}`);
      normalized[trimmed] = parsePluginJson(raw, 16 * 1024);
    }
    if (entries.length) set = normalized;
  }
  if (patch.remove !== undefined) {
    if (!Array.isArray(patch.remove) || patch.remove.length > 50)
      throw new Error('frontmatter.remove 必须为不超过 50 项的属性名数组');
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of patch.remove) {
      if (typeof item !== 'string' || !item.trim() || item.trim() !== item || !pluginText(item, 100) || seen.has(item))
        throw new Error('frontmatter.remove 包含无效或重复的属性名');
      seen.add(item);
      list.push(item);
    }
    if (list.length) remove = list;
  }
  if (!set && !remove) throw new Error('frontmatter 更新必须指定 set 或 remove');
  return { ...(set ? { set } : {}), ...(remove ? { remove } : {}) };
}

export function parsePluginEditorDecorations(value: unknown): PluginEditorDecoration[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('插件编辑器装饰数量不能超过 200 项');
  return value.map((raw: unknown): PluginEditorDecoration => {
    keys(raw, ['id', 'from', 'to', 'tone', 'badge', 'tooltip', 'command']);
    const item = raw as Record<string, unknown>;
    if (item.id !== undefined && !pluginKey(item.id)) throw new Error('插件装饰 ID 无效');
    if (
      typeof item.from !== 'number' ||
      typeof item.to !== 'number' ||
      !Number.isSafeInteger(item.from) ||
      !Number.isSafeInteger(item.to) ||
      item.from < 0 ||
      item.to < item.from
    )
      throw new Error('插件装饰偏移范围无效');
    if (item.tone !== undefined && !['info', 'accent', 'warning', 'danger', 'muted'].includes(String(item.tone)))
      throw new Error('插件装饰样式类型无效');
    if (item.badge !== undefined && !pluginText(item.badge, 48)) throw new Error('插件装饰徽章文本无效');
    if (item.tooltip !== undefined && !pluginText(item.tooltip, 200)) throw new Error('插件装饰提示文本无效');
    if (item.command !== undefined && !pluginKey(item.command)) throw new Error('插件装饰命令标识无效');
    if (item.to === item.from && item.badge === undefined)
      throw new Error('空范围装饰必须提供 badge 文本');
    return {
      ...(item.id !== undefined ? { id: item.id } : {}),
      from: item.from,
      to: item.to,
      tone: (item.tone as PluginEditorDecorationTone | undefined) ?? 'accent',
      ...(item.badge !== undefined ? { badge: item.badge } : {}),
      ...(item.tooltip !== undefined ? { tooltip: item.tooltip } : {}),
      ...(item.command !== undefined ? { command: item.command } : {}),
    };
  });
}

export function parsePluginPathScopes(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new Error('插件目录权限范围最多支持 20 项');
  if (!value.length) return undefined;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !pluginText(raw, 200)) throw new Error('插件目录权限路径无效');
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (
      !trimmed ||
      trimmed.startsWith('/') ||
      trimmed.includes('\\') ||
      trimmed.includes('//') ||
      trimmed.split('/').some(seg => !seg || seg === '.' || seg === '..' || seg === '.tano')
    )
      throw new Error(`插件目录权限路径不合法：${raw}`);
    const scope = `${trimmed}/`;
    if (!seen.has(scope)) {
      seen.add(scope);
      normalized.push(scope);
    }
  }
  return normalized.length ? normalized : undefined;
}

export function matchesPluginPathScopes(path: string, scopes?: readonly string[]): boolean {
  if (!scopes?.length) return true;
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '');
  return scopes.some(scope => normalized.startsWith(scope));
}

export function parsePluginAttachmentWrite(value: unknown): {
  name: string;
  bytes: Uint8Array;
  documentPath: string;
  mimeType: string;
  image: boolean;
} {
  keys(value, ['name', 'contentBase64', 'documentPath', 'mimeType']);
  const input = value as Record<string, unknown>;
  if (!pluginText(input.name, 160) || /[\\/]/.test(input.name) || input.name === '.' || input.name === '..')
    throw new Error('附件文件名无效');
  const lower = input.name.toLowerCase();
  const ext = pluginAttachmentWriteExtensions.find(suffix => lower.length > suffix.length && lower.endsWith(suffix));
  if (!ext) throw new Error('不支持写入此类型的附件文件');
  if (typeof input.contentBase64 !== 'string' || !input.contentBase64.length || input.contentBase64.length > 560 * 1024)
    throw new Error('附件内容无效或超过 400 KiB 写入上限');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64) || input.contentBase64.length % 4 !== 0)
    throw new Error('附件 Base64 编码无效');
  let binary: string;
  try {
    binary = atob(input.contentBase64);
  } catch {
    throw new Error('附件 Base64 解码失败');
  }
  if (binary.length === 0 || binary.length > pluginAttachmentWriteLimit)
    throw new Error('附件内容不能为空且不能超过 400 KiB');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  let documentPath = '';
  if (input.documentPath !== undefined) {
    if (typeof input.documentPath !== 'string' || input.documentPath.length > 500 || /[\u0000-\u001f\\]/.test(input.documentPath))
      throw new Error('关联文档路径无效');
    if (input.documentPath.startsWith('/') || input.documentPath.split('/').some(seg => seg === '..' || seg === '.tano'))
      throw new Error('关联文档路径不合法');
    documentPath = input.documentPath;
  }
  const mimeType =
    input.mimeType !== undefined
      ? (() => {
          if (!pluginText(input.mimeType, 100) || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(input.mimeType))
            throw new Error('附件 MIME 类型无效');
          return input.mimeType;
        })()
      : 'application/octet-stream';
  const image = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext);
  return { name: input.name, bytes, documentPath, mimeType, image };
}

const allowedJsonSchemaTypes = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
function sanitizeJsonSchemaNode(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4 || !pluginRecord(value)) throw new Error('JSON Schema 节点无效或嵌套过深');
  const node: Record<string, unknown> = {};
  const allowedKeys = [
    'type', 'description', 'enum', 'properties', 'required', 'additionalProperties',
    'items', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems',
  ];
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new Error(`JSON Schema 包含不支持的字段：${key}`);
  }
  if (value.type !== undefined) {
    if (typeof value.type === 'string') {
      if (!allowedJsonSchemaTypes.has(value.type)) throw new Error('JSON Schema 字段类型不受支持');
      node.type = value.type;
    } else if (Array.isArray(value.type) && value.type.length > 0 && value.type.length <= 2) {
      if (value.type.some(item => typeof item !== 'string' || !allowedJsonSchemaTypes.has(item)))
        throw new Error('JSON Schema 联合类型不受支持');
      node.type = [...value.type];
    } else {
      throw new Error('JSON Schema type 格式无效');
    }
  }
  if (value.description !== undefined) {
    if (!pluginText(value.description, 300)) throw new Error('JSON Schema 说明无效');
    node.description = value.description;
  }
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || !value.enum.length || value.enum.length > 32)
      throw new Error('JSON Schema 枚举数量无效');
    if (value.enum.some(item => !['string', 'number', 'boolean'].includes(typeof item) && item !== null))
      throw new Error('JSON Schema 枚举项类型无效');
    node.enum = [...value.enum];
  }
  if (value.properties !== undefined) {
    if (!pluginRecord(value.properties)) throw new Error('JSON Schema properties 必须是对象');
    const entries = Object.entries(value.properties);
    if (entries.length > 20) throw new Error('JSON Schema 属性数量超过 20 个上限');
    const props: Record<string, unknown> = {};
    for (const [propKey, propSchema] of entries) {
      if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(propKey)) throw new Error('JSON Schema 属性键无效');
      props[propKey] = sanitizeJsonSchemaNode(propSchema, depth + 1);
    }
    node.properties = props;
  }
  if (value.required !== undefined) {
    const props = (node.properties as Record<string, unknown> | undefined) ?? {};
    if (
      !Array.isArray(value.required) ||
      value.required.length > 20 ||
      value.required.some(item => typeof item !== 'string' || !Object.prototype.hasOwnProperty.call(props, item)) ||
      new Set(value.required).size !== value.required.length
    )
      throw new Error('JSON Schema required 必须引用已声明的 properties');
    node.required = [...value.required];
  }
  if (value.additionalProperties !== undefined) {
    if (typeof value.additionalProperties !== 'boolean') throw new Error('JSON Schema additionalProperties 必须为布尔值');
    node.additionalProperties = value.additionalProperties;
  }
  if (value.items !== undefined) {
    node.items = sanitizeJsonSchemaNode(value.items, depth + 1);
  }
  for (const bound of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'] as const) {
    if (value[bound] !== undefined) {
      if (typeof value[bound] !== 'number' || !Number.isFinite(value[bound]))
        throw new Error(`JSON Schema ${bound} 必须为有效数字`);
      node[bound] = value[bound];
    }
  }
  return node;
}

export function parsePluginJsonSchemaObject(value: unknown): Record<string, unknown> {
  const schema = sanitizeJsonSchemaNode(value, 0);
  if (schema.type !== 'object' || !pluginRecord(schema.properties))
    throw new Error('JSON Schema 顶层必须为 type: "object" 且声明 properties');
  if (schema.additionalProperties === undefined) schema.additionalProperties = false;
  if (JSON.stringify(schema).length > 8192) throw new Error('JSON Schema 大小不能超过 8 KiB');
  return schema;
}

function matchesSchemaType(value: unknown, expected: string): boolean {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return pluginRecord(value);
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

export function validateAgainstPluginJsonSchema(data: unknown, schema: Record<string, unknown>, path = '$'): void {
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? (schema.type as string[]) : [String(schema.type)];
    if (!allowed.some(type => matchesSchemaType(data, type)))
      throw new Error(`结构化输出字段 ${path} 类型不匹配，期望 ${allowed.join(' | ')}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(data))
    throw new Error(`结构化输出字段 ${path} 不在允许的枚举范围内`);
  if (pluginRecord(data) && pluginRecord(schema.properties)) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (typeof req === 'string' && !Object.prototype.hasOwnProperty.call(data, req))
          throw new Error(`结构化输出缺少必填字段 ${path}.${req}`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) {
        if (!Object.prototype.hasOwnProperty.call(props, key))
          throw new Error(`结构化输出包含未声明字段 ${path}.${key}`);
      }
    }
    for (const [key, propSchema] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        validateAgainstPluginJsonSchema(data[key], propSchema, `${path}.${key}`);
      }
    }
  }
  if (Array.isArray(data) && pluginRecord(schema.items)) {
    for (let i = 0; i < data.length; i++) {
      validateAgainstPluginJsonSchema(data[i], schema.items as Record<string, unknown>, `${path}[${i}]`);
    }
  }
}

export function parsePluginAiRequest(
  value: unknown,
  structured: false,
): PluginAiCompleteRequest;
export function parsePluginAiRequest(
  value: unknown,
  structured: true,
): PluginAiStructuredRequest;
export function parsePluginAiRequest(
  value: unknown,
  structured: boolean,
): PluginAiCompleteRequest | PluginAiStructuredRequest {
  keys(value, structured ? ['prompt', 'system', 'maxTokens', 'temperature', 'schema'] : ['prompt', 'system', 'maxTokens', 'temperature']);
  const input = value as Record<string, unknown>;
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 32_000)
    throw new Error('AI 请求 prompt 不能为空且不能超过 32000 字符');
  let system: string | undefined;
  if (input.system !== undefined) {
    if (typeof input.system !== 'string' || input.system.length > 4_000)
      throw new Error('AI 请求 system 提示不能超过 4000 字符');
    if (input.system.trim()) system = input.system;
  }
  let maxTokens: number | undefined;
  if (input.maxTokens !== undefined) {
    if (typeof input.maxTokens !== 'number' || !Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 4096)
      throw new Error('AI 请求 maxTokens 必须为 1 至 4096 的整数');
    maxTokens = input.maxTokens;
  }
  let temperature: number | undefined;
  if (input.temperature !== undefined) {
    if (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)
      throw new Error('AI 请求 temperature 必须在 0 至 2 之间');
    temperature = input.temperature;
  }
  const base: PluginAiCompleteRequest = {
    prompt: input.prompt,
    ...(system !== undefined ? { system } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };
  if (!structured) return base;
  return {
    ...base,
    schema: parsePluginJsonSchemaObject(input.schema),
  };
}
