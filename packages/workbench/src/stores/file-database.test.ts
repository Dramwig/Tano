// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createPinia, disposePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { emptyFileMetadata, queryFileDatabase, fileMetadataPath } from '@tano/protocol';
let pinia: ReturnType<typeof createPinia>;
let store: ReturnType<typeof useWorkspaceStore>;
let adapter: DemoAdapter;
beforeEach(async () => {
  localStorage.clear();
  adapter = new DemoAdapter({ files: { 'docs/a.md': '# A', 'docs/b.csv': 'name,value\na,1' }, storageKey: 'database-tests' });
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  store = useWorkspaceStore(pinia); await store.initialize();
});
afterEach(() => { store.dispose(); disposePinia(pinia); });
it('projects Markdown properties and content references without changing legacy sidecars', async () => {
  const file = store.fileRegistry!.at('docs/a.md')!;
  const scope = store.workspace!.id;
  const original = await adapter.read(file.path);
  await adapter.write(file.path, '---\n负责人: Li\n状态: 进行中\ntags: [research]\npriority: 2\n---\n# A\n[CSV](b.csv)\n[again](b.csv)', original.hash);
  const legacy = JSON.stringify({ ...emptyFileMetadata(file.id), properties: { owner: 'Legacy' } });
  await adapter.create(fileMetadataPath(file.id), legacy);
  await store.refresh();
  const state = await store.readFileMetadata(file.id, scope);
  expect(state.file.properties).toMatchObject({ owner: 'Li', status: '进行中', priority: 2 });
  expect(state.file.tags).toEqual(['research']);
  expect(state.referenceCount).toBe(1);
  expect(state.base).toBeNull();
  await expect(store.updateFileMetadata(state, scope)).rejects.toThrow('文档属性');
  expect((await adapter.read(fileMetadataPath(file.id))).content).toBe(legacy);
  await store.openFile(file);
  store.documents.find(doc => doc.id === file.id)!.content = '---\nowner: Draft\nstatus: Done\n---\n# Changed';
  const draft = await store.readFileMetadata(file.id, scope);
  expect(draft.file.properties.owner).toBe('Draft');
  expect(draft.referenceCount).toBe(0);
});
it('creates a portable dynamic view, saves queries and discovers new files without modifying source bytes', async () => {
  const before = await adapter.read('docs/b.csv');
  await store.createFileDatabase('docs');
  const record = store.workspaceViews[0]!;
  expect(record.view.database?.directory).toBe('docs');
  expect(record.view.sources).toEqual([]);
  const view = JSON.parse(JSON.stringify(record.view)); view.database.groupBy = 'property:status';
  await store.saveFileDatabase(view, record.snapshot);
  expect((await adapter.read('docs/b.csv')).hash).toBe(before.hash);
  await adapter.create('docs/new.json', '{}'); await store.refresh();
  const rows = store.fileRegistry!.userFiles().map(file => ({ file, metadata: emptyFileMetadata(file.id) }));
  expect(queryFileDatabase(rows, store.workspaceViews[0]!.view.database!).map(r => r.file.path)).toEqual(['docs/a.md', 'docs/b.csv', 'docs/new.json']);
});
it('preserves external view edits and a conflict copy of local settings', async () => {
  await store.createFileDatabase('docs');
  const record = store.workspaceViews[0]!;
  const external = { ...record.view, name: 'External' };
  await adapter.write(record.path, JSON.stringify(external), record.snapshot.hash);
  await expect(store.saveFileDatabase({ ...record.view, name: 'Local' }, record.snapshot)).rejects.toThrow('外部版本未覆盖');
  expect(JSON.parse((await adapter.read(record.path)).content).name).toBe('External');
  const copy = (await adapter.refresh()).files.find(f => f.path.startsWith('.tano/conflicts/view-'))!;
  expect(JSON.parse((await adapter.read(copy.path)).content).name).toBe('Local');
});
it('keeps metadata and object relationships through file moves and rescan', async () => {
  const file = store.fileRegistry!.at('docs/b.csv')!;
  const scope = store.workspace!.id;
  const state = await store.readFileMetadata(file.id, scope);
  state.file.properties = { owner: 'Li', status: '进行中' }; state.file.tags = ['research'];
  await store.updateFileMetadata(state, scope);
  // A document projection is a valid semantic object and keeps its own stable file ID.
  const document = store.referenceTargets.find(t => t.type === 'document' && t.path === 'docs/a.md')!;
  await store.createRelation('related', { type: 'asset', id: file.id }, document);
  await adapter.move('docs/b.csv', 'docs/renamed.csv', 'file'); await store.refresh();
  expect(store.fileRegistry!.get(file.id)!.path).toBe('docs/renamed.csv');
  expect((await store.readFileMetadata(file.id, scope)).file.properties.owner).toBe('Li');
  expect(store.relations[0]!.source.id).toBe(file.id);
});
it('refuses view writes in read-only workspaces and stale workspace scopes', async () => {
  await store.createFileDatabase(); const record = store.workspaceViews[0]!;
  store.workspace!.readOnly = true;
  await expect(store.saveFileDatabase(record.view, record.snapshot)).rejects.toThrow();
  await expect(store.createFileDatabase()).rejects.toThrow();
  store.workspace!.readOnly = false;
  await expect(store.saveFileDatabase({ ...record.view, workspaceId: 'other' }, record.snapshot)).rejects.toThrow('工作区已切换');
});
