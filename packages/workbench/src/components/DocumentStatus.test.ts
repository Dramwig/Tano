// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import DocumentStatus from './DocumentStatus.vue';
import type { DocumentStatusItem } from '../document-status';
let app: App;
let root: HTMLElement;
const dialog = () => document.querySelector('[role="dialog"]');
async function mount() {
  const props = reactive({ documentKey: 'w:a', items: [{ kind: 'saved', label: '已保存', detail: '修改已保存到本机文件。' }] as DocumentStatusItem[] });
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(DocumentStatus, props) }); app.mount(root); await nextTick();
  return { props, button: root.querySelector('button')! };
}
afterEach(() => { app?.unmount(); root?.remove(); vi.useRealTimers(); });
it('keeps text hidden until hover, supports crossing into the panel and click pinning', async () => {
  vi.useFakeTimers(); const { button } = await mount();
  expect(button.textContent).toBe(''); expect(dialog()).toBeNull();
  button.dispatchEvent(new Event('pointerenter')); await nextTick();
  expect(dialog()?.textContent).toContain('修改已保存到本机文件。');
  button.dispatchEvent(new Event('pointerleave'));
  dialog()!.dispatchEvent(new Event('pointerenter'));
  await vi.advanceTimersByTimeAsync(200); expect(dialog()).not.toBeNull();
  button.click(); await nextTick();
  dialog()!.dispatchEvent(new Event('pointerleave'));
  await vi.advanceTimersByTimeAsync(200); expect(dialog()).not.toBeNull();
  button.click(); await nextTick(); expect(dialog()).toBeNull();
});
it('dismisses on Escape, outside interaction and document switch', async () => {
  const { props, button } = await mount();
  button.focus(); await nextTick(); expect(dialog()).not.toBeNull();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await nextTick();
  expect(dialog()).toBeNull();
  button.click(); await nextTick();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick(); expect(dialog()).toBeNull();
  button.click(); await nextTick(); props.documentKey = 'w:b'; await nextTick(); expect(dialog()).toBeNull();
});
it('updates the icon and open details when status changes', async () => {
  const { props, button } = await mount(); button.click(); await nextTick();
  props.items = [{ kind: 'error', label: '同步失败', detail: '连接中断' }]; await nextTick();
  expect(button.getAttribute('aria-label')).toContain('同步失败');
  expect(button.classList.contains('needs-attention')).toBe(true);
  expect(dialog()?.textContent).toContain('连接中断');
});
