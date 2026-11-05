// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  defaultShortcutBindings, isSidebarToggleShortcut, matchesShortcut, parseShortcutBindings,
  readShortcutBindings, saveShortcutBindings, shortcutBindingError, shortcutBindingFromEvent,
  shortcutAriaLabel, shortcutLabel, shortcutPreferenceKey,
} from './shortcuts';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

function shortcut(key: string, options: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, ...options });
}

it.each([
  ['moveBlockUp', 'ArrowUp', '↑'],
  ['moveBlockDown', 'ArrowDown', '↓'],
  ['indentBlock', 'ArrowRight', '→'],
  ['outdentBlock', 'ArrowLeft', '←'],
] as const)('displays an arrow symbol for %s', (id, key, symbol) => {
  expect(shortcutLabel(defaultShortcutBindings[id])).toBe(`Alt + ${symbol}`);
  expect(shortcutLabel(key)).toBe(symbol);
  expect(shortcutAriaLabel(defaultShortcutBindings[id])).toBe(`Alt+${key}`);
  expect(matchesShortcut(shortcut(key, { altKey: true }), id)).toBe(true);
});

it('formats multiple direction keys with arrow symbols', () => {
  expect(shortcutLabel(defaultShortcutBindings.menuNavigate)).toBe('↑ / ↓ / Home / End');
  expect(shortcutLabel(defaultShortcutBindings.navigateTabs)).toBe('← / → / Home / End');
});

it('preserves backspace names for icon rendering and accessibility', () => {
  expect(shortcutLabel('Backspace')).toBe('Backspace');
  expect(shortcutLabel('Alt+Backspace')).toBe('Alt + Backspace');
  expect(shortcutLabel(defaultShortcutBindings.deleteBlock)).toBe('Backspace / Delete');
  expect(shortcutAriaLabel('Backspace')).toBe('Backspace');
  expect(matchesShortcut(shortcut('Backspace'), 'deleteBlock')).toBe(true);
});

it('recognizes the sidebar toggle shortcut on Windows and macOS', () => {
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true }))).toBe(true);
  expect(isSidebarToggleShortcut(shortcut('B', { metaKey: true }))).toBe(true);
});

it('supports printing on Windows and macOS, including custom bindings and conflicts', () => {
  expect(matchesShortcut(shortcut('p', { ctrlKey: true }), 'print')).toBe(true);
  expect(matchesShortcut(shortcut('p', { metaKey: true }), 'print')).toBe(true);
  expect(matchesShortcut(shortcut('p', { ctrlKey: true, shiftKey: true }), 'print')).toBe(false);
  expect(shortcutBindingError('save', 'Mod+P', defaultShortcutBindings)).toContain('打印文档');
  const bindings = parseShortcutBindings({ print: 'Alt+P' });
  expect(matchesShortcut(shortcut('p', { altKey: true }), 'print', bindings)).toBe(true);
  expect(matchesShortcut(shortcut('p', { ctrlKey: true }), 'print', bindings)).toBe(false);
  expect(parseShortcutBindings({ save: 'Mod+P' })).toMatchObject({ save: 'Mod+P', print: null });
});

it('ignores modified, repeated, and composing key presses', () => {
  expect(isSidebarToggleShortcut(shortcut('b'))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, shiftKey: true }))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, altKey: true }))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, repeat: true }))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, isComposing: true }))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, keyCode: 229 }))).toBe(false);
});

it.each([
  ['toggleSource', 'e', '切换源码模式'],
  ['toggleMarkdownReveal', 'm', '光标展开源码'],
  ['toggleAssistant', 'a', '打开或关闭同页助手'],
] as const)('supports %s defaults, customization, and existing saved bindings', (id, key, label) => {
  expect(matchesShortcut(shortcut(key, { ctrlKey: true, shiftKey: true }), id)).toBe(true);
  expect(matchesShortcut(shortcut(key, { metaKey: true, shiftKey: true }), id)).toBe(true);
  expect(matchesShortcut(shortcut(key, { ctrlKey: true }), id)).toBe(false);
  expect(matchesShortcut(shortcut(key, { ctrlKey: true, shiftKey: true, repeat: true }), id)).toBe(false);
  expect(matchesShortcut(shortcut(key, { ctrlKey: true, shiftKey: true, isComposing: true }), id)).toBe(false);
  expect(shortcutBindingError('save', `Mod+Shift+${key.toUpperCase()}`, defaultShortcutBindings)).toContain(label);
  const custom = parseShortcutBindings({ [id]: 'Alt+J' });
  saveShortcutBindings(custom);
  expect(matchesShortcut(shortcut('j', { altKey: true }), id, readShortcutBindings())).toBe(true);
  expect(matchesShortcut(shortcut(key, { ctrlKey: true, shiftKey: true }), id, custom)).toBe(false);
  expect(parseShortcutBindings({ [id]: null })[id]).toBeNull();
  const upgraded = parseShortcutBindings({ save: defaultShortcutBindings[id] });
  expect(upgraded.save).toEqual(defaultShortcutBindings[id]);
  expect(upgraded[id]).toBeNull();
});

it.each(['input', 'textarea', 'select', 'rich text', 'plain text'])('leaves Ctrl+B to the focused %s', (kind) => {
  const target = document.createElement(['input', 'textarea', 'select'].includes(kind) ? kind : 'div');
  if (kind === 'rich text') target.setAttribute('contenteditable', 'true');
  if (kind === 'plain text') target.setAttribute('contenteditable', 'plaintext-only');
  const child = kind.includes('text') && kind !== 'textarea' ? target.appendChild(document.createElement('span')) : target;
  let matched: boolean | undefined;
  target.addEventListener('keydown', event => { matched = isSidebarToggleShortcut(event as KeyboardEvent); });
  child.dispatchEvent(shortcut('b', { ctrlKey: true, bubbles: true }));
  expect(matched).toBe(false);
});

it('keeps the sidebar shortcut available outside editable controls', () => {
  const button = document.createElement('button');
  let matched: boolean | undefined;
  button.addEventListener('keydown', event => { matched = isSidebarToggleShortcut(event); });
  button.dispatchEvent(shortcut('b', { ctrlKey: true }));
  expect(matched).toBe(true);
});

it('uses custom bindings immediately and stops matching old defaults', () => {
  const bindings = { ...defaultShortcutBindings, save: 'Alt+Shift+S', toggleSidebar: 'Mod+Shift+B' };
  expect(matchesShortcut(shortcut('s', { ctrlKey: true }), 'save', bindings)).toBe(false);
  expect(matchesShortcut(shortcut('S', { altKey: true, shiftKey: true }), 'save', bindings)).toBe(true);
  expect(isSidebarToggleShortcut(shortcut('B', { metaKey: true, shiftKey: true }), bindings)).toBe(true);
  expect(matchesShortcut(shortcut('s', { ctrlKey: true, shiftKey: true }), 'save')).toBe(false);
  expect(matchesShortcut(shortcut('s', { ctrlKey: true, altKey: true }), 'save')).toBe(false);
});

it('records modifier combinations and ignores modifier-only, IME, and held key events', () => {
  expect(shortcutBindingFromEvent(shortcut('p', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+P');
  expect(shortcutBindingFromEvent(shortcut('F10', { altKey: true }))).toBe('Alt+F10');
  expect(shortcutBindingFromEvent(shortcut('å', { altKey: true, code: 'KeyA' }))).toBe('Alt+A');
  expect(shortcutBindingFromEvent(shortcut('!', { ctrlKey: true, shiftKey: true, code: 'Digit1' }))).toBe('Mod+Shift+1');
  expect(shortcutBindingFromEvent(shortcut('Control', { ctrlKey: true }))).toBeNull();
  expect(shortcutBindingFromEvent(shortcut('p', { ctrlKey: true, isComposing: true }))).toBeNull();
  expect(shortcutBindingFromEvent(shortcut('p', { ctrlKey: true, keyCode: 229 }))).toBeNull();
  expect(shortcutBindingFromEvent(shortcut('p', { ctrlKey: true, repeat: true }))).toBeNull();
});

it('rejects conflicts and bindings that interfere with typing', () => {
  expect(shortcutBindingError('save', 'Mod+K', defaultShortcutBindings)).toContain('查找文档');
  expect(shortcutBindingError('save', 'S', defaultShortcutBindings)).toBeTruthy();
  expect(shortcutBindingError('save', 'Shift+S', defaultShortcutBindings)).toBeTruthy();
  expect(shortcutBindingError('save', 'Mod+Alt+S', defaultShortcutBindings)).toBeTruthy();
  expect(shortcutBindingError('save', 'F8', defaultShortcutBindings)).toBe('');
  expect(shortcutBindingError('nextMatch', 'ArrowDown', defaultShortcutBindings)).toBe('');
});

it('persists bindings and disabled actions in device preferences', () => {
  const bindings = { ...defaultShortcutBindings, findDocument: 'Mod+Shift+J', save: null };
  saveShortcutBindings(bindings);
  expect(readShortcutBindings()).toEqual(bindings);
  expect(matchesShortcut(shortcut('s', { ctrlKey: true }), 'save', readShortcutBindings())).toBe(false);
  expect(shortcutLabel(null)).toBe('未设置');
  expect(localStorage.length).toBe(1);
});

it('persists multiple bindings, matches each alias, and removes only the chosen alias', () => {
  const bindings = { ...defaultShortcutBindings, redo: ['Alt+Y', 'Alt+Shift+Y'] };
  saveShortcutBindings(bindings);
  expect(readShortcutBindings().redo).toEqual(['Alt+Y', 'Alt+Shift+Y']);
  expect(matchesShortcut(shortcut('y', { altKey: true }), 'redo', bindings)).toBe(true);
  expect(matchesShortcut(shortcut('Y', { altKey: true, shiftKey: true }), 'redo', bindings)).toBe(true);
  expect(matchesShortcut(shortcut('y', { ctrlKey: true }), 'redo', bindings)).toBe(false);
  expect(shortcutBindingError('undo', 'Alt+Shift+Y', bindings)).toContain('重做');
  expect(shortcutLabel(bindings.redo)).toBe('Alt + Y / Alt + Shift + Y');
});

it('recovers from corrupt preferences and disables ambiguous saved conflicts', () => {
  localStorage.setItem(shortcutPreferenceKey, '{invalid');
  expect(readShortcutBindings()).toEqual(defaultShortcutBindings);
  expect(parseShortcutBindings({ save: 'S', findDocument: 'Alt+Shift+P', unknown: 'Mod+L' }))
    .toEqual({ ...defaultShortcutBindings, findDocument: 'Alt+Shift+P' });
  const conflicting = parseShortcutBindings({ save: 'Mod+K' });
  expect(conflicting.save).toBeNull();
  expect(conflicting.findDocument).toBeNull();
});

it('preserves an existing custom shortcut when upgrading to the command palette', () => {
  const upgraded = parseShortcutBindings({ findDocument: 'Mod+Shift+P' });
  expect(upgraded.findDocument).toBe('Mod+Shift+P');
  expect(upgraded.commandPalette).toBeNull();
  expect(matchesShortcut(shortcut('p', { ctrlKey: true, shiftKey: true }), 'commandPalette')).toBe(true);
});

it('keeps preferences usable when device storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  expect(readShortcutBindings()).toEqual(defaultShortcutBindings);
  expect(() => saveShortcutBindings(defaultShortcutBindings)).not.toThrow();
});
