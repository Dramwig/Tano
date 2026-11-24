// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { App } from 'vue';
import DocumentHistoryPanel from './DocumentHistoryPanel.vue';

const historyView = {
    props: ['localId', 'path', 'workspaceId', 'embedded'],
    template: '<div class="history-panel-stub">版本恢复内容</div>',
};

let app: App | undefined;
let root: HTMLDivElement | undefined;

function mount(initialPage: 'versions' | 'updates' = 'versions', onDiff = vi.fn()) {
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(DocumentHistoryPanel, {
    localId: 'local-file',
    path: 'notes/today.md',
    workspaceId: 'workspace',
    initialPage,
    historyView,
    activities: [
      {
        id: 'change-1',
        label: '外部修改已载入',
        detail: 'notes/today.md',
        time: Date.UTC(2026, 8, 26, 8, 30),
        kind: 'external',
        change: { before: '旧内容', after: '新内容' },
      },
    ],
    onDiff,
  });
  app.mount(root);
  return { root, onDiff };
}

afterEach(() => {
  app?.unmount();
  root?.remove();
  app = undefined;
  root = undefined;
});

it('opens the version history page and switches to update history', async () => {
  const { root } = mount();
  expect(root.querySelector('h2')?.textContent).toContain('版本历史');
  expect(root.querySelector('.history-panel-stub')).not.toBeNull();

  const updates = [...root.querySelectorAll<HTMLButtonElement>('nav button')].find((button) =>
    button.textContent?.includes('更新历史'),
  );
  updates?.click();
  await nextTick();

  expect(root.querySelector('h2')?.textContent).toBe('更新历史');
  expect(root.textContent).toContain('外部修改已载入');
  expect(root.textContent).toContain('notes/today.md');
});

it('opens directly on update history and emits the selected diff', () => {
  const onDiff = vi.fn();
  const { root } = mount('updates', onDiff);
  const diff = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.includes('查看差异'),
  );
  diff?.click();

  expect(onDiff).toHaveBeenCalledWith({
    title: 'notes/today.md',
    before: '旧内容',
    after: '新内容',
  });
});
