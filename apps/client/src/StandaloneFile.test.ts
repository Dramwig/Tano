// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { printDocument } from '@tano/workbench/document-print';
import StandaloneFile from './StandaloneFile.vue';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  label: 'file-print-test', onCloseRequested: async () => () => {}, onFocusChanged: async () => () => {},
}) }));
vi.mock('@tano/workbench/document-print', () => ({ printDocument: vi.fn() }));
vi.mock('@tano/editor', async () => {
  const { defineComponent, h } = await import('vue');
  return { default: defineComponent({ props: ['modelValue'], emits: ['update:modelValue'],
    setup: (props, { emit }) => () => h('textarea', { value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) }),
  }) };
});
vi.mock('@tano/workbench/components/SourceEditor.vue', async () => ({ default: (await import('@tano/editor')).default }));

let app: App | undefined;
afterEach(() => { app?.unmount(); document.body.replaceChildren(); localStorage.clear(); vi.clearAllMocks(); });
async function mount() {
  vi.mocked(invoke).mockResolvedValue({ path: 'C:/notes/测试.md', snapshot: { content: '初始正文', hash: 'base', modified: 1 } });
  vi.mocked(printDocument).mockResolvedValue();
  const host = document.createElement('div'); document.body.append(host);
  app = createApp(StandaloneFile); app.mount(host);
  await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe('初始正文'));
  return host;
}
function key(key: string, modifiers: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...modifiers });
  window.dispatchEvent(event); return event;
}

it('prints the current standalone draft with Ctrl+P without saving it to disk', async () => {
  const host = await mount();
  const editor = host.querySelector('textarea')!;
  editor.value = '当前未保存正文'; editor.dispatchEvent(new Event('input')); await nextTick();
  expect(key('p', { ctrlKey: true }).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(printDocument).toHaveBeenCalledWith(expect.objectContaining({ content: '当前未保存正文', title: '测试', path: 'C:/notes/测试.md' })));
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('standalone_read');
});

it('supports custom print bindings in source mode and recovers from a failed print', async () => {
  localStorage.setItem('tano.preference.shortcuts', JSON.stringify({ print: 'Alt+P' }));
  const host = await mount();
  [...host.querySelectorAll('button')].find(button => button.textContent === '源码')!.click(); await nextTick();
  vi.mocked(printDocument).mockRejectedValueOnce(new Error('测试错误'));
  expect(key('p', { altKey: true }).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('打印失败：测试错误'));
  const print = host.querySelector<HTMLButtonElement>('.standalone-print')!;
  expect(print.disabled).toBe(false);
  expect(print.getAttribute('aria-keyshortcuts')).toBe('Alt+P');
  print.click();
  await vi.waitFor(() => expect(printDocument).toHaveBeenCalledTimes(2));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
