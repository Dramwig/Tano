// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';

let store: ReturnType<typeof useWorkspaceStore>, pinia: ReturnType<typeof createPinia>;
afterEach(() => { store?.dispose(); if (pinia) disposePinia(pinia); vi.restoreAllMocks(); localStorage.clear(); });

it('saves drafts, keeps open document identity and reconciles incoming links through both conversions', async () => {
  const adapter = new DemoAdapter({ files: { '设计.md': '# 设计\n', '引用.md': '[设计](设计.md)\n' } });
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia); store = useWorkspaceStore(); await store.initialize();
  const source = store.workspace!.files.find(file => file.path === '设计.md')!;
  const reference = store.workspace!.files.find(file => file.path === '引用.md')!;
  await store.openFileInNewTab(reference);
  await store.openFileInNewTab(source);
  const original = store.documents.find(doc => doc.id === source.id)!;
  original.content = '# 设计\n\n未保存的草稿\n';
  const created = await store.convertDocumentStructure(source, 'child');
  expect(created?.path).toBe('设计/新建文档.md');
  expect(store.activeId).toBe(created!.id);
  expect(original.id).toBe(source.id);
  expect(original.path).toBe('设计/README.md');
  expect(original.content).toContain('未保存的草稿');
  expect(store.documents.find(doc => doc.id === reference.id)!.content).toContain('README.md');
  await adapter.remove(created!.path);
  await store.close(created!.id);
  await store.refresh();
  const folder = store.workspace!.files.find(file => file.path === '设计')!;
  await store.convertDocumentStructure(folder, 'flatten');
  expect(store.activeId).toBe(source.id);
  expect(original.path).toBe('设计.md');
  expect(original.content).toContain('未保存的草稿');
  expect(store.documents.find(doc => doc.id === reference.id)!.content).not.toContain('README.md');
});
