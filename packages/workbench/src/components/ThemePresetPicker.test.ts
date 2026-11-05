// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { AppearanceController } from '../appearance';
import { FileIconRegistry } from '../file-icons/registry';
import { setUiLocale } from '../i18n';
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
const more = () => root.querySelector<HTMLButtonElement>('[aria-label="更多主题"]')!;
const rowIds = () => [...root.querySelectorAll('.theme-preset-quick-row [data-preset-id]')].map(card => card.getAttribute('data-preset-id'));
async function open() { more().click(); await nextTick(); await nextTick(); }

it('keeps one row and swaps the current and previous presets after a selection', async () => {
  expect(root.querySelector('.theme-preset-quick-row')?.children).toHaveLength(3);
  expect(rowIds()).toEqual(['builtin:tano', 'builtin:islands']);
  expect(root.querySelector('.theme-preset-quick-row')?.textContent).toContain('卡片岛');
  expect(root.textContent).not.toMatch(/上次使用|暂无使用记录/);
  expect(root.querySelector('.theme-preset-popover')).toBeNull();
  await open();
  expect(more().getAttribute('aria-expanded')).toBe('true');
  expect([...root.querySelectorAll('.theme-preset-popover [data-preset-id]')].map(card => card.getAttribute('data-preset-id')))
    .toEqual(['builtin:retro', 'builtin:paper']);
  root.querySelector<HTMLButtonElement>('.theme-preset-popover [data-preset-id="builtin:retro"]')!.click();
  await nextTick();
  expect(rowIds()).toEqual(['builtin:retro', 'builtin:tano']);
  expect(root.querySelector('.theme-preset-popover')).toBeNull();
  expect(document.activeElement).toBe(more());
  await open();
  expect([...root.querySelectorAll('.theme-preset-popover [data-preset-id]')].map(card => card.getAttribute('data-preset-id')))
    .toEqual(['builtin:islands', 'builtin:paper']);
  more().click(); await nextTick();
  root.querySelector<HTMLButtonElement>('.theme-preset-quick-row [data-preset-id="builtin:tano"]')!.click();
  await nextTick();
  expect(rowIds()).toEqual(['builtin:tano', 'builtin:retro']);
});

it('closes on Escape without closing settings and restores keyboard focus', async () => {
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

it('previews a custom combination and hides unavailable entries from the previous slot', async () => {
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:retro' });
  controller.select({ workspaceId: 'one', kind: 'shape', id: 'builtin:crisp' });
  await nextTick();
  expect(rowIds()[0]).toBe('current');
  expect(root.querySelector('.theme-preset-quick-row')?.textContent).toContain('当前搭配');
  expect(controller.state.value.currentPreset?.structure).toBe('notebook');
  controller.state.value = { ...controller.state.value, presets: controller.state.value.presets.map(preset => ({ ...preset, unavailable: true })) };
  await nextTick();
  expect(rowIds()).toEqual(['current']);
  expect(root.textContent).not.toMatch(/上次使用|暂无使用记录/);
});
