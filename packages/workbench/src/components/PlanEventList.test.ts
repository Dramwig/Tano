// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue';
import { expect, it } from 'vitest';
import PlanEventList from './PlanEventList.vue';

it('shows an empty state only after its own initial data has finished loading', async () => {
  const loading = ref(true);
  const root = document.createElement('div');
  const app = createApp({ render: () => h('section', [
    h('button', '今天'),
    h(PlanEventList, { records: [], date: new Date(), disabled: false, pending: [], loading: loading.value }, { empty: () => h('p', '暂无安排') }),
  ]) });
  app.mount(root);
  try {
    const control = root.querySelector('button');
    expect(root.querySelector('.loading-skeleton')).not.toBeNull();
    expect(root.textContent).not.toContain('暂无安排');
    loading.value = false;
    await nextTick();
    expect(root.querySelector('.loading-skeleton')).toBeNull();
    expect(root.textContent).toContain('暂无安排');
    expect(root.querySelector('button')).toBe(control);
  } finally { app.unmount(); }
});
