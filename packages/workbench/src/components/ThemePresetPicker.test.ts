// @vitest-environment jsdom
import { beforeAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { AppearanceController } from '../appearance';
import { FileIconRegistry } from '../file-icons/registry';
import { setUiLocale, preloadUiLocale } from '../i18n';
import ThemePresetPicker from './ThemePresetPicker.vue';

let app: App;
let root: HTMLElement;
let controller: AppearanceController;
beforeEach(() => {
  localStorage.clear();
  setUiLocale('zh-CN');
  controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage, vi.fn());
  controller.sync('one', []);
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(ThemePresetPicker, { appearance: controller.state.value, onSelect: selection => controller.select(selection) }));
  app.mount(root);
});
afterEach(() => { app.unmount(); root.remove(); controller.dispose(); localStorage.clear(); });
const more = () => root.querySelector<HTMLButtonElement>('button[aria-label="更多主题"]')!;
const rowIds = () => [...root.querySelectorAll('.theme-preset-quick-row [data-preset-id]')].map(card => card.getAttribute('data-preset-id'));
async function open() { more().click(); await nextTick(); await nextTick(); }

const pressed = () => [...root.querySelectorAll('.theme-preset-quick-row [aria-pressed="true"]')].map(card => card.getAttribute('data-preset-id'));

it('lists every preset in catalog order without a collapsed panel when they fit in one row', async () => {
  expect(rowIds()).toEqual(['builtin:tano', 'builtin:islands', 'builtin:paper']);
  expect(pressed()).toEqual(['builtin:tano']);
  expect(more()).toBeNull();
  expect(root.querySelector('.theme-preset-quick-row')?.textContent).toContain('纸感');
  expect(root.textContent).not.toMatch(/复古拟物|上次使用|暂无使用记录/);
  root.querySelector<HTMLButtonElement>('.theme-preset-quick-row [data-preset-id="builtin:paper"]')!.click();
  await nextTick();
  expect(rowIds()).toEqual(['builtin:tano', 'builtin:islands', 'builtin:paper']);
  expect(pressed()).toEqual(['builtin:paper']);
  expect(more()).toBeNull();
});

async function customize() {
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:paper' });
  controller.select({ workspaceId: 'one', kind: 'shape', id: 'builtin:crisp' });
  await nextTick();
}

it('collapses into current, previous and more once the choices no longer fit', async () => {
  await customize();
  expect(root.querySelector('.theme-preset-quick-row')?.children).toHaveLength(3);
  expect(rowIds()).toEqual(['current', 'builtin:paper']);
  expect(root.querySelector('.theme-preset-quick-row')?.textContent).toContain('当前搭配');
  expect(controller.state.value.currentPreset?.structure).toBe('document');
  await open();
  expect(more().getAttribute('aria-expanded')).toBe('true');
  expect([...root.querySelectorAll('.theme-preset-popover [data-preset-id]')].map(card => card.getAttribute('data-preset-id')))
    .toEqual(['builtin:tano', 'builtin:islands']);
  root.querySelector<HTMLButtonElement>('.theme-preset-popover [data-preset-id="builtin:islands"]')!.click();
  await nextTick();
  expect(root.querySelector('.theme-preset-popover')).toBeNull();
  expect(rowIds()).toEqual(['builtin:tano', 'builtin:islands', 'builtin:paper']);
  expect(pressed()).toEqual(['builtin:islands']);
});

it('closes on Escape without closing settings and restores keyboard focus', async () => {
  await customize();
  await open();
  const bubbled = vi.fn();
  root.addEventListener('keydown', bubbled);
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  root.querySelector('.theme-preset-popover')!.dispatchEvent(event);
  await nextTick();
  expect(root.querySelector('.theme-preset-popover')).toBeNull();
  expect(bubbled).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(more());
});

it('hides unavailable entries from the previous slot of a custom combination', async () => {
  await customize();
  controller.state.value = { ...controller.state.value, presets: [...controller.state.value.presets,
    { id: 'plugin:extra', label: '额外', selected: { layout: 'builtin:islands' } }].map(preset => ({ ...preset, unavailable: true })) };
  await nextTick();
  expect(rowIds()).toEqual(['current']);
  expect(more()).not.toBeNull();
  expect(root.textContent).not.toMatch(/上次使用|暂无使用记录/);
});

beforeAll(async () => {
  const { uiLocales } = await import('../locale');
  await Promise.all(uiLocales.map(preloadUiLocale));
});
