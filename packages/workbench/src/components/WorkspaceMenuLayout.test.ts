// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import type { App } from 'vue';
import WorkspaceMenuLayout from './WorkspaceMenuLayout.vue';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount() {
  root = document.createElement('div');
  root.className = 'workspace-dropdown';
  document.body.append(root);
  const openSettings = vi.fn();
  const importAction = vi.fn();
  app = createApp({ render: () => h(WorkspaceMenuLayout, {
    actions: { openSettings, closeMenus: vi.fn(), createWorkspace: vi.fn(), showDiff: vi.fn() },
  }, {
    default: () => [
      h('button', { disabled: true }, '不可用操作'),
      h('button', { onClick: importAction }, '导入'),
      h('button', {}, '文档模板'),
    ],
    workspaces: () => h('button', {}, '本地工作区'),
  }) });
  app.mount(root);
  await nextTick();
  return { trigger: root.querySelector<HTMLButtonElement>('.workspace-more-trigger')!, openSettings, importAction };
}
const menu = () => document.querySelector<HTMLElement>('[aria-label="更多工作区操作"]');
const key = (element: HTMLElement, value: string) => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));

it('keeps workspace switching and settings in the primary menu and opens actions on demand', async () => {
  const { trigger, openSettings, importAction } = await mount();
  expect(root.textContent).not.toContain('导入');
  expect(root.textContent).toContain('本地工作区');
  expect(root.querySelector('button')!.textContent).toBe('本地工作区');
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '设置')!.click();
  expect(openSettings).toHaveBeenCalledOnce();
  trigger.click();
  await nextTick();
  expect(menu()).not.toBeNull();
  const items = menu()!.querySelectorAll<HTMLButtonElement>('button');
  items[0].click();
  await nextTick();
  expect(menu()).not.toBeNull();
  items[1].click();
  await nextTick();
  expect(importAction).toHaveBeenCalledOnce();
  expect(menu()).toBeNull();
});

it('navigates enabled actions with the keyboard and dismisses only the submenu on Escape', async () => {
  const { trigger } = await mount();
  key(trigger, 'ArrowRight');
  await nextTick();
  await nextTick();
  const items = menu()!.querySelectorAll<HTMLButtonElement>('button');
  expect(document.activeElement).toBe(items[1]);
  key(items[1], 'ArrowUp');
  expect(document.activeElement).toBe(items[2]);
  key(items[2], 'Home');
  expect(document.activeElement).toBe(items[1]);
  key(items[1], 'Escape');
  await nextTick();
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(root.textContent).toContain('本地工作区');
});

it('closes on outside focus and removes its teleported menu on unmount', async () => {
  const { trigger } = await mount();
  trigger.click();
  await nextTick();
  await nextTick();
  root.querySelector<HTMLButtonElement>('button')!.focus();
  await nextTick();
  expect(menu()).toBeNull();
  trigger.click();
  await nextTick();
  expect(menu()).not.toBeNull();
  app!.unmount();
  app = undefined;
  expect(menu()).toBeNull();
});

it('keeps the submenu within a narrow viewport', async () => {
  const { trigger } = await mount();
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 15, top: 460, right: 280, bottom: 490 } as DOMRect);
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 8, top: 400, right: 288, bottom: 550 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 232, height: 200 } as DOMRect);
  vi.stubGlobal('innerWidth', 320);
  vi.stubGlobal('innerHeight', 600);
  trigger.click();
  await nextTick();
  await nextTick();
  expect(menu()!.style.left).toBe('8px');
  expect(menu()!.style.top).toBe('392px');
  vi.unstubAllGlobals();
});
