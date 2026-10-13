// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import { useWorkspaceStore } from './workspace';

let pinia: ReturnType<typeof createPinia>;
let adapter: DemoAdapter;
beforeEach(() => {
  localStorage.clear();
  adapter = new DemoAdapter();
  pinia = createPinia();
  configureWorkbench(pinia, { adapter, native: false, mobile: false });
  setActivePinia(pinia);
});
afterEach(() => { useWorkspaceStore().dispose(); disposePinia(pinia); });

it('can read document metadata by stable identity after a rename while preserving explicit path guards', async () => {
  await adapter.open();
  await adapter.create('icon.md', '---\nicon: 🌿\n---\n正文\n');
  const store = useWorkspaceStore(); await store.openWorkspace();
  const file = store.workspace!.files.find(file => file.path === 'icon.md')!;
  const scope = { id: store.workspace!.id, path: store.workspace!.path };
  await adapter.rename('icon.md', 'renamed.md'); await store.refresh();
  expect(await store.readGraphDocument(scope, { id: file.id })).toContain('icon: 🌿');
  await expect(store.readGraphDocument(scope, file)).rejects.toThrow('文档已移动或删除');
  await expect(store.readGraphDocument({ ...scope, id: 'another workspace' }, { id: file.id })).rejects.toThrow('工作区已切换');
});

it('queries unopened documents and task descriptions, then sees external changes and unsaved document drafts', async () => {
  await adapter.open();
  await adapter.create('context.md', 'Task context');
  const store = useWorkspaceStore();
  await store.openWorkspace();
  const document = store.referenceTargets.find(target => target.path === 'context.md')!;
  const task = await store.createObject({ type: 'event', name: 'Task', description: `[Context](object://document/${document.id})`, archived: false, properties: { checkable: true } });
  let context = await store.getReferenceContext(document);
  expect(context.incoming[0].source.id).toBe(task.object.id);
  const file = store.workspace!.files.find(file => file.id === document.id)!;
  const snapshot = await adapter.read(file.path);
  await adapter.write(file.path, `[Task](object://event/${task.object.id})`, snapshot.hash);
  await store.refresh();
  context = await store.getReferenceContext(task.object);
  expect(context.incoming[0].source.id).toBe(document.id);
  await store.openFile(file);
  store.editDocument(document.id, 'Reference removed in a local draft');
  expect((await store.getReferenceContext(task.object)).incoming).toEqual([]);
  expect((await store.getReferenceContext(task.object, `[Self](object://event/${task.object.id})`)).outgoing[0].target.id).toBe(task.object.id);
});
it('reports partial read failures and rejects queries bound to a different workspace session', async () => {
  await adapter.open();
  await adapter.create('unreadable.md', 'Read me');
  const store = useWorkspaceStore();
  await store.openWorkspace();
  const target = store.referenceTargets.find(target => target.path === 'unreadable.md')!;
  const read = vi.spyOn(adapter, 'read');
  read.mockImplementation(async () => { throw new Error('Read failure'); });
  expect((await store.getReferenceContext(target)).errors.join()).toContain('unreadable.md');
  read.mockRestore();
  await expect(store.getReferenceContext(target, undefined, { id: 'another workspace', path: store.workspace!.path })).rejects.toThrow('切换');
  await expect(store.assistantReferenceContext({ id: store.workspace!.id, path: store.workspace!.path, epoch: store.assistantEpoch - 1 }, target)).rejects.toThrow('会话');
});
