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
  expect(isSidebarToggleShortcut(shortcut('b', { ctrlKey: true, keyCode: 229 }))).toBe(false);
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
