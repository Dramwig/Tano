import { t } from './i18n';

// Formatting bindings supplied by the Milkdown CommonMark and GFM presets.
export const formattingShortcuts: Readonly<Record<string, string>> = {
  bold: 'Mod+B',
  italic: 'Mod+I',
  code: 'Mod+E',
  strikethrough: 'Mod+Alt+X',
};
type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
> & { target?: EventTarget | null; keyCode?: number; code?: string };

export const shortcutDefinitions = [
  { id: 'toggleSidebar', get label() { return t('收起或展开侧栏'); }, get group() { return t('工作台'); }, default: 'Mod+B', get scope() { return t('编辑区外'); } },
  { id: 'findDocument', get label() { return t('查找文档'); }, get group() { return t('工作台'); }, default: 'Mod+K' },
  { id: 'commandPalette', get label() { return t('打开命令中心'); }, get group() { return t('工作台'); }, default: 'Mod+Shift+P' },
  { id: 'openDocument', get label() { return t('打开文档'); }, get group() { return t('工作台'); }, default: 'Mod+O' },
  { id: 'newDocument', get label() { return t('新建文档'); }, get group() { return t('工作台'); }, default: 'Mod+N' },
  { id: 'save', get label() { return t('立即保存'); }, get group() { return t('工作台'); }, default: 'Mod+S' },
  { id: 'pageSearch', get label() { return t('页内搜索'); }, get group() { return t('页内搜索'); }, default: 'Mod+F' },
  { id: 'pageReplace', get label() { return t('查找与替换'); }, get group() { return t('页内搜索'); }, default: 'Mod+H' },
  { id: 'nextMatch', get label() { return t('下一个匹配'); }, get group() { return t('页内搜索'); }, default: 'Enter', get scope() { return t('搜索输入框中'); } },
  { id: 'previousMatch', get label() { return t('上一个匹配'); }, get group() { return t('页内搜索'); }, default: 'Shift+Enter', get scope() { return t('搜索输入框中'); } },
  { id: 'nextMatchFromEditor', get label() { return t('下一个匹配（编辑区）'); }, get group() { return t('页内搜索'); }, default: 'Mod+G', get scope() { return t('搜索打开时'); } },
  { id: 'previousMatchFromEditor', get label() { return t('上一个匹配（编辑区）'); }, get group() { return t('页内搜索'); }, default: 'Mod+Shift+G', get scope() { return t('搜索打开时'); } },
  { id: 'closeSearch', get label() { return t('关闭页内搜索'); }, get group() { return t('页内搜索'); }, default: 'Escape', get scope() { return t('搜索打开时'); } },
  { id: 'focusToolbar', get label() { return t('聚焦选区工具栏'); }, get group() { return t('编辑器'); }, default: 'Alt+F10', get scope() { return t('工具栏显示时'); } },
  { id: 'undo', get label() { return t('撤销'); }, get group() { return t('编辑器'); }, default: "Mod+Z", context: 'editor', get scope() { return t('编辑器中'); } },
  { id: 'redo', get label() { return t('重做'); }, get group() { return t('编辑器'); }, default: ["Mod+Y","Mod+Shift+Z"], context: 'editor', get scope() { return t('编辑器中'); } },
  { id: 'bold', get label() { return t('粗体'); }, get group() { return t('编辑器'); }, default: "Mod+B", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'italic', get label() { return t('斜体'); }, get group() { return t('编辑器'); }, default: "Mod+I", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'code', get label() { return t('行内代码'); }, get group() { return t('编辑器'); }, default: "Mod+E", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'strikethrough', get label() { return t('删除线'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+X", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'paragraph', get label() { return t('转为正文'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+0", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'heading1', get label() { return t('转为 1 级标题'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+1", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'heading2', get label() { return t('转为 2 级标题'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+2", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'heading3', get label() { return t('转为 3 级标题'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+3", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'heading4', get label() { return t('转为 4 级标题'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+4", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'heading5', get label() { return t('转为 5 级标题'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+5", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'heading6', get label() { return t('转为 6 级标题'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+6", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'quote', get label() { return t('引用块'); }, get group() { return t('编辑器'); }, default: "Mod+Shift+B", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'codeBlock', get label() { return t('代码块'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+C", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'bulletList', get label() { return t('无序列表'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+8", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'orderedList', get label() { return t('有序列表'); }, get group() { return t('编辑器'); }, default: "Mod+Alt+7", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'expandSelection', get label() { return t('扩展选区 / 全选'); }, get group() { return t('编辑器'); }, default: "Mod+A", context: 'rich', get scope() { return t('可视化编辑器中'); } },
  { id: 'deleteBlock', get label() { return t('删除选中的块'); }, get group() { return t('块操作'); }, default: ["Backspace","Delete"], context: 'block', get scope() { return t('选中块或块菜单中'); } },
  { id: 'moveBlockUp', get label() { return t('上移块'); }, get group() { return t('块操作'); }, default: "Alt+ArrowUp", context: 'block', get scope() { return t('选中块或块菜单中'); } },
  { id: 'moveBlockDown', get label() { return t('下移块'); }, get group() { return t('块操作'); }, default: "Alt+ArrowDown", context: 'block', get scope() { return t('选中块或块菜单中'); } },
  { id: 'indentBlock', get label() { return t('移入前一个容器'); }, get group() { return t('块操作'); }, default: "Alt+ArrowRight", context: 'block', get scope() { return t('选中块或块菜单中'); } },
  { id: 'outdentBlock', get label() { return t('移出当前容器'); }, get group() { return t('块操作'); }, default: "Alt+ArrowLeft", context: 'block', get scope() { return t('选中块或块菜单中'); } },
  { id: 'renameFile', get label() { return t('重命名文件或文件夹'); }, get group() { return t('文件管理'); }, default: "F2", context: 'file', get scope() { return t('文件树中'); } },
  { id: 'deleteFile', get label() { return t('删除文件或文件夹'); }, get group() { return t('文件管理'); }, default: "Delete", context: 'file', get scope() { return t('文件树中'); } },
  { id: 'copy', get label() { return t('复制'); }, get group() { return t('内置操作'); }, default: "Mod+C", readOnly: true, context: 'native', get scope() { return t('选区中'); } },
  { id: 'cut', get label() { return t('剪切'); }, get group() { return t('内置操作'); }, default: "Mod+X", readOnly: true, context: 'native', get scope() { return t('可编辑选区中'); } },
  { id: 'paste', get label() { return t('粘贴'); }, get group() { return t('内置操作'); }, default: "Mod+V", readOnly: true, context: 'native', get scope() { return t('可编辑区域中'); } },
  { id: 'softBreak', get label() { return t('插入换行'); }, get group() { return t('内置操作'); }, default: "Shift+Enter", readOnly: true, context: 'native', get scope() { return t('可视化编辑器中'); } },
  { id: 'listIndent', get label() { return t('列表缩进'); }, get group() { return t('内置操作'); }, default: ["Tab","Mod+]"], readOnly: true, context: 'native', get scope() { return t('列表项中'); } },
  { id: 'listOutdent', get label() { return t('列表取消缩进'); }, get group() { return t('内置操作'); }, default: ["Shift+Tab","Mod+["], readOnly: true, context: 'native', get scope() { return t('列表项中'); } },
  { id: 'newListItem', get label() { return t('新建列表项'); }, get group() { return t('内置操作'); }, default: "Enter", readOnly: true, context: 'native', get scope() { return t('列表项中'); } },
  { id: 'nextCell', get label() { return t('下一个单元格'); }, get group() { return t('内置操作'); }, default: ["Tab","Mod+]"], readOnly: true, context: 'native', get scope() { return t('表格中'); } },
  { id: 'previousCell', get label() { return t('上一个单元格'); }, get group() { return t('内置操作'); }, default: ["Shift+Tab","Mod+["], readOnly: true, context: 'native', get scope() { return t('表格中'); } },
  { id: 'nextRow', get label() { return t('下一行单元格'); }, get group() { return t('内置操作'); }, default: "Enter", readOnly: true, context: 'native', get scope() { return t('表格中'); } },
  { id: 'cellBreak', get label() { return t('单元格内换行'); }, get group() { return t('内置操作'); }, default: ["Shift+Enter","Mod+Enter"], readOnly: true, context: 'native', get scope() { return t('表格中'); } },
  { id: 'finishLocalSource', get label() { return t('结束临时源码编辑'); }, get group() { return t('内置操作'); }, default: ["Escape","Mod+Enter"], readOnly: true, context: 'native', get scope() { return t('临时源码编辑中'); } },
  { id: 'blankAi', get label() { return t('空白块助手'); }, get group() { return t('内置操作'); }, default: "Space", readOnly: true, context: 'native', get scope() { return t('空白段落中；需开启空白块助手快捷键'); } },
  { id: 'tabContext', get label() { return t('打开标签页菜单'); }, get group() { return t('内置操作'); }, default: ["ContextMenu","Shift+F10"], readOnly: true, context: 'native', get scope() { return t('标签页获得焦点时'); } },
  { id: 'navigateTabs', get label() { return t('切换标签页'); }, get group() { return t('内置操作'); }, default: ["ArrowLeft","ArrowRight","Home","End"], readOnly: true, context: 'native', get scope() { return t('标签页获得焦点时'); } },
  { id: 'menuNavigate', get label() { return t('菜单导航'); }, get group() { return t('内置操作'); }, default: ["ArrowUp","ArrowDown","Home","End"], readOnly: true, context: 'native', get scope() { return t('菜单打开时'); } },
  { id: 'submenu', get label() { return t('展开或收起二级菜单'); }, get group() { return t('内置操作'); }, default: ["ArrowRight","ArrowLeft"], readOnly: true, context: 'native', get scope() { return t('菜单打开时'); } },
  { id: 'closeMenu', get label() { return t('关闭菜单'); }, get group() { return t('内置操作'); }, default: "Escape", readOnly: true, context: 'native', get scope() { return t('菜单打开时'); } },
] as const;

export type ShortcutId = typeof shortcutDefinitions[number]['id'];
export type ShortcutBinding = string | readonly string[] | null;
export type ShortcutBindings = Record<ShortcutId, ShortcutBinding>;
export function shortcutKeys(binding: ShortcutBinding | undefined): string[] { return typeof binding === 'string' ? [binding] : [...(binding ?? [])]; }
export function withShortcutKeys(bindings: ShortcutBindings, id: ShortcutId, keys: string[]): ShortcutBindings {
  const unique = [...new Set(keys)];
  return { ...bindings, [id]: unique.length > 1 ? unique : unique[0] ?? null };
}
function contextOf(id: ShortcutId) { const item = shortcutDefinitions.find(item => item.id === id)!; return 'context' in item ? item.context : id === 'toggleSidebar' ? 'outside' : 'global'; }
function overlaps(a: ShortcutId, b: ShortcutId) { const x = contextOf(a), y = contextOf(b); if (x === 'native' || y === 'native') return false; return !(x === 'outside' && ['rich', 'editor', 'block'].includes(y) || y === 'outside' && ['rich', 'editor', 'block'].includes(x) || x === 'file' && ['rich', 'editor', 'block'].includes(y) || y === 'file' && ['rich', 'editor', 'block'].includes(x)); }
export const shortcutPreferenceKey = 'tano.preference.shortcuts';
export const defaultShortcutBindings = Object.fromEntries(
  shortcutDefinitions.map(item => [item.id, item.default]),
) as ShortcutBindings;

const namedKeys = new Set(['Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function normalizeKey(key: string) {
  if (key === ' ') return 'Space';
  if (key.length === 1 && /^[a-z0-9`\-=[\]\\;',./]$/i.test(key)) return key.toUpperCase();
  return namedKeys.has(key) || /^F([1-9]|1\d|2[0-4])$/.test(key) ? key : null;
}

function parseBinding(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('+');
  const key = normalizeKey(parts.pop() ?? '');
  if (!key || parts.some(part => !['Mod', 'Alt', 'Shift'].includes(part)) || new Set(parts).size !== parts.length) return null;
  return [...['Mod', 'Alt', 'Shift'].filter(part => parts.includes(part)), key].join('+');
}

export function shortcutBindingFromEvent(event: KeyboardShortcutEvent) {
  if (event.isComposing || event.keyCode === 229 || event.repeat || (event.ctrlKey && event.metaKey)) return null;
  const key = normalizeKey(event.key) ??
    (event.code?.match(/^(?:Key([A-Z])|Digit([0-9]))$/)?.slice(1).find(Boolean) || null);
  if (!key) return null;
  return [event.ctrlKey || event.metaKey ? 'Mod' : '', event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+');
}

function validForAction(id: ShortcutId, binding: string) {
  if (shortcutKeys(defaultShortcutBindings[id]).includes(binding)) return true;
  if (['Mod+C', 'Mod+X', 'Mod+V'].includes(binding)) return false;
  if (binding.includes('Mod+Alt+')) return false; // AltGr can enter ordinary text.
  if (binding.includes('Mod+') || binding.includes('Alt+') || /(^|\+)F\d+$/.test(binding)) return true;
  return ['nextMatch', 'previousMatch', 'closeSearch'].includes(id) &&
    /^(Shift\+)?(Enter|Escape|ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(binding);
}

export function shortcutBindingError(id: ShortcutId, binding: string, bindings: ShortcutBindings) {
  if (parseBinding(binding) !== binding || !validForAction(id, binding))
    return t('请使用 Ctrl / ⌘、Alt 组合键或功能键，避免影响正常输入。');
  const conflict = shortcutDefinitions.find(item => item.id !== id && overlaps(id, item.id) && shortcutKeys(bindings[item.id]).includes(binding));
  return conflict ? t('此快捷键已用于“{0}”，请先修改或清除该快捷键。', [conflict.label]) : '';
}

export function parseShortcutBindings(value: unknown): ShortcutBindings {
  const bindings = { ...defaultShortcutBindings };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bindings;
  const input = value as Record<string, unknown>;
  for (const definition of shortcutDefinitions) {
    const { id } = definition;
    if ('readOnly' in definition) continue;
    if (input[id] === null) bindings[id] = null;
    else {
      const raw = input[id];
      const keys = (Array.isArray(raw) ? raw : [raw]).map(parseBinding).filter((key): key is string => !!key && validForAction(id, key));
      if (keys.length) bindings[id] = keys.length > 1 ? [...new Set(keys)] : keys[0]!;
      else if (Array.isArray(raw) && !raw.length) bindings[id] = null;
    }
  }
  // Do not let a newly introduced default erase a pre-existing custom binding.
  if (!Object.hasOwn(input, 'commandPalette') && shortcutDefinitions.some(({ id }) =>
    id !== 'commandPalette' && Object.hasOwn(input, id) && shortcutKeys(bindings[id]).some(key => shortcutKeys(bindings.commandPalette).includes(key)))) bindings.commandPalette = null;
  for (const definition of shortcutDefinitions) {
    const { id } = definition;
    if (!('context' in definition) || Object.hasOwn(input, id)) continue;
    const keys = shortcutKeys(bindings[id]).filter(key => !shortcutDefinitions.some(other => other.id !== id && Object.hasOwn(input, other.id) && overlaps(id, other.id) && shortcutKeys(bindings[other.id]).includes(key)));
    bindings[id] = keys.length > 1 ? keys : keys[0] ?? null;
  }
  // Invalid saved conflicts must never route one key press to several actions.
  const cleaned = { ...bindings };
  for (const { id } of shortcutDefinitions) {
    const keys = shortcutKeys(bindings[id]).filter(key => !shortcutDefinitions.some(other =>
      other.id !== id && overlaps(id, other.id) && shortcutKeys(bindings[other.id]).includes(key)));
    cleaned[id] = keys.length > 1 ? keys : keys[0] ?? null;
  }
  return cleaned;
}

export function readShortcutBindings(): ShortcutBindings {
  try { return parseShortcutBindings(JSON.parse(window.localStorage.getItem(shortcutPreferenceKey) ?? 'null')); }
  catch { return { ...defaultShortcutBindings }; }
}

export function saveShortcutBindings(bindings: ShortcutBindings) {
  try { window.localStorage.setItem(shortcutPreferenceKey, JSON.stringify(bindings)); }
  catch { /* Preferences remain usable for this session if device storage is unavailable. */ }
}

function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function shortcutAriaLabel(binding: ShortcutBinding | undefined) {
  return shortcutKeys(binding).map(key => key.replace('Mod', isMac() ? 'Meta' : 'Control')).join(' ');
}

export function shortcutLabel(binding: ShortcutBinding | undefined) {
  if (!shortcutKeys(binding).length) return t('未设置');
  return shortcutKeys(binding).map(binding => binding.split('+').map(key => key === 'Mod' ? (isMac() ? '⌘' : 'Ctrl') : key === 'Escape' ? 'Esc' : key === 'Space' ? t('空格') : key).join(' + ')).join(' / ');
}

export function matchesShortcut(event: KeyboardShortcutEvent, id: ShortcutId, bindings = defaultShortcutBindings) {
  const binding = bindings[id];
  return shortcutKeys(binding).includes(shortcutBindingFromEvent(event) ?? '');
}

export function isSidebarToggleShortcut(event: KeyboardShortcutEvent, bindings = defaultShortcutBindings) {
  const target = event.target;
  // Formatting shortcuts belong to the focused editor or input.
  if (target instanceof Element && target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
  )) return false;
  return matchesShortcut(event, 'toggleSidebar', bindings);
}
