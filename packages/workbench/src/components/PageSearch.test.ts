// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import PageSearch from './PageSearch.vue';
import { defaultShortcutBindings } from '../shortcuts';
import type { ShortcutBindings } from '../shortcuts';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => {
  app?.unmount();
  root?.remove();
});

async function mountSearch(shortcuts: ShortcutBindings = defaultShortcutBindings) {
  root = document.createElement('div');
  document.body.append(root);
  const bar = ref<InstanceType<typeof PageSearch>>();
  const readonly = ref(false);
  const editor = {
    search: vi.fn(() => 2),
    searchSelection: () => '同页',
    focus: vi.fn(),
    replaceSearch: vi.fn(() => ({ replaced: 1, index: 1 })),
  };
  app = createApp({
    render: () =>
      h(PageSearch, { ref: bar, editor, content: '同页 同页', readonly: readonly.value, shortcuts }),
  });
  app.mount(root);
  await bar.value!.open(true);
  return {
    bar,
    readonly,
    editor,
    replacement: root.querySelector<HTMLInputElement>('[aria-label="替换为"]')!,
  };
}

it('does not replace while Enter confirms an IME candidate', async () => {
  const { editor, replacement } = await mountSearch();
  replacement.value = '一起';
  replacement.dispatchEvent(new Event('input', { bubbles: true }));
  replacement.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  replacement.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }),
  );
  expect(editor.replaceSearch).not.toHaveBeenCalled();
  replacement.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await nextTick();
  expect(editor.replaceSearch).toHaveBeenCalledWith('同页', '一起', 0);
});

it('disables replacement controls for readonly documents while keeping search available', async () => {
  const { readonly, editor, replacement, bar } = await mountSearch();
  readonly.value = true;
  await nextTick();
  expect(replacement.disabled).toBe(true);
  expect(root.querySelector<HTMLButtonElement>('.replace-all')!.disabled).toBe(true);
  expect(root.querySelector<HTMLButtonElement>('.replace-current')!.disabled).toBe(true);
  expect(root.querySelector<HTMLInputElement>('[aria-label="在当前页面中查找"]')!.disabled).toBe(
    false,
  );
  bar.value!.close();
  expect(editor.search).toHaveBeenLastCalledWith('', 0, false);
  expect(editor.focus).toHaveBeenCalled();
});

it('keeps native Enter activation available on search and replacement buttons', async () => {
  await mountSearch();
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
});

it('uses configured navigation and close shortcuts without retaining old defaults', async () => {
  const { editor, bar } = await mountSearch({
    ...defaultShortcutBindings, nextMatch: 'Alt+J', previousMatch: 'Alt+K', closeSearch: 'Mod+Shift+X',
  });
  const input = root.querySelector<HTMLInputElement>('[aria-label="在当前页面中查找"]')!;
  const press = (key: string, options: KeyboardEventInit = {}) => input.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
  );
  editor.search.mockClear();
  press('Enter'); expect(editor.search).not.toHaveBeenCalled();
  press('j', { altKey: true }); expect(editor.search).toHaveBeenLastCalledWith('同页', 1, true);
  press('k', { altKey: true }); expect(editor.search).toHaveBeenLastCalledWith('同页', 0, true);
  press('Escape'); expect(bar.value!.isOpen()).toBe(true);
  press('x', { metaKey: true, shiftKey: true }); expect(bar.value!.isOpen()).toBe(false);
  expect(editor.focus).toHaveBeenCalled();
});
