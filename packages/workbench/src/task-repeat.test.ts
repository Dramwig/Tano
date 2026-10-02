// @vitest-environment jsdom
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, expect, it } from 'vitest';
import { DemoAdapter } from './adapter';
import { configureWorkbench } from './runtime';
import { useWorkspaceStore } from './stores/workspace';
import { nextRepeatDate } from './task-repeat';
import type { WorkspaceObject } from '@tano/protocol';
let pinia: ReturnType<typeof createPinia> | undefined;
afterEach(() => { if (pinia) { useWorkspaceStore(pinia).dispose(); disposePinia(pinia); } });
it('uses calendar recurrence rules at month ends and respects the last occurrence', () => {
  const object: WorkspaceObject = { version: 1, id: 'b00001', type: 'event', name: '月报', description: '', archived: false,
    properties: { checkable: true, completed: true, date: '2026-01-31', repeat: { version: 1, frequency: 'monthly', interval: 1, anchor: '2026-01-31', until: '2026-03-31' } } };
  expect(nextRepeatDate(object)).toBe('2026-03-31');
  expect(nextRepeatDate({ ...object, properties: { ...object.properties, repeatOccurrence: '2026-03-31' } })).toBeNull();
});
it('confirms one stable new task, retains sources and assignees, and rejects stale previews', async () => {
  localStorage.clear(); const adapter = new DemoAdapter();
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false }); setActivePinia(pinia);
  const store = useWorkspaceStore(); await store.openWorkspace();
  const person = await store.createObject({ type: 'person', name: 'Alice', description: '', archived: false, properties: {} });
  const task = await store.createObject({ type: 'event', name: '周报', description: '[@依据](object://document/a00001)', archived: false,
    properties: { checkable: true, completed: true, date: '2026-10-02', due: '2026-10-03', syncConnection: 'calendar', syncRemoteId: 'remote',
      repeat: { version: 1, frequency: 'weekly', interval: 1, anchor: '2026-10-02' } } });
  await store.createRelation('assigned', person.object, task.object);
  const preview = (await store.repeatPreview(task, store.workspace!.id))!;
  expect(store.objects.filter(record => record.object.name === '周报')).toHaveLength(1);
  const next = await store.createRepeat(preview, store.workspace!.id);
  expect(next.object).toMatchObject({ name: '周报', description: task.object.description,
    properties: { completed: false, date: '2026-10-09', due: '2026-10-10', repeatSourceId: task.object.id } });
  expect(next.object.properties.syncRemoteId).toBeUndefined();
  expect(next.object.properties.syncConnection).toBeUndefined();
  expect(store.relations.some(row => row.type === 'assigned' && row.source.id === person.object.id && row.target.id === next.object.id)).toBe(true);
  expect((await store.createRepeat(preview, store.workspace!.id)).object.id).toBe(next.object.id);
  expect(store.objects.filter(record => record.object.name === '周报')).toHaveLength(2);
  const fresh = store.objects.find(record => record.object.id === task.object.id)!;
  const updatedSeries = await store.updateObject(fresh, { ...fresh.object, properties: { ...fresh.object.properties,
    repeat: { version: 1, frequency: 'daily', interval: 1, anchor: '2026-10-02' } } }, store.workspace!.id);
  const finished = await store.updateObject(next, { ...next.object, properties: { ...next.object.properties, completed: true } }, store.workspace!.id);
  const following = (await store.repeatPreview(finished, store.workspace!.id))!;
  expect(following.object.properties.date).toBe('2026-10-10');
  await store.updateObject(updatedSeries, { ...updatedSeries.object, name: '新周报' }, store.workspace!.id);
  await expect(store.createRepeat(following, store.workspace!.id)).rejects.toThrow('重复规则已变化');
  await expect(store.createRepeat(preview, store.workspace!.id)).rejects.toThrow('重新预览');
});
