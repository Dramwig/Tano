// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import type { App } from 'vue';
import SidebarNavigation from './SidebarNavigation.vue';

const preferenceKey = 'tano.preference.sidebarHiddenViews';
const items = [
  { id: 'repository', label: '仓库' },
  { id: 'plan', label: '计划' },
  { id: 'view:discussion', label: '讨论' },
];
let app: App;
let root: HTMLElement;
const onOpen = vi.fn();

function mount() {
  app = createApp({
    render: () => h(SidebarNavigation, { items, onOpen }, {
      default: ({ isVisible }: { isVisible: (id: string) => boolean }) =>
        items.filter(item => isVisible(item.id)).map(item =>
          h('button', { 'data-view': item.id }, item.label)),
    }),
  });
  app.mount(root);
}
async function open(target = root.querySelector('nav')!, x = 40, y = 80) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(event);
  await nextTick();
  expect(event.defaultPrevented).toBe(true);
}
function menuItems() {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
}
function key(target: Element, value: string, shiftKey = false) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  localStorage.clear();
  onOpen.mockClear();
  root = document.createElement('div');
  document.body.append(root);
  mount();
});
afterEach(() => {
  app.unmount();
  root.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

it('opens from buttons and blank space with checked built-in and extension items', async () => {
  await open(root.querySelector('button')!);
  expect(onOpen).toHaveBeenCalledOnce();
  expect(menuItems().map(item => item.textContent)).toEqual(['仓库', '计划', '讨论']);
  expect(menuItems().every(item => item.getAttribute('aria-checked') === 'true')).toBe(true);
  expect(document.activeElement).toBe(menuItems()[0]);
  key(menuItems()[0], 'Escape');
  await nextTick();
  expect(menuItems()).toHaveLength(0);
  await open();
  expect(menuItems()).toHaveLength(3);
});

it('hides buttons, restores the preference after remount, and can show them again', async () => {
  await open();
  menuItems()[2].click();
  await nextTick();
  expect(root.querySelector('[data-view="view:discussion"]')).toBeNull();
  expect(menuItems()).toHaveLength(0);
  expect(JSON.parse(localStorage.getItem(preferenceKey)!)).toEqual(['view:discussion']);
  app.unmount();
  mount();
  expect(root.querySelector('[data-view="view:discussion"]')).toBeNull();
  await open();
  expect(menuItems()[2].getAttribute('aria-checked')).toBe('false');
  menuItems()[2].click();
  await nextTick();
  expect(root.querySelector('[data-view="view:discussion"]')).not.toBeNull();
});

it('keeps the navigation accessible when every button is hidden', async () => {
  for (let index = 0; index < items.length; index++) {
    await open();
    menuItems()[index].click();
    await nextTick();
  }
  expect(root.querySelectorAll('button')).toHaveLength(0);
  expect(document.activeElement).toBe(root.querySelector('nav'));
  key(root.querySelector('nav')!, 'F10', true);
  await nextTick();
  expect(menuItems().every(item => item.getAttribute('aria-checked') === 'false')).toBe(true);
  menuItems()[0].click();
  await nextTick();
  expect(root.querySelector('[data-view="repository"]')).not.toBeNull();
});

it('supports arrow navigation and escape focus restoration', async () => {
  const trigger = root.querySelector('button')!;
  key(trigger, 'ContextMenu');
  await nextTick();
  key(menuItems()[0], 'ArrowUp');
  expect(document.activeElement).toBe(menuItems()[2]);
  key(menuItems()[2], 'Home');
  expect(document.activeElement).toBe(menuItems()[0]);
  key(menuItems()[0], 'End');
  expect(document.activeElement).toBe(menuItems()[2]);
  key(menuItems()[2], 'Escape');
  await nextTick();
  expect(menuItems()).toHaveLength(0);
  expect(document.activeElement).toBe(trigger);
});

it('dismisses on outside input, scroll, and resize and clamps to the viewport', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(184);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(90);
  await open(undefined, window.innerWidth - 1, window.innerHeight - 1);
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu.style.left).toBe(`${window.innerWidth - 192}px`);
  expect(menu.style.top).toBe(`${window.innerHeight - 98}px`);
  for (const event of ['pointerdown', 'contextmenu', 'scroll', 'resize']) {
    await open();
    const target = event === 'pointerdown' || event === 'contextmenu' ? document.body : window;
    target.dispatchEvent(new Event(event));
    await nextTick();
    expect(menuItems()).toHaveLength(0);
  }
});

it('syncs other windows and handles unavailable or malformed device storage', async () => {
  localStorage.setItem(preferenceKey, JSON.stringify(['plan']));
  window.dispatchEvent(new StorageEvent('storage', { key: preferenceKey }));
  await nextTick();
  expect(root.querySelector('[data-view="plan"]')).toBeNull();
  localStorage.setItem(preferenceKey, 'invalid');
  window.dispatchEvent(new StorageEvent('storage', { key: preferenceKey }));
  await nextTick();
  expect(root.querySelector('[data-view="plan"]')).not.toBeNull();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  await open();
  menuItems()[1].click();
  await nextTick();
  expect(root.querySelector('[data-view="plan"]')).toBeNull();
});
