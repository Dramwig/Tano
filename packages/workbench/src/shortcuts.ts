type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
> & { target?: EventTarget | null; keyCode?: number; code?: string };

export const shortcutDefinitions = [
  { id: 'toggleSidebar', label: '收起或展开侧栏', group: '工作台', default: 'Mod+B', scope: '编辑区外' },
  { id: 'findDocument', label: '查找文档', group: '工作台', default: 'Mod+K' },
  { id: 'commandPalette', label: '打开命令中心', group: '工作台', default: 'Mod+Shift+P' },
  { id: 'openDocument', label: '打开文档', group: '工作台', default: 'Mod+O' },
  { id: 'newDocument', label: '新建文档', group: '工作台', default: 'Mod+N' },
  { id: 'save', label: '立即保存', group: '工作台', default: 'Mod+S' },
  { id: 'pageSearch', label: '页内搜索', group: '页内搜索', default: 'Mod+F' },
  { id: 'pageReplace', label: '查找与替换', group: '页内搜索', default: 'Mod+H' },
  { id: 'nextMatch', label: '下一个匹配', group: '页内搜索', default: 'Enter', scope: '搜索输入框中' },
  { id: 'previousMatch', label: '上一个匹配', group: '页内搜索', default: 'Shift+Enter', scope: '搜索输入框中' },
  { id: 'nextMatchFromEditor', label: '下一个匹配（编辑区）', group: '页内搜索', default: 'Mod+G', scope: '搜索打开时' },
  { id: 'previousMatchFromEditor', label: '上一个匹配（编辑区）', group: '页内搜索', default: 'Mod+Shift+G', scope: '搜索打开时' },
  { id: 'closeSearch', label: '关闭页内搜索', group: '页内搜索', default: 'Escape', scope: '搜索打开时' },
  { id: 'focusToolbar', label: '聚焦选区工具栏', group: '编辑器', default: 'Alt+F10', scope: '工具栏显示时' },
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
    return '请使用 Ctrl / ⌘、Alt 组合键或功能键，避免影响正常输入。';
  const conflict = shortcutDefinitions.find(item => item.id !== id && bindings[item.id] === binding);
  return conflict ? `此快捷键已用于“${conflict.label}”，请先修改或清除该快捷键。` : '';
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
  if (!binding) return '未设置';
  return binding.split('+').map(key => key === 'Mod' ? (isMac() ? '⌘' : 'Ctrl') : key === 'Escape' ? 'Esc' : key === 'Space' ? '空格' : key).join(' + ');
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
