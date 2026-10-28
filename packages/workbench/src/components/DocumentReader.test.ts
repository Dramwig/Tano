// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import DocumentReader from './DocumentReader.vue';
let app: App | undefined;
afterEach(() => { app?.unmount(); document.body.replaceChildren(); });
it('scrolls to continuous pages and tracks wheel scrolling without resetting the viewport', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const page = ref(1);
  app = createApp(() => h(DocumentReader, { continuous: true, page: page.value, count: 3, 'onUpdate:page': (value: number) => { page.value = value; } }, {
    default: () => [1, 2, 3].map(index => h('article', { 'data-reader-page': index }, `Page ${index}`)),
  }));
  app.mount(root);
  const viewport = root.querySelector<HTMLElement>('.reader-viewport')!;
  viewport.getBoundingClientRect = () => ({ top: 0, height: 800 } as DOMRect);
  root.querySelectorAll<HTMLElement>('article').forEach((element, index) => {
    element.getBoundingClientRect = () => ({ top: 24 + index * 1100 - viewport.scrollTop, bottom: 1100 + index * 1100 - viewport.scrollTop } as DOMRect);
  });
  root.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click(); await nextTick();
  expect(page.value).toBe(2); expect(viewport.scrollTop).toBe(1100);
  viewport.scrollTop = 2300; viewport.dispatchEvent(new Event('scroll'));
  await vi.waitFor(() => expect(page.value).toBe(3));
  expect(viewport.scrollTop).toBe(2300);
  root.querySelector<HTMLButtonElement>('[aria-label="上一页"]')!.click(); await nextTick();
  expect(page.value).toBe(2); expect(viewport.scrollTop).toBe(1100);
  expect(root.querySelectorAll('article')).toHaveLength(3);
});
function mount(controlsTarget?: string) {
  const root = document.createElement('div'); document.body.append(root);
  const page = ref(1);
  app = createApp(() => h(DocumentReader, { controlsTarget, page: page.value, count: 3, navigation: ['First', 'Second', 'Third'], note: 'Reading layout only', 'onUpdate:page': (value: number) => { page.value = value; } }, { default: ({ scale }: { scale: number }) => h('article', { 'data-scale': scale }, 'Document content') }));
  app.mount(root); return { root, page };
}
it('navigates by toolbar, page list and viewport keyboard, resetting vertical scroll', async () => {
  const { root, page } = mount();
  const viewport = root.querySelector<HTMLElement>('.reader-viewport')!;
  viewport.scrollTop = 800;
  root.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click(); await nextTick();
  expect(page.value).toBe(2); expect(viewport.scrollTop).toBe(0);
  root.querySelector<HTMLButtonElement>('[aria-label="切换页面导航"]')!.click(); await nextTick();
  expect(root.querySelector('[aria-current="page"]')?.textContent).toContain('Second');
  root.querySelectorAll<HTMLButtonElement>('.reader-page-link')[2].click(); await nextTick();
  expect(page.value).toBe(3); expect(root.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.disabled).toBe(true);
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await nextTick(); expect(page.value).toBe(1);
  root.querySelector('select')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await nextTick(); expect(page.value).toBe(1);
});
it('folds controls into the pane header, restores focus on Escape and removes them on unmount', async () => {
  const host = document.createElement('header'); host.id = 'preview-header'; document.body.append(host);
  const { root, page } = mount('#preview-header'); await nextTick();
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="预览操作"]')!;
  expect(trigger).not.toBeNull(); expect(root.querySelector('.reader-toolbar')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  trigger.click(); await nextTick(); await nextTick();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull(); expect(dialog.contains(document.activeElement)).toBe(true);
  dialog.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click(); await nextTick(); expect(page.value).toBe(2);
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
  trigger.click(); await nextTick();
  root.querySelector('article')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  trigger.click(); await nextTick(); app!.unmount(); app = undefined;
  expect(host.childElementCount).toBe(0); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('changes content zoom and keeps the long reading note out of the canvas until requested', async () => {
  const { root } = mount();
  expect(root.querySelector('[role="note"]')).toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="预览说明"]')!.click(); await nextTick();
  expect(root.querySelector('[role="note"]')?.textContent).toBe('Reading layout only');
  const picker = root.querySelector<HTMLSelectElement>('[aria-label="预览缩放"]')!;
  picker.value = '2'; picker.dispatchEvent(new Event('change')); await nextTick();
  expect(root.querySelector('article')?.getAttribute('data-scale')).toBe('2');
  root.querySelector<HTMLButtonElement>('[aria-label="缩小"]')!.click(); await nextTick();
  expect(Number(root.querySelector('article')?.getAttribute('data-scale'))).toBeCloseTo(1.9);
  root.querySelector<HTMLButtonElement>('[aria-label="适合宽度"]')!.click(); await nextTick();
  expect(picker.value).toBe('width');
});
it('keeps controls and page changes scoped to their own split pane', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const pages = ref([1, 1]);
  app = createApp(() => h('div', [0, 1].map(index => h('section', [
    h('header', { id: `pane-header-${index}` }),
    h(DocumentReader, { controlsTarget: `#pane-header-${index}`, page: pages.value[index], count: 2, 'onUpdate:page': (value: number) => { pages.value[index] = value; } }),
  ])))); app.mount(root); await nextTick();
  root.querySelector<HTMLButtonElement>('#pane-header-1 button')!.click(); await nextTick(); await nextTick();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  dialog.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click(); await nextTick(); await nextTick();
  expect(pages.value).toEqual([1, 2]);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await nextTick();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(root.querySelector('#pane-header-1 button'));
  root.querySelector<HTMLButtonElement>('#pane-header-0 button')!.click(); await nextTick();
  expect(document.querySelector<HTMLSelectElement>('[aria-label="预览页码"]')?.value).toBe('1');
});
