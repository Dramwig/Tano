import { computed, shallowRef } from 'vue';
import { basename } from '@tano/protocol';
import type { FileEntry, Workspace } from '@tano/protocol';

export interface FileMutationPreview {
  workspaceId: string;
  paths: Map<string, string | null>;
  expected: Map<string, FileEntry>;
}

/** Present user intent while keeping confirmed paths available to storage/CAS. */
export function optimisticFiles(source: () => Workspace | null, report: (message: string) => void) {
  const operations = shallowRef<FileMutationPreview[]>([]);
  let chain = Promise.resolve();
  const pending = computed(() => operations.value.some(op => op.workspaceId === source()?.id));
  const workspace = computed(() => {
    const current = source();
    if (!current) return null;
    const active = operations.value.filter(op => op.workspaceId === current.id);
    if (!active.length) return current;
    let files = current.files;
    for (const operation of active) {
      files = files.flatMap(file => {
        const path = operation.paths.get(file.id);
        return path === null ? [] : path === undefined ? [file] : [{ ...file, path, name: basename(path) }];
      });
    }
    return { ...current, files };
  });
  function enqueue(label: string, operation: FileMutationPreview,
    run: () => Promise<void>, rollback?: () => void) {
    operations.value = [...operations.value, operation];
    chain = chain.then(async () => {
      try {
        if (source()?.id !== operation.workspaceId) throw new Error('工作区已切换');
        await run();
        // Rebase later confirmations over our own acknowledged changes only.
        // Remote changes still fail the existing freshness/CAS checks.
        for (const next of operations.value) {
          if (next === operation || next.workspaceId !== operation.workspaceId) continue;
          for (const [id, before] of operation.expected) {
            const expected = next.expected.get(id);
            const current = source()?.files.find(file => file.id === id);
            if (expected && current && expected.modified === before.modified && expected.size === before.size)
              next.expected.set(id, current);
          }
        }
      } catch (error) {
        if (source()?.id === operation.workspaceId) {
          rollback?.();
          report(`${label}未完成：${error instanceof Error ? error.message : String(error)}。已恢复可用条目，可重试。`);
        }
      } finally {
        operations.value = operations.value.filter(item => item !== operation);
      }
    });
  }
  async function flush() {
    // Include operations added while a previous confirmation was in flight.
    let current: Promise<void>;
    do { current = chain; await current; } while (current !== chain);
  }
  return { workspace, pending, enqueue, flush };
}
