// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import type { App } from 'vue';
import ButtonVisibilityGroup from './ButtonVisibilityGroup.vue';

const preferenceKey = 'tano.preference.documentHiddenTools';
const items = [
  { id: 'annotation', label: '局部批注' },
  { id: 'markdown-reveal', label: '光标展开源码' },
  { id: 'source-mode', label: '源码模式' },
];
let app: App;
let root: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({
    render: () =>
      ['pane-one', 'pane-two', 'sidebar'].map((label) =>
        h(
          ButtonVisibilityGroup,
          {
            items,
            label,
            menuLabel: `${label} settings`,
            preferenceKey:
              label === 'sidebar' ? 'tano.preference.sidebarHiddenViews' : preferenceKey,
          },
          {
            default: ({ isVisible }: { isVisible: (id: string) => boolean }) =>
              items
                .filter((item) => isVisible(item.id))
                .map((item) => h('button', { 'data-tool': item.id }, item.label)),
          },
        ),
      ),
  });
  app.mount(root);
});
afterEach(() => {
  app.unmount();
  root.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function toggle(id: string) {
  root
    .querySelector('[aria-label="pane-one"]')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
  ].find((button) => button.textContent === items.find((item) => item.id === id)?.label)!;
  button.click();
  await nextTick();
}

it('updates all panes immediately while keeping sidebar preferences independent', async () => {
  await toggle('annotation');
  for (const label of ['pane-one', 'pane-two']) {
    expect(root.querySelector(`[aria-label="${label}"] [data-tool="annotation"]`)).toBeNull();
  }
  expect(root.querySelector('[aria-label="sidebar"] [data-tool="annotation"]')).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(preferenceKey)!)).toEqual(['annotation']);
  expect(localStorage.getItem('tano.preference.sidebarHiddenViews')).toBeNull();
  await toggle('annotation');
  expect(root.querySelectorAll('[data-tool="annotation"]')).toHaveLength(3);
});

it('shares session preferences between panes when storage cannot be written', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('unavailable');
  });
  for (const item of items) await toggle(item.id);
  expect(root.querySelector('[aria-label="pane-one"]')!.children).toHaveLength(0);
  expect(root.querySelector('[aria-label="pane-two"]')!.children).toHaveLength(0);
  expect(root.querySelector('[aria-label="sidebar"]')!.children).toHaveLength(3);
  await toggle('source-mode');
  expect(root.querySelectorAll('[data-tool="source-mode"]')).toHaveLength(3);
});

it('opens from nested header content and restores controls from an empty header', async () => {
  app.unmount();
  const headerItems = [
    { id: 'back', label: '后退' },
    { id: 'breadcrumb', label: '面包屑' },
  ];
  app = createApp({
    render: () =>
      h(
        ButtonVisibilityGroup,
        {
          items: headerItems,
          tag: 'header',
          label: '文档顶部栏',
          menuLabel: '顶部栏显示设置',
          preferenceKey,
        },
        {
          default: ({ isVisible }: { isVisible: (id: string) => boolean }) => [
            isVisible('back') ? h('div', [h('button', { disabled: true }, '后退')]) : null,
            isVisible('breadcrumb') ? h('nav', [h('span', '项目 / 笔记')]) : null,
          ],
        },
      ),
  });
  app.mount(root);
  const header = root.querySelector('header')!;
  const openFrom = async (target: Element) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
  };
  let menuButtons = await openFrom(header.querySelector('span')!);
  expect(menuButtons.map((button) => button.textContent)).toEqual(['后退', '面包屑']);
  menuButtons[1].click();
  await nextTick();
  expect(header.querySelector('nav')).toBeNull();
  menuButtons = await openFrom(header.querySelector('button')!);
  menuButtons[0].click();
  await nextTick();
  expect(header.textContent).toBe('');
  expect(document.activeElement).toBe(header);
  menuButtons = await openFrom(header);
  expect(menuButtons.every((button) => button.getAttribute('aria-checked') === 'false')).toBe(true);
  menuButtons[1].click();
  await nextTick();
  expect(header.querySelector('nav')?.textContent).toBe('项目 / 笔记');
});
