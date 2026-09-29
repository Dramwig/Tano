// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type { WorkspaceBackupCatalog, WorkspaceRecoveryPreview } from '@tano/protocol';
import WorkspaceRecoveryDialog from './WorkspaceRecoveryDialog.vue';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => {
  app?.unmount();
  app = undefined;
  root?.remove();
});

it('requires a checked preview, blocks damaged snapshots, and resumes a pending restore', async () => {
  root = document.createElement('div');
  document.body.append(root);
  const catalog = ref<WorkspaceBackupCatalog>({
    path: 'C:/workspace', workspaceId: 'workspace-id', pendingRestore: null,
    snapshots: [
      { snapshotId: 'valid', createdAt: 1, fileCount: 3, bytes: 64, error: null },
      { snapshotId: 'damaged', createdAt: 2, fileCount: 0, bytes: 0, error: '校验失败' },
    ],
  });
  const preview = ref<WorkspaceRecoveryPreview | null>(null);
  const selected: string[] = [];
  const restored: string[] = [];
  app = createApp(defineComponent(() => () => h(WorkspaceRecoveryDialog, {
    catalog: catalog.value, preview: preview.value, busy: false, error: '',
    onSelect: (id: string) => selected.push(id),
    onRestore: (id: string) => restored.push(id),
  })));
  app.mount(root);

  const restore = () => [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.includes('恢复此快照') || button.textContent?.includes('继续恢复'))!;
  expect(restore().disabled).toBe(true);
  preview.value = {
    workspaceId: 'workspace-id', snapshot: catalog.value.snapshots[0]!,
    currentFingerprint: 'hash', changes: [{ path: 'config.json', kind: '将恢复' }],
    markdownAndAttachmentsUnchanged: true,
  };
  await nextTick();
  expect(root.textContent).toContain('config.json');
  expect(restore().disabled).toBe(false);
  restore().click();
  expect(restored).toEqual(['valid']);

  [...root.querySelectorAll<HTMLButtonElement>('.recovery-list button')][1]!.click();
  await nextTick();
  expect(selected).toEqual(['damaged']);
  expect(restore().disabled).toBe(true);

  catalog.value = { ...catalog.value, pendingRestore: 'damaged' };
  await nextTick();
  expect(root.textContent).toContain('上次恢复尚未完成');
  expect(restore().disabled).toBe(true);
  catalog.value = { ...catalog.value, pendingRestore: 'valid' };
  [...root.querySelectorAll<HTMLButtonElement>('.recovery-list button')][0]!.click();
  preview.value = null;
  await nextTick();
  expect(restore().textContent).toContain('继续恢复');
  expect(restore().disabled).toBe(false);

  catalog.value = { ...catalog.value, pendingRestore: null, snapshots: [catalog.value.snapshots[1]!] };
  await nextTick();
  expect(root.textContent).toContain('无法恢复原 UUID、文件短 ID、对象和关系');
  expect(restore().disabled).toBe(true);
  catalog.value = { ...catalog.value, snapshots: [] };
  await nextTick();
  expect(root.textContent).toContain('现存 Markdown 与附件仍可单独保留');
});
