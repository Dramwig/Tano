// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import AppTooltip from './AppTooltip.vue';

let app: App | undefined;
let root: HTMLElement;
let button: HTMLButtonElement;
const hint = () => document.querySelector<HTMLElement>('.app-tooltip');
async function flush() { await nextTick(); await nextTick(); }
beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  button = document.createElement('button');
  button.dataset.tooltip = '斜体';
  button.dataset.tooltipShortcut = 'Mod+I';
  button.setAttribute('aria-describedby', 'existing');
  button.getBoundingClientRect = () => new DOMRect(20, 200, 30, 30);
  button.getClientRects = () => [button.getBoundingClientRect()] as unknown as DOMRectList;
  document.body.append(root, button);
  app = createApp(AppTooltip);
  app.mount(root);
});
afterEach(() => {
  app?.unmount(); root.remove(); button.remove(); vi.useRealTimers();
});
it('supports delegated hover on disabled controls and preserves existing descriptions', async () => {
  button.disabled = true;
  button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  expect(hint()).toBeNull();
  await vi.advanceTimersByTimeAsync(250); await flush();
  expect(hint()?.textContent).toBe('斜体Ctrl + I');
  expect(button.getAttribute('aria-describedby')).toBe(`existing ${hint()?.id}`);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flush();
  expect(hint()).toBeNull();
  expect(button.getAttribute('aria-describedby')).toBe('existing');
});
it('updates active hints and removes them when a dynamic button is removed', async () => {
  button.focus(); await flush();
  expect(hint()).not.toBeNull();
  button.dataset.tooltip = '新的名称';
  delete button.dataset.tooltipShortcut;
  await flush();
  expect(hint()?.textContent).toBe('新的名称');
  button.remove(); await flush();
  expect(hint()).toBeNull();
  expect(button.getAttribute('aria-describedby')).toBe('existing');
});
it('allows moving into the hint, but dismisses on scroll and unmount', async () => {
  button.focus(); await flush();
  const element = hint()!;
  root.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(150);
  expect(hint()).toBe(element);
  button.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: element }));
  await vi.advanceTimersByTimeAsync(150);
  expect(hint()).toBe(element);
  document.dispatchEvent(new Event('scroll')); await flush();
  expect(hint()).toBeNull();
  button.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await flush();
  app!.unmount(); app = undefined; await flush();
  expect(hint()).toBeNull();
  expect(button.getAttribute('aria-describedby')).toBe('existing');
  button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(300);
  expect(hint()).toBeNull();
});
it('does not show a tooltip for touch input or a hidden control', async () => {
  const touch = new MouseEvent('pointerover', { bubbles: true });
  Object.defineProperty(touch, 'pointerType', { value: 'touch' });
  button.dispatchEvent(touch);
  await vi.advanceTimersByTimeAsync(300);
  expect(hint()).toBeNull();
  button.hidden = true;
  button.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await flush();
  expect(hint()).toBeNull();
});
