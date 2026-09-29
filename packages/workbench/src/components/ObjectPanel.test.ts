// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, reactive, nextTick, defineComponent, h, ref } from 'vue';
import type { App } from 'vue';
import type { ObjectRecord } from '../workspace-objects';
import { coreObjectTypes, validateObjectProperties } from '@tano/protocol';
const fixture = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
import ObjectPanel from './ObjectPanel.vue';
let app: App | undefined, root: HTMLDivElement;
afterEach(() => {
  app?.unmount();
  root?.remove();
});
function mountPanel(objects: ObjectRecord[] = [], selectedId?: string, visible = ref(true)) {
  const store = reactive({
    workspace: { id: 'ws', readOnly: false },
    capabilities: { features: { objectReferences: true } },
    objectDefinitions: coreObjectTypes,
    objects,
    objectErrors: [],
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
  app = createApp(defineComponent(() => () => h(ObjectPanel, { open: visible.value, selectedId })));
  app.mount(root);
  return store;
}
it('offers unified events instead of new legacy tasks and saves event timestamps with an offset', async () => {
  const store = mountPanel();
  Array.from(root.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('新建对象'))!
    .click();
  await nextTick();
  expect(Array.from(root.querySelectorAll('option')).map((option) => option.value)).toEqual([
    'project',
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
  const dates = root.querySelectorAll<HTMLInputElement>('input[type=datetime-local]');
  expect(dates).toHaveLength(2);
  for (const [index, value] of ['2026-10-01T10:00', '2026-10-01T11:00'].entries()) {
    dates[index]!.value = value;
    dates[index]!.dispatchEvent(new Event('input', { bubbles: true }));
  }
  root
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await vi.waitFor(() => expect(store.createObject).toHaveBeenCalledTimes(1));
  const value = store.createObject.mock.calls[0]![0];
  expect(value.type).toBe('event');
  expect(Date.parse(value.properties.start)).toBe(new Date('2026-10-01T10:00').getTime());
  expect(Date.parse(value.properties.end) - Date.parse(value.properties.start)).toBe(3600000);
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
    objects: [] as ObjectRecord[],
    objectDefinitions: coreObjectTypes,
    referenceTargets: [],
    objectErrors: [],
    isDemo: true,
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
