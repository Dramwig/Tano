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
] as const;

export type ShortcutId = typeof shortcutDefinitions[number]['id'];
export type ShortcutBindings = Record<ShortcutId, string | null>;
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
  if (binding.includes('Mod+Alt+')) return false; // AltGr can enter ordinary text.
  if (binding.includes('Mod+') || binding.includes('Alt+') || /(^|\+)F\d+$/.test(binding)) return true;
  return ['nextMatch', 'previousMatch', 'closeSearch'].includes(id) &&
    /^(Shift\+)?(Enter|Escape|ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(binding);
}

export function shortcutBindingError(id: ShortcutId, binding: string, bindings: ShortcutBindings) {
  if (parseBinding(binding) !== binding || !validForAction(id, binding))
    return t('请使用 Ctrl / ⌘、Alt 组合键或功能键，避免影响正常输入。');
  const conflict = shortcutDefinitions.find(item => item.id !== id && bindings[item.id] === binding);
  return conflict ? t('此快捷键已用于“{0}”，请先修改或清除该快捷键。', [conflict.label]) : '';
}

export function parseShortcutBindings(value: unknown): ShortcutBindings {
  const bindings = { ...defaultShortcutBindings };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bindings;
  const input = value as Record<string, unknown>;
  for (const { id } of shortcutDefinitions) {
    if (input[id] === null) bindings[id] = null;
    else {
      const binding = parseBinding(input[id]);
      if (binding && validForAction(id, binding)) bindings[id] = binding;
    }
  }
  // Do not let a newly introduced default erase a pre-existing custom binding.
  if (!Object.hasOwn(input, 'commandPalette') && shortcutDefinitions.some(({ id }) =>
    id !== 'commandPalette' && Object.hasOwn(input, id) && bindings[id] === bindings.commandPalette)) bindings.commandPalette = null;
  // Invalid saved conflicts must never route one key press to several actions.
  const conflicting = shortcutDefinitions.filter(({ id }) => bindings[id] !== null &&
    shortcutDefinitions.some(other => other.id !== id && bindings[other.id] === bindings[id]));
  for (const { id } of conflicting) bindings[id] = null;
  return bindings;
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

export function shortcutAriaLabel(binding: string | null | undefined) {
  return binding?.replace('Mod', isMac() ? 'Meta' : 'Control') ?? '';
}

export function shortcutLabel(binding: string | null | undefined) {
  if (!binding) return t('未设置');
  return binding.split('+').map(key => key === 'Mod' ? (isMac() ? '⌘' : 'Ctrl') : key === 'Escape' ? 'Esc' : key === 'Space' ? t('空格') : key).join(' + ');
}

export function matchesShortcut(event: KeyboardShortcutEvent, id: ShortcutId, bindings = defaultShortcutBindings) {
  const binding = bindings[id];
  return !!binding && shortcutBindingFromEvent(event) === binding;
}

export function isSidebarToggleShortcut(event: KeyboardShortcutEvent, bindings = defaultShortcutBindings) {
  const target = event.target;
  // Formatting shortcuts belong to the focused editor or input.
  if (target instanceof Element && target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
  )) return false;
  return matchesShortcut(event, 'toggleSidebar', bindings);
}
