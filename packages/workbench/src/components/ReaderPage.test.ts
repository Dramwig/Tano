// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, onBeforeUnmount, type App } from 'vue';
import ReaderPage from './ReaderPage.vue';

let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('unmounts distant page contents while preserving page geometry and the first Word measuring page', async () => {
  const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  const disconnect = vi.fn(), disposed = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof callbacks[number]) { callbacks.push(callback); }
    observe() {}
    disconnect = disconnect;
  });
  const content = { setup() { onBeforeUnmount(disposed); return () => h('canvas'); } };
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h('div', { class: 'reader-viewport' }, [
    h(ReaderPage, { page: 1, width: 794, height: 1123, scale: .5, keepMounted: true }, () => h(content)),
    h(ReaderPage, { page: 2, width: 794, height: 1123, scale: .5 }, () => h(content)),
  ]));
  app.mount(root);
  expect(root.querySelectorAll('canvas')).toHaveLength(1);
  const page = root.querySelector<HTMLElement>('[data-reader-page="2"]')!;
  expect(page.style.width).toBe('397px'); expect(page.style.height).toBe('561.5px');
  callbacks[1]([{ isIntersecting: true }]); await nextTick();
  expect(root.querySelectorAll('canvas')).toHaveLength(2);
  callbacks.forEach(callback => callback([{ isIntersecting: false }])); await nextTick();
  expect(root.querySelectorAll('canvas')).toHaveLength(1); expect(disposed).toHaveBeenCalledTimes(1);
  expect(page.style.height).toBe('561.5px');
  app.unmount(); app = undefined; expect(disconnect).toHaveBeenCalledTimes(2);
});
