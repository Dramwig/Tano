// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import WorkspaceIcon from './WorkspaceIcon.vue';
import { builtinWorkspaceIcons } from '../workspace-icons';

let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
it('renders the expanded built-in catalog as consistently sized unfilled line icons', () => {
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h('div', builtinWorkspaceIcons.map(icon => h(WorkspaceIcon, { icon: icon.value, size: 23, key: icon.value }))) });
  app.mount(root);
  const icons = [...root.querySelectorAll('svg.workspace-default-icon')];
  expect(builtinWorkspaceIcons.length).toBeGreaterThan(300);
  expect(icons).toHaveLength(builtinWorkspaceIcons.length);
  for (const icon of icons) {
    expect(icon.getAttribute('width')).toBe('23');
    expect(icon.getAttribute('height')).toBe('23');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
  }
  expect(root.querySelector('[class*="lucide-cpu"]')).not.toBeNull();
  expect(root.querySelector('[class*="lucide-stethoscope"]')).not.toBeNull();
  expect(root.querySelector('.workspace-emoji-icon, img')).toBeNull();
});
it('uses one local colored sprite at the requested size and preserves other icon formats', async () => {
  const icon = ref('🌙');
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(WorkspaceIcon, { icon: icon.value, size: 28 }) }); app.mount(root);
  const moon = root.querySelector<HTMLElement>('.workspace-emoji-sprite')!;
  expect(moon.style.backgroundImage).toContain('sprite.webp');
  expect(root.querySelector('img')).toBeNull();
  const image = moon.style.backgroundImage;
  const position = moon.style.backgroundPosition;
  expect(root.querySelector<HTMLElement>('.workspace-emoji-icon')?.style.fontSize).toBe('28px');
  icon.value = '🧑‍🔬'; await nextTick();
  const scientist = root.querySelector<HTMLElement>('.workspace-emoji-sprite')!;
  expect(scientist.style.backgroundImage).toBe(image);
  expect(scientist.style.backgroundPosition).not.toBe(position);
  expect(root.querySelector('.workspace-emoji-icon')?.getAttribute('data-emoji')).toBe('🧑‍🔬');
  icon.value = '🌙🌿'; await nextTick();
  expect(root.textContent).toBe('🌙🌿'); expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('.workspace-emoji-sprite')).toBeNull();
  icon.value = 'icon:book'; await nextTick();
  expect(root.querySelector('svg')).not.toBeNull(); expect(root.querySelector('img')).toBeNull();
  icon.value = 'data:image/png;base64,aGVsbG8='; await nextTick();
  expect(root.querySelector('img')?.getAttribute('src')).toBe(icon.value);
  expect(root.querySelector('.workspace-custom-icon')).not.toBeNull();
});
