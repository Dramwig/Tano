// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h } from 'vue';
import type { App } from 'vue';
import { defaultSelectionContext } from '@tano/editor/document-model';
import SelectionToolbar from './SelectionToolbar.vue';
import { defaultShortcutBindings } from '../shortcuts';
import type { ShortcutBindings } from '../shortcuts';

vi.mock('./EditorToolbar.vue', () => ({ default: { template: '<button type="button">工具栏操作</button>' } }));
let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });

async function mountToolbar(shortcuts: ShortcutBindings) {
  root = document.createElement('div');
  root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  const editor = document.createElement('div');
  editor.className = 'ProseMirror'; editor.contentEditable = 'true'; editor.tabIndex = 0;
  const host = document.createElement('div'); root.append(editor, host); document.body.append(root);
  editor.focus();
  app = createApp({ render: () => h(SelectionToolbar, {
    editorElement: root, context: { ...defaultSelectionContext }, mode: 'left', shortcuts,
  }) });
  app.mount(host);
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).not.toBeNull());
  return editor;
}

it('captures a configured focus shortcut before an editor can consume it', async () => {
  const editor = await mountToolbar({ ...defaultShortcutBindings, focusToolbar: 'Mod+Shift+T' });
  const consumed = vi.fn((event: Event) => event.stopPropagation());
  editor.addEventListener('keydown', consumed);
  const event = new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  editor.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(consumed).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe('工具栏操作');
  editor.focus();
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true }));
  expect(document.activeElement).toBe(editor);
});

it('hides every docked control when the pointer leaves the pane and restores them on return', async () => {
  const editor = await mountToolbar(defaultShortcutBindings);
  const toolbar = document.querySelector('.selection-toolbar')!;
  toolbar.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  expect(document.querySelector('.selection-toolbar')).not.toBeNull();
  document.body.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).toBeNull());
  // Selection or layout updates must not bring it back while the pointer is outside.
  document.dispatchEvent(new Event('selectionchange'));
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  expect(document.activeElement).toBe(editor);
  editor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).not.toBeNull());
  editor.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }));
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).toBeNull());
});

it('does not intercept recording in settings dialogs or disabled shortcuts', async () => {
  const editor = await mountToolbar(defaultShortcutBindings);
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  const recording = document.createElement('button'); dialog.append(recording); root.append(dialog);
  const event = new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true });
  recording.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(editor);
  app!.unmount();
  const disabledEditor = await mountToolbar({ ...defaultShortcutBindings, focusToolbar: null });
  disabledEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true }));
  expect(document.activeElement).toBe(disabledEditor);
  dialog.parentElement?.remove();
});
