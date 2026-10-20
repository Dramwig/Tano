// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { webcrypto } from 'node:crypto';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { parseDataTable } from '@tano/protocol';

let adapter: DemoAdapter;
let store: ReturnType<typeof useWorkspaceStore>;
beforeEach(async () => {
  localStorage.clear();
  Object.defineProperty(crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request(name: string, action: () => unknown) {
        const next = (queues.get(name) ?? Promise.resolve()).then(action);
        queues.set(
          name,
          next.catch(() => {}),
        );
        return next;
      },
    },
  });
  adapter = new DemoAdapter({ files: { '项目/说明.md': '# 说明' } });
  setActivePinia(configureWorkbench(createPinia(), { adapter, native: false, mobile: false }));
  store = useWorkspaceStore();
  await store.initialize();
});
afterEach(() => store.dispose());

it('persists table appearance across undo, save and reopen', async () => {
  const id = await store.createDataTable('blank', '项目');
  store.editDataTable(id, table => { table.icon = '🌿'; table.cover = 'tano:mist'; });
  store.undoDataTable(id);
  expect(store.dataTableRecords.find(record => record.fileId === id)!.draft.icon).toBeUndefined();
  store.undoDataTable(id, true);
  expect(await store.flush()).toBe(true);
  const file = store.workspace!.files.find(file => file.id === id)!;
  expect(parseDataTable((await adapter.read(file.path)).content)).toMatchObject({ icon: '🌿', cover: 'tano:mist' });
  await store.close(`table:${id}`);
  await store.openFile(file);
  expect(store.dataTableRecords.find(record => record.fileId === id)!.draft).toMatchObject({ icon: '🌿', cover: 'tano:mist' });
});

it('uses the ordinary file tree lifecycle for tables, retaining the open tab through moves', async () => {
  const id = await store.createDataTable('parts', '项目');
  expect(store.activeId).toBe(`table:${id}`);
  expect(store.tabs.find((tab) => tab.id === store.activeId)?.path).toBe(
    '项目/配件选择.table.json',
  );
  expect(store.documents.some((doc) => doc.id === id)).toBe(false);
  store.editDataTable(id, (table) =>
    table.rows.push({ id: 'r1', values: { name: '候选A', price: 100 } }),
  );
  await store.renameDataTable(id, '硬件候选');
  let file = store.workspace!.files.find((file) => file.id === id)!;
  expect(file.path).toBe('项目/硬件候选.table.json');
  await store.moveEntry(file, '');
  expect(store.activeId).toBe(`table:${id}`);
  expect(store.tabs.find((tab) => tab.id === store.activeId)).toMatchObject({
    path: '硬件候选.table.json',
    dataTable: { name: '硬件候选' },
  });
  store.editDataTable(id, (table) => {
    table.rows[0].values.price = 200;
  });
  expect(await store.flush()).toBe(true);
  expect(
    parseDataTable((await adapter.read('硬件候选.table.json')).content).rows[0].values.price,
  ).toBe(200);
  await store.close(`table:${id}`);
  file = store.workspace!.files.find((file) => file.id === id)!;
  await store.openFile(file);
  expect(store.activeId).toBe(`table:${id}`);
  await store.removeEntry(file);
  expect(store.workspace!.files.some((file) => file.id === id)).toBe(false);
  expect(store.tabs.some((tab) => tab.id === `table:${id}`)).toBe(false);
});

it('opens tables dropped on the tab strip alongside Markdown without editing JSON as prose', async () => {
  const id = await store.createDataTable('blank', '项目');
  const note = store.workspace!.files.find((file) => file.path === '项目/说明.md')!;
  await store.close(`table:${id}`);
  await store.openFilesInNewTabsAt([id, note.id], 0, store.workspace!.id);
  expect(store.tabs.map((tab) => tab.id)).toContain(`table:${id}`);
  expect(store.documents.map((doc) => doc.id)).toContain(note.id);
  expect(store.documents.map((doc) => doc.id)).not.toContain(id);
});

it('opens a second tab when a data table is already open', async () => {
  const id = await store.createDataTable('blank', '项目');
  const file = store.workspace!.files.find(entry => entry.id === id)!;
  await store.openFileInNewTab(file);
  expect(store.tabs).toHaveLength(2);
  expect(store.tabs.map(tab => tab.path)).toEqual([
    '项目/未命名数据表.table.json',
    '项目/未命名数据表.table.json',
  ]);
  expect(store.activeId).toMatch(new RegExp(`^table:${id}:`));
  await store.close(store.activeId);
  expect(store.tabs).toHaveLength(1);
  expect(store.activeId).toBe(`table:${id}`);
});

it('closes the file tab when an invalid table is removed', async () => {
  await adapter.create('损坏.table.json', '{broken');
  await store.refresh();
  const file = store.workspace!.files.find(file => file.path === '损坏.table.json')!;
  await store.openFile(file);
  expect(store.activeId).toBe(`table:${file.id}`);
  expect(store.dataTableErrors.some(error => error.includes(file.path))).toBe(true);
  await store.removeEntry(file);
  expect(store.tabs.some(tab => tab.id === `table:${file.id}`)).toBe(false);
});
