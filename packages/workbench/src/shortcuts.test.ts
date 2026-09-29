// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { isSidebarToggleShortcut } from './shortcuts';

function shortcut(key: string, options: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, ...options });
}

it('recognizes the sidebar toggle shortcut on Windows and macOS', () => {
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true }))).toBe(true);
  expect(isSidebarToggleShortcut(shortcut('B', { metaKey: true }))).toBe(true);
});

it('ignores modified, repeated, and composing key presses', () => {
  expect(isSidebarToggleShortcut(shortcut('b'))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, shiftKey: true }))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, altKey: true }))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, repeat: true }))).toBe(false);
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, isComposing: true }))).toBe(false);
});
