// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import AssistantConnectionStatus from './AssistantConnectionStatus.vue';

it('fades old results, keeps a readable floor, and restores fresh results', async () => {
  vi.useFakeTimers();
  const checkedAt = ref(Date.now());
  const refreshing = ref(false);
  const root = document.createElement('div');
  const app = createApp(() => h(AssistantConnectionStatus, { label: '详情', summary: '200 ms', checkedAt: checkedAt.value, refreshing: refreshing.value }));
  app.mount(root);
  const opacity = () => Number(root.querySelector<HTMLElement>('button')!.style.getPropertyValue('--freshness-opacity'));
  try {
    expect(opacity()).toBe(1);
    await vi.advanceTimersByTimeAsync(35 * 60_000); await nextTick();
    expect(opacity()).toBeCloseTo(0.775);
    await vi.advanceTimersByTimeAsync(60 * 60_000); await nextTick();
    expect(opacity()).toBe(0.55);
    refreshing.value = true; await nextTick(); expect(opacity()).toBe(1);
    refreshing.value = false; checkedAt.value = Date.now(); await nextTick();
    expect(opacity()).toBe(1);
  } finally { app.unmount(); vi.useRealTimers(); }
});
