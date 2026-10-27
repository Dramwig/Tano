// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import ShortcutSettings from './ShortcutSettings.vue';
import { defaultShortcutBindings } from '../shortcuts';
import type { ShortcutBindings } from '../shortcuts';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
function mountSettings() {
  root = document.createElement('div'); document.body.append(root);
  const bindings = ref({ ...defaultShortcutBindings });
  app = createApp({ render: () => h(ShortcutSettings, {
    bindings: bindings.value,
    onChange: (value: ShortcutBindings) => { bindings.value = value; },
  }) });
  app.mount(root);
  return bindings;
}
function button(label: string) { return root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!; }
async function record(label: string, key: string, options: KeyboardEventInit) {
  const control = button(`设置${label}快捷键`);
  control.focus(); control.click(); await nextTick();
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  control.dispatchEvent(event); await nextTick();
  return event;
}

it('records a new binding and updates the displayed shortcut', async () => {
  const bindings = mountSettings();
  await record('查找文档', 'j', { ctrlKey: true, shiftKey: true });
  expect(bindings.value.findDocument).toBe('Mod+Shift+J');
  expect(button('设置查找文档快捷键').textContent).toBe('Ctrl+Shift+J');
  expect(button('设置查找文档快捷键').getAttribute('aria-pressed')).toBe('false');
});

it('offers a cancel button for both editing and adding a binding without changing saved keys', async () => {
  const bindings = mountSettings();
  button('设置重做快捷键').click(); await nextTick();
  button('取消编辑').click(); await nextTick();
  expect(bindings.value.redo).toEqual(defaultShortcutBindings.redo);
  expect(button('设置重做快捷键').getAttribute('aria-pressed')).toBe('false');
  button('添加重做快捷键').click(); await nextTick();
  expect(button('设置重做快捷键 3')).not.toBeNull();
  button('取消编辑').click(); await nextTick();
  expect(button('设置重做快捷键 3')).toBeNull();
  expect(bindings.value.redo).toEqual(defaultShortcutBindings.redo);
});

it('shows redo aliases separately and edits, removes, and adds one without replacing the others', async () => {
  const bindings = mountSettings();
  expect(button('设置重做快捷键').textContent).toBe('Ctrl+Y');
  expect(button('设置重做快捷键 2').textContent).toBe('Ctrl+Shift+Z');
  const second = button('设置重做快捷键 2'); second.click(); await nextTick();
  second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Y', altKey: true, shiftKey: true, bubbles: true }));
  await nextTick();
  expect(bindings.value.redo).toEqual(['Mod+Y', 'Alt+Shift+Y']);
  button('清除重做快捷键').click(); await nextTick();
  expect(bindings.value.redo).toBe('Alt+Shift+Y');
  button('添加重做快捷键').click(); await nextTick();
  button('设置重做快捷键 2').dispatchEvent(new KeyboardEvent('keydown', { key: 'y', altKey: true, bubbles: true }));
  await nextTick();
  expect(bindings.value.redo).toEqual(['Alt+Shift+Y', 'Alt+Y']);
});

it('keeps the previous value and explains conflicts while recording', async () => {
  const bindings = mountSettings();
  await record('查找文档', 's', { ctrlKey: true });
  expect(bindings.value.findDocument).toBe('Mod+K');
  expect(root.querySelector('[role="alert"]')!.textContent).toContain('立即保存');
  expect(root.querySelector('[role="alert"]')!.closest('[data-settings-key]')?.getAttribute('data-settings-key')).toBe('shortcut-findDocument');
  expect(button('设置查找文档快捷键').getAttribute('aria-invalid')).toBe('true');
  expect(button('设置查找文档快捷键').getAttribute('aria-pressed')).toBe('true');
  await record('查找文档', 'p', { ctrlKey: true, shiftKey: true });
  expect(root.querySelector('[role="alert"]')!.textContent).toContain('打开命令中心');
  await record('查找文档', 'j', { ctrlKey: true, shiftKey: true });
  expect(root.querySelector('[role="alert"]')).toBeNull();
});

it('cancels on Escape without closing settings and ignores IME events', async () => {
  const bindings = mountSettings();
  let bubbled = 0;
  root.addEventListener('keydown', () => { bubbled++; });
  const event = await record('立即保存', 'Escape', {});
  expect(event.defaultPrevented).toBe(true);
  expect(bubbled).toBe(0);
  expect(bindings.value.save).toBe('Mod+S');
  expect(button('设置立即保存快捷键').getAttribute('aria-pressed')).toBe('false');
  expect(document.activeElement).not.toBe(button('设置立即保存快捷键'));
  await record('立即保存', 'p', { ctrlKey: true, isComposing: true });
  expect(bindings.value.save).toBe('Mod+S');
});

it('clears, restores individual bindings, and restores all defaults', async () => {
  const bindings = mountSettings();
  button('清除立即保存快捷键').click(); await nextTick();
  expect(bindings.value.save).toBeNull();
  expect(button('设置立即保存快捷键').textContent).toBe('未设置');
  await record('查找文档', 's', { ctrlKey: true });
  button('恢复立即保存默认快捷键').click(); await nextTick();
  expect(bindings.value.save).toBeNull();
  expect(root.querySelector('[role="alert"]')!.textContent).toContain('查找文档');
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes('恢复全部默认'))!.click();
  await nextTick();
  expect(bindings.value).toEqual(defaultShortcutBindings);
  await record('查找文档', 'j', { ctrlKey: true, shiftKey: true });
  button('恢复查找文档默认快捷键').click(); await nextTick();
  expect(bindings.value.findDocument).toBe('Mod+K');
});
