// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import AppTooltip from './AppTooltip.vue';
import WorkspaceBreadcrumb from './WorkspaceBreadcrumb.vue';

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
it('shares editor link hints, updates Wiki targets, and hides hints while editing Wiki source', async () => {
  const prose = document.createElement('div');
  prose.className = 'tano-prose';
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Target';
  link.getClientRects = button.getClientRects;
  prose.append(link);
  document.body.append(prose);
  try {
    link.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250); await flush();
    expect(hint()?.textContent).toBe('Ctrl/⌘ + 点击跳转');
    link.className = 'tano-wiki-link';
    link.dataset.markdownSource = '[[Target]]';
    await flush();
    expect(hint()?.textContent).toBe('[[Target]] · Ctrl/⌘ + 点击跳转');
    link.classList.add('tano-live-wiki');
    await flush();
    expect(hint()).toBeNull();
    expect(link.hasAttribute('aria-describedby')).toBe(false);
  } finally { prose.remove(); }
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

it('does not reopen hints when a pointer selection restores breadcrumb focus', async () => {
  const navigationRoot = document.createElement('div');
  document.body.append(navigationRoot);
  const navigation = createApp({ render: () => h(WorkspaceBreadcrumb, {
    workspaceId: 'workspace', workspaceName: 'Workspace', path: 'folder/old.md',
    entries: [
      { id: 'folder', path: 'folder', name: 'folder', kind: 'directory', size: 0, modified: 0 },
      { id: 'new', path: 'folder/new.md', name: 'new.md', kind: 'file', size: 0, modified: 0 },
    ],
  }) });
  navigation.mount(navigationRoot);
  try {
    const trigger = navigationRoot.querySelector<HTMLButtonElement>('[data-tooltip="folder"]')!;
    trigger.getClientRects = button.getClientRects;
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click(); await flush();
    const row = document.querySelector<HTMLButtonElement>('[data-path="folder/new.md"]')!;
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    row.click(); await flush();
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('.breadcrumb-menu')).toBeNull();
    await vi.advanceTimersByTimeAsync(300); await flush();
    expect(hint()).toBeNull();

    trigger.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250); await flush();
    expect(hint()?.textContent).toBe('folder');
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    trigger.focus(); await flush();
    expect(hint()?.textContent).toBe('folder');
  } finally {
    navigation.unmount(); navigationRoot.remove();
  }
});
