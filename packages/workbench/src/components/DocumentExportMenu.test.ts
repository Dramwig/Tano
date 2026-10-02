// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import type { App } from 'vue';
import DocumentExportMenu from './DocumentExportMenu.vue';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.useRealTimers(); });

async function mount(disabled = false) {
  root = document.createElement('div');
  root.className = 'document-dropdown';
  document.body.append(root);
  const select = vi.fn();
  app = createApp({ render: () => h(DocumentExportMenu, { disabled, onSelect: select }) });
  app.mount(root);
  await nextTick();
  const trigger = root.querySelector('button')!;
  return { trigger, select };
}

it('opens on hover, stays open on click, and exports only the four supported formats', async () => {
  const { trigger, select } = await mount();
  trigger.dispatchEvent(new Event('pointerenter'));
  await nextTick();
  trigger.click();
  await nextTick();
  const panel = document.querySelector('[aria-label="导出格式"]')!;
  expect([...panel.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Markdown', 'PDF', 'HTML', '图片']);
  (panel.querySelectorAll('button')[2] as HTMLButtonElement).click();
  await nextTick();
  expect(select).toHaveBeenCalledWith('html');
  expect(document.querySelector('[aria-label="导出格式"]')).toBeNull();
});

it.each(['click', 'keyboard'])('opens with no selected format via %s and selects Markdown on the first ArrowDown', async (method) => {
  const { trigger } = await mount();
  if (method === 'click') trigger.click();
  else trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await nextTick();
  const panel = document.querySelector<HTMLElement>('[aria-label="导出格式"]')!;
  const items = document.querySelectorAll<HTMLButtonElement>('[aria-label="导出格式"] button');
  expect(document.activeElement).toBe(panel);
  expect([...items].some(item => item === document.activeElement)).toBe(false);
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(items[0]);
  items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  expect(document.activeElement).toBe(items[3]);
  items[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('allows crossing the gap between menus and closes after leaving both', async () => {
  vi.useFakeTimers();
  const { trigger } = await mount();
  trigger.dispatchEvent(new Event('pointerenter'));
  await nextTick();
  trigger.dispatchEvent(new Event('pointerleave'));
  const panel = document.querySelector('[aria-label="导出格式"]')!;
  panel.dispatchEvent(new Event('pointerenter'));
  vi.advanceTimersByTime(200);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  panel.dispatchEvent(new Event('pointerleave'));
  vi.advanceTimersByTime(200);
  await nextTick();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('keeps disabled exports closed', async () => {
  const { trigger } = await mount(true);
  trigger.dispatchEvent(new Event('pointerenter'));
  trigger.click();
  await nextTick();
  expect(document.querySelector('[aria-label="导出格式"]')).toBeNull();
});
