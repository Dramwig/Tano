// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, reactive, nextTick, defineComponent, h, ref } from 'vue';
import type { App } from 'vue';
import type { ObjectRecord } from '../workspace-objects';
import { coreObjectTypes, coreRelationTypes, validateObjectProperties } from '@tano/protocol';
const fixture = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
vi.mock('../runtime', () => ({ useWorkbenchRuntime: () => ({}) }));
import ObjectPanel from './ObjectPanel.vue';
let app: App | undefined, root: HTMLDivElement;
afterEach(() => {
  app?.unmount();
  root?.remove();
});
function mountPanel(objects: ObjectRecord[] = [], selectedId?: string, visible = ref(true), initialType = ref<string>()) {
  const store = reactive({
    workspace: { id: 'ws', readOnly: false },
    capabilities: { features: { objectReferences: true } },
    workspaceSettings: { showPeopleDirectory: true },
    objectDefinitions: coreObjectTypes,
    relationDefinitions: coreRelationTypes,
    relations: [],
    createRelation: vi.fn(),
    removeRelation: vi.fn(),
    objects,
    objectErrors: [],
    getReferenceContext: vi.fn(async () => ({ outgoing: [], incoming: [], errors: [] })),
    referenceTargets: [
      {
        id: 'f00001',
        workspace: 'ws',
        type: 'asset',
        name: 'figure.png',
        path: 'assets/figure.png',
        mime: 'image/png',
        size: 1024,
        modified: 12,
      },
    ],
    isDemo: true,
    createObject: vi.fn(async (value) => {
      validateObjectProperties(value.type, value.properties);
      return {
        object: { ...value, id: 'b00001', version: 1 },
        path: 'objects/b00001.tano.json',
        snapshot: { content: '', hash: 'hash', modified: 1 },
      };
    }),
    updateObject: vi.fn(),
  });
  fixture.store = store;
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(defineComponent(() => () => h(ObjectPanel, { open: visible.value, selectedId, initialType: initialType.value })));
  app.mount(root);
  return store;
}
it('keeps unsaved typed drafts separate when reopening database creation controls', async () => {
  const visible = ref(true), type = ref('task');
  mountPanel([], undefined, visible, type);
  const name = () => root.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
  name().value = 'Unsaved task';
  name().dispatchEvent(new Event('input', { bubbles: true }));
  visible.value = false; await nextTick();
  type.value = 'project'; visible.value = true; await nextTick();
  expect(name().value).toBe('');
  expect(root.querySelector('select')!.value).toBe('project');
  visible.value = false; await nextTick();
  type.value = 'task'; visible.value = true; await nextTick();
  expect(name().value).toBe('Unsaved task');
});
it('offers task, project and experiment schemas alongside events and saves offset timestamps', async () => {
  const store = mountPanel();
  Array.from(root.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('新建对象'))!
    .click();
  await nextTick();
  expect(Array.from(root.querySelectorAll('option')).map((option) => option.value)).toEqual([
    'task',
    'project',
    'experiment',
    'person',
    'event',
  ]);
  const select = root.querySelector('select')!;
  select.value = 'event';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  const name = root.querySelector('input[maxlength="200"]') as HTMLInputElement;
  name.value = '会议';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector<HTMLButtonElement>('[aria-label="时间安排"]')!.click();
  await nextTick();
  [...root.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')].find(button => button.textContent?.includes('计划日期'))!.click();
  await nextTick();
  const day = root.querySelector<HTMLInputElement>('input[type=date]')!;
  day.value = '2026-10-01';
  day.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  root.querySelector<HTMLButtonElement>('.plan-date-label button')!.click();
  await nextTick();
  const time = root.querySelector<HTMLInputElement>('input[type=datetime-local]')!;
  time.value = '2026-10-01T10:00';
  time.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="时间安排"]')!.click();
  await nextTick();
  [...root.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')].find(button => button.textContent?.includes('时间段'))!.click();
  await nextTick();
  expect(root.querySelectorAll<HTMLInputElement>('input[type=datetime-local]')[1]!.value).toBe('2026-10-01T11:00');
  root
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await vi.waitFor(() => expect(store.createObject).toHaveBeenCalledTimes(1));
  const value = store.createObject.mock.calls[0]![0];
  expect(value.type).toBe('event');
  expect(Date.parse(value.properties.start)).toBe(new Date('2026-10-01T10:00').getTime());
  expect(Date.parse(value.properties.end) - Date.parse(value.properties.start)).toBe(3600000);
});
it('edits an existing all-day range with inclusive dates and preserves the range when saving', async () => {
  const record: ObjectRecord = {
    path: '.tano/objects/a00001.tano.json',
    snapshot: { content: '', hash: 'base', modified: 1 },
    object: { version: 1, id: 'a00001', type: 'event', name: '假期', description: '', archived: false,
      properties: { checkable: false, allDay: true, start: new Date('2026-09-30T00:00:00').toISOString(), end: new Date('2026-10-03T00:00:00').toISOString() } },
  };
  const store = mountPanel([record], record.object.id);
  store.updateObject.mockResolvedValue(record);
  const values = () => [...root.querySelectorAll<HTMLInputElement>('.plan-date-inputs input')].map(input => input.value);
  expect(values()).toEqual(['2026-09-30', '2026-10-02']);
  expect(root.querySelector('[aria-label="时间安排"]')?.textContent).toContain('时间段');
  root.querySelector<HTMLButtonElement>('.plan-date-precision')!.click();
  await nextTick();
  expect(values()).toEqual(['2026-09-30T09:00', '2026-10-02T10:00']);
  root.querySelector<HTMLButtonElement>('.plan-date-precision')!.click();
  await nextTick();
  expect(values()).toEqual(['2026-09-30', '2026-10-02']);
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await vi.waitFor(() => expect(store.updateObject).toHaveBeenCalledTimes(1));
  expect(store.updateObject.mock.calls[0]![1].properties).toEqual(record.object.properties);
});

it('shows a retired object read-only and preserves its original type and properties', async () => {
  const object = {
    version: 1 as const,
    id: 'd00001',
    type: 'dataset',
    name: 'Old dataset',
    description: 'Keep',
    archived: false,
    properties: { custom: 42 },
  };
  const store = mountPanel(
    [
      {
        object,
        path: 'objects/old.tano.json',
        snapshot: { content: JSON.stringify(object), hash: 'h', modified: 1 },
      },
    ],
    object.id,
  );
  expect(root.textContent).toContain('此类型不属于内置核心对象');
  expect((root.querySelector('input[maxlength="200"]') as HTMLInputElement).disabled).toBe(true);
  expect((root.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  expect(root.textContent).toContain('object://dataset/d00001');
  expect(store.objects[0]!.object).toEqual(object);
});
it('offers historical projects as editable records without changing their identity', async () => {
  const object = { version: 1 as const, id: 'd00001', type: 'project', name: '历史项目', description: '项目说明', archived: false, properties: { custom: 42 } };
  const store = mountPanel([{ object, path: '.tano/objects/old.tano.json', snapshot: { content: JSON.stringify(object), hash: 'h', modified: 1 } }], object.id);
  expect(root.textContent).toContain('object://project/d00001');
  expect((root.querySelector('input[maxlength="200"]') as HTMLInputElement).disabled).toBe(false);
  expect((root.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(false);
  expect(store.objects[0]!.object).toEqual(object);
});

it('shows resource metadata without offering a duplicate JSON record or binary edit form', () => {
  mountPanel([], 'f00001');
  expect(root.textContent).toContain('image/png');
  expect(root.textContent).toContain('1024 字节');
  expect(root.textContent).toContain('object://asset/f00001');
  expect(root.querySelector('form')).toBeNull();
});
it('reopens the same reference target after browsing another record inside the panel', async () => {
  const object = { version: 1 as const, id: 'd00001', type: 'task', name: 'Task A', description: '', archived: false, properties: {} };
  const visible = ref(true);
  mountPanel([{ object, path: 'objects/task.tano.json', snapshot: { content: JSON.stringify(object), hash: 'h', modified: 1 } }], 'f00001', visible);
  Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.includes('Task A'))!.click(); await nextTick();
  expect(root.querySelector('form')).not.toBeNull();
  visible.value = false; await nextTick(); visible.value = true; await nextTick();
  expect(root.querySelector('form')).toBeNull();
  expect(root.textContent).toContain('object://asset/f00001');
});
it('retains an object draft across workspace scans and selects the saved object', async () => {
  const store = reactive({
    workspace: { id: 'ws', readOnly: false },
    capabilities: { features: { objectReferences: true } },
    workspaceSettings: { showPeopleDirectory: true },
    objects: [] as ObjectRecord[],
    objectDefinitions: coreObjectTypes,
    relationDefinitions: coreRelationTypes,
    relations: [],
    createRelation: vi.fn(),
    removeRelation: vi.fn(),
    referenceTargets: [],
    objectErrors: [],
    isDemo: true,
    getReferenceContext: vi.fn(async () => ({ outgoing: [], incoming: [], errors: [] })),
    createObject: vi.fn(async (value) => {
      const object = { ...value, id: 'a00001', version: 1 };
      const saved = {
        object,
        path: 'objects/a.tano.json',
        snapshot: { content: JSON.stringify(object), hash: 'h', modified: 1 },
      };
      store.workspace = { id: 'ws', readOnly: false };
      store.objects = [saved];
      await nextTick();
      return saved;
    }),
    updateObject: vi.fn(),
  });
  fixture.store = store;
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(ObjectPanel, { open: true });
  app.mount(root);
  Array.from(root.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('新建对象'))!
    .click();
  await nextTick();
  const name = root.querySelector('input[maxlength="200"]') as HTMLInputElement;
  name.value = 'Alice';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  store.workspace = { id: 'ws', readOnly: false };
  await nextTick();
  expect((root.querySelector('input[maxlength="200"]') as HTMLInputElement).value).toBe('Alice');
  root
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.textContent).toContain('object://person/a00001'));
  expect((root.querySelector('input[maxlength="200"]') as HTMLInputElement).value).toBe('Alice');
  expect(store.createObject).toHaveBeenCalledTimes(1);
});

it('isolates personal drafts, resources and saves even when both spaces have matching IDs', async () => {
  const makeRecord = (name: string): ObjectRecord => {
    const object = { version: 1 as const, id: 'a00001', type: 'event', name, description: '', archived: false, properties: { checkable: true } };
    return { object, path: '.tano/objects/a00001.tano.json', snapshot: { content: JSON.stringify(object), hash: name, modified: 1 } };
  };
  const store = mountPanel([makeRecord('项目事项')], 'a00001');
  app!.unmount();
  store.workspace.readOnly = true;
  store.capabilities.features.objectReferences = false;
  const record = { ...makeRecord('个人事项'), source: { scope: 'personal' as const, id: 'ws', name: '个人' } };
  const update = vi.fn(async (_record, object) => ({ ...record, object }));
  const personal = { id: 'ws', records: [record], errors: [], writable: true, createObject: vi.fn(), updateObject: update };
  const privateView = ref(true);
  app = createApp(() => h(ObjectPanel, { open: true, selectedId: 'a00001', personal: privateView.value ? personal : undefined }));
  app.mount(root);
  const name = () => root.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
  expect(name().disabled).toBe(false);
  expect(root.querySelector('.object-resource-actions')).toBeNull();
  expect(root.textContent).not.toContain('figure.png');
  name().value = '个人草稿';
  name().dispatchEvent(new Event('input', { bubbles: true }));
  privateView.value = false;
  await nextTick();
  expect(name().value).toBe('项目事项');
  expect(name().disabled).toBe(true);
  privateView.value = true;
  await nextTick();
  expect(name().value).toBe('个人草稿');
  update.mockRejectedValueOnce(new Error('外部修改冲突'));
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.querySelector('[role=alert]')?.textContent).toContain('外部修改冲突'));
  expect(name().value).toBe('个人草稿');
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update.mock.calls[1]![1].name).toBe('个人草稿');
  expect(store.updateObject).not.toHaveBeenCalled();
  expect(store.createObject).not.toHaveBeenCalled();
});
