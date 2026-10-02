// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import { useWorkspaceStore } from './workspace';
import type { PreparedImport } from '../document-import';

let pinia: ReturnType<typeof createPinia>;
let adapter: DemoAdapter;
beforeEach(async () => {
  localStorage.clear();
  adapter = new DemoAdapter();
  pinia = createPinia();
  configureWorkbench(pinia, { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  await useWorkspaceStore().openWorkspace();
});
afterEach(() => { useWorkspaceStore().dispose(); disposePinia(pinia); vi.restoreAllMocks(); });
const prepared: PreparedImport = { pages: [{ path: 'A.md', sourcePath: 'A.md', content: '# A' }, { path: 'B.md', sourcePath: 'B.md', content: '# B' }], assets: [], issues: [] };

it('imports a batch with fresh file identities and opens only the first document', async () => {
  const store = useWorkspaceStore();
  const initialTabs = store.tabs.length;
  const receipt = await store.importDocuments(prepared, 'Import', store.workspace!.id);
  expect(receipt.paths).toEqual(['Import/A.md', 'Import/B.md']);
  expect(store.tabs.length).toBe(initialTabs + 1);
  expect(store.active?.path).toBe('Import/A.md');
  const imported = store.workspace!.files.filter(file => receipt.paths.includes(file.path));
  expect(new Set(imported.map(file => file.id)).size).toBe(2);
});

it('retains the import receipt when refresh fails after successful writes', async () => {
  const store = useWorkspaceStore();
  const refresh = adapter.refresh.bind(adapter);
  vi.spyOn(adapter, 'refresh').mockImplementation(async () => {
    const workspace = await refresh();
    if (workspace.files.some(file => file.path === 'Import/B.md')) throw new Error('Refresh unavailable');
    return workspace;
  });
  const receipt = await store.importDocuments(prepared, 'Import', store.workspace!.id);
  expect(receipt.paths).toHaveLength(2);
  expect(receipt.issues[0].message).toContain('Refresh unavailable');
  expect((await adapter.read('Import/B.md')).content).toBe('# B');
});
