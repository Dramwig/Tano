// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import DesktopTabs from './DesktopTabs.vue';

const fixture = vi.hoisted(() => ({ store: null as any }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
let app: App;
let root: HTMLDivElement;
let buttons: HTMLButtonElement[];

function pointer(target: HTMLElement, type: string, x: number, y = 18) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  target.dispatchEvent(event);
}

beforeEach(() => {
  fixture.store = reactive({
    documents: ['a', 'b', 'c'].map((id) => ({ id, path: `${id}.md` })),
    tabs: ['a', 'b', 'c'].map((id) => ({
      id,
      path: `${id}.md`,
      blank: false,
      document: { id, path: `${id}.md` },
    })),
    activeId: 'b',
    workspace: {},
    dirty: () => false,
    moveDocument: vi.fn(),
    close: vi.fn(),
  });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  root = document.createElement('div');
  root.innerHTML =
    '<header class="desktop-window-titlebar"><div class="desktop-window-tab-slot"></div><div class="desktop-window-drag"></div></header>';
  document.body.append(root);
  app = createApp(DesktopTabs);
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const list = root.querySelector<HTMLElement>('.desktop-tab-list')!;
  list.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 36 }) as DOMRect;
  root.querySelectorAll<HTMLElement>('.desktop-tab').forEach((tab, index) => {
    tab.getBoundingClientRect = () =>
      ({
        left: index * 200,
        right: (index + 1) * 200,
        top: 0,
        bottom: 36,
        width: 200,
        height: 36,
      }) as DOMRect;
  });
  buttons = [...root.querySelectorAll<HTMLButtonElement>('.desktop-tab-switch')];
  for (const button of buttons) {
    button.setPointerCapture = vi.fn();
    button.hasPointerCapture = () => true;
    button.releasePointerCapture = vi.fn();
  }
});

afterEach(() => {
  app.unmount();
  root.remove();
  vi.unstubAllGlobals();
});

it('shows the insertion side and commits only on release, suppressing the trailing click', async () => {
  pointer(buttons[0], 'pointerdown', 80);
  pointer(buttons[0], 'pointermove', 570);
  await nextTick();
  expect(root.querySelector('.desktop-tab-drop-after')?.getAttribute('data-id')).toBe('c');
  expect(fixture.store.moveDocument).not.toHaveBeenCalled();
  pointer(buttons[0], 'pointerup', 570);
  buttons[0].click();
  expect(fixture.store.moveDocument).toHaveBeenCalledExactlyOnceWith('a', 'c', 'after');
  expect(fixture.store.activeId).toBe('b');
  await nextTick();
  expect(root.querySelector('.desktop-tab-dragging')).toBeNull();
});

it('shows the dragged tab under the pointer, including outside the strip, and removes it on cancel', async () => {
  pointer(buttons[0], 'pointerdown', 80);
  pointer(buttons[0], 'pointermove', 82);
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-drag-preview')).toBeNull();

  pointer(buttons[0], 'pointermove', 260, 20);
  await nextTick();
  const preview = document.body.querySelector<HTMLElement>('.desktop-tab-drag-preview')!;
  expect(preview.textContent).toContain('a');
  expect(preview.style.left).toBe('180px');
  expect(preview.style.top).toBe('2px');
  expect(preview.style.width).toBe('200px');

  pointer(buttons[0], 'pointermove', 300, 80);
  await nextTick();
  expect(preview.style.left).toBe('220px');
  expect(preview.style.top).toBe('62px');
  expect(root.querySelector('.desktop-tab-drop-before, .desktop-tab-drop-after')).toBeNull();

  pointer(buttons[0], 'pointercancel', 300, 80);
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-drag-preview')).toBeNull();
  expect(fixture.store.moveDocument).not.toHaveBeenCalled();
});

it('supports dragging to the start and ignores small pointer movements', () => {
  pointer(buttons[2], 'pointerdown', 460);
  pointer(buttons[2], 'pointermove', 20);
  pointer(buttons[2], 'pointerup', 20);
  expect(fixture.store.moveDocument).toHaveBeenCalledWith('c', 'a', 'before');
  fixture.store.moveDocument.mockClear();
  pointer(buttons[1], 'pointerdown', 280);
  pointer(buttons[1], 'pointermove', 282);
  pointer(buttons[1], 'pointerup', 282);
  expect(fixture.store.moveDocument).not.toHaveBeenCalled();
});

it.each(['escape', 'pointercancel', 'lostpointercapture', 'outside'])(
  'cancels a drag on %s without reordering',
  async (reason) => {
    pointer(buttons[0], 'pointerdown', 80);
    pointer(buttons[0], 'pointermove', 570);
    if (reason === 'escape') {
      buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } else if (reason !== 'outside') {
      pointer(buttons[0], reason, 570);
    }
    pointer(buttons[0], 'pointerup', 570, reason === 'outside' ? 80 : 18);
    await nextTick();
    expect(fixture.store.moveDocument).not.toHaveBeenCalled();
    expect(root.querySelector('.desktop-tab-list-dragging')).toBeNull();
  },
);

it('scrolls overflow tabs when the pointer stays near the edge and stops on cancellation', () => {
  pointer(buttons[0], 'pointerdown', 80);
  pointer(buttons[0], 'pointermove', 590);
  const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0];
  frame(0);
  expect(root.querySelector('.desktop-tab-list')!.scrollLeft).toBe(10);
  pointer(buttons[0], 'pointercancel', 590);
  expect(cancelAnimationFrame).toHaveBeenCalled();
});

it('reserves a default width for each open tab', async () => {
  const strip = root.querySelector<HTMLElement>('.desktop-tab-strip')!;
  expect(strip.style.getPropertyValue('--desktop-tab-count')).toBe('3');
  fixture.store.tabs.push({
    id: 'd',
    path: 'd.md',
    blank: false,
    document: { id: 'd', path: 'd.md' },
  });
  await nextTick();
  expect(strip.style.getPropertyValue('--desktop-tab-count')).toBe('4');
});

it('renders and closes an empty tab without treating it as a document', async () => {
  fixture.store.tabs.push({ id: 'blank:test', path: '', blank: true });
  await nextTick();
  const tab = root.querySelector<HTMLElement>('[data-id="blank:test"]')!;
  tab.scrollIntoView = vi.fn();
  expect(tab.textContent).toContain('新标签页');
  expect(tab.querySelector('.desktop-tab-icon')).toBeNull();
  tab.querySelector<HTMLButtonElement>('.desktop-tab-switch')!.click();
  expect(fixture.store.activeId).toBe('blank:test');
  tab.querySelector<HTMLButtonElement>('.desktop-tab-close')!.click();
  expect(fixture.store.close).toHaveBeenCalledWith('blank:test');
});

it('uses the wheel to scroll only when tabs overflow', () => {
  const strip = root.querySelector<HTMLElement>('.desktop-tab-strip')!;
  const list = root.querySelector<HTMLElement>('.desktop-tab-list')!;
  let scrollWidth = 300;
  let scrollLeft = 0;
  Object.defineProperties(list, {
    clientWidth: { get: () => 300 },
    scrollWidth: { get: () => scrollWidth },
    scrollLeft: {
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = Math.max(0, Math.min(value, scrollWidth - 300));
      },
    },
  });

  const noOverflow = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 });
  strip.dispatchEvent(noOverflow);
  expect(scrollLeft).toBe(0);
  expect(noOverflow.defaultPrevented).toBe(false);

  scrollWidth = 480;
  const forward = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 });
  strip.dispatchEvent(forward);
  expect(scrollLeft).toBe(80);
  expect(forward.defaultPrevented).toBe(true);

  const backward = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -40 });
  strip.dispatchEvent(backward);
  expect(scrollLeft).toBe(40);
  expect(backward.defaultPrevented).toBe(true);
});

it('opens tab actions by mouse or keyboard and closes other tabs in order', async () => {
  fixture.store.close = vi.fn(async (id: string) => {
    fixture.store.tabs = fixture.store.tabs.filter((tab: { id: string }) => tab.id !== id);
  });
  const tab = root.querySelector<HTMLElement>('[data-id="b"]')!;
  const rightClick = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 245,
    clientY: 20,
  });
  tab.dispatchEvent(rightClick);
  await nextTick();
  expect(rightClick.defaultPrevented).toBe(true);
  const menu = document.body.querySelector<HTMLElement>('.desktop-tab-context-menu')!;
  expect(menu.getAttribute('aria-label')).toBe('标签页操作');
  expect(menu.textContent).toContain('关闭其他标签页');
  [...menu.querySelectorAll('button')]
    .find((button) => button.textContent?.includes('关闭其他标签页'))!
    .click();
  await vi.waitFor(() => expect(fixture.store.close).toHaveBeenCalledTimes(2));
  expect(vi.mocked(fixture.store.close).mock.calls.map((call: [string]) => call[0])).toEqual([
    'a',
    'c',
  ]);
  expect(fixture.store.activeId).toBe('b');

  buttons[1].dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }),
  );
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-context-menu')?.textContent).toContain(
    '关闭标签页',
  );
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-context-menu')).toBeNull();
});

it('opens blank-track actions without starting window drag', async () => {
  const newTab = vi.fn();
  const newDocument = vi.fn();
  app.unmount();
  app = createApp(DesktopTabs, { onNewTab: newTab, onNewDocument: newDocument });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const track = root.querySelector<HTMLElement>('.desktop-window-drag')!;
  const rightClick = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 640,
    clientY: 20,
  });
  track.dispatchEvent(rightClick);
  await nextTick();
  expect(rightClick.defaultPrevented).toBe(true);
  const menu = document.body.querySelector<HTMLElement>('.desktop-tab-context-menu')!;
  expect(menu.getAttribute('aria-label')).toBe('标签栏操作');
  [...menu.querySelectorAll('button')]
    .find((button) => button.textContent?.includes('新建文档'))!
    .click();
  expect(newDocument).toHaveBeenCalledOnce();
  expect(newTab).not.toHaveBeenCalled();

  track.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  [...document.body.querySelectorAll<HTMLButtonElement>('.desktop-tab-context-menu button')]
    .find((button) => button.textContent?.includes('新建标签页'))!
    .click();
  expect(newTab).toHaveBeenCalledOnce();
});

it('closes only tabs to the right of the clicked tab', async () => {
  fixture.store.close = vi.fn(async (id: string) => {
    fixture.store.tabs = fixture.store.tabs.filter((tab: { id: string }) => tab.id !== id);
  });
  root
    .querySelector<HTMLElement>('[data-id="a"]')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  [...document.body.querySelectorAll<HTMLButtonElement>('.desktop-tab-context-menu button')]
    .find((button) => button.textContent?.includes('关闭右侧标签页'))!
    .click();
  await vi.waitFor(() => expect(fixture.store.close).toHaveBeenCalledTimes(2));
  expect(vi.mocked(fixture.store.close).mock.calls.map((call: [string]) => call[0])).toEqual([
    'b',
    'c',
  ]);
});

it('stops closing tabs when one tab remains open', async () => {
  fixture.store.close = vi.fn(async () => {});
  root
    .querySelector<HTMLElement>('.desktop-window-drag')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  [...document.body.querySelectorAll<HTMLButtonElement>('.desktop-tab-context-menu button')]
    .find((button) => button.textContent?.includes('关闭全部标签页'))!
    .click();
  await vi.waitFor(() => expect(fixture.store.close).toHaveBeenCalledOnce());
  expect(fixture.store.close).toHaveBeenCalledWith('a');
});
