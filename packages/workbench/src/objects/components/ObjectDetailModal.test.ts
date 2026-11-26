// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { registerObjectType } from '@tano/protocol';
import { DemoAdapter } from '../../workspace/adapter';
import { configureWorkbench } from '../../runtime';
import { useWorkspaceStore } from '../../stores/workspace';
import ObjectDetailModal from './ObjectDetailModal.vue';

let pinia: ReturnType<typeof createPinia>;
let adapter: DemoAdapter;
let app: ReturnType<typeof createApp> | undefined;
let root: HTMLElement;

beforeEach(async () => {
  localStorage.clear();
  adapter = new DemoAdapter();
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  root = document.createElement('div');
  document.body.append(root);
  await useWorkspaceStore().openWorkspace();
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  root.remove();
  useWorkspaceStore(pinia).dispose();
  disposePinia(pinia);
});

it('edits and archives a person object, and distinguishes AI Agent personas', async () => {
  const store = useWorkspaceStore();
  const alice = await store.createObject({
    type: 'person',
    name: 'Alice',
    description: 'Product lead',
    archived: false,
    properties: {},
  });
  const onSaved = vi.fn();
  app = createApp(() => h(ObjectDetailModal, { record: alice, onSaved })).use(pinia);
  app.mount(root);
  await nextTick();

  const name = root.querySelector<HTMLTextAreaElement>('[aria-label="名称"]')!;
  expect(name.value).toBe('Alice');
  name.value = 'Alice Zhang';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();

  const save = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (btn) => btn.textContent?.trim() === '保存',
  )!;
  expect(save.disabled).toBe(false);
  save.click();
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(store.objects.find((item) => item.object.id === alice.object.id)?.object.name).toBe(
    'Alice Zhang',
  );

  app.unmount();
  const agent = await store.createObject({
    type: 'person',
    name: 'Review Bot',
    description: '',
    archived: false,
    properties: { memberKind: 'agent' },
  });
  app = createApp(() => h(ObjectDetailModal, { record: agent })).use(pinia);
  app.mount(root);
  await nextTick();
  expect(root.textContent).toContain('AI Agent');
});

it('creates, edits and deletes plugin-registered custom objects with typed fields', async () => {
  const unregister = registerObjectType({
    plugin: 'research',
    type: 'research.paper',
    label: '论文',
    fields: [{ key: 'year', label: '年份', type: 'number', required: true }],
  });
  try {
    const store = useWorkspaceStore();
    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    app = createApp(() =>
      h(ObjectDetailModal, { initialType: 'research.paper', onSaved, onDeleted }),
    ).use(pinia);
    app.mount(root);
    await nextTick();

    const name = root.querySelector<HTMLTextAreaElement>('[aria-label="名称"]')!;
    name.value = 'Attention Is All You Need';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const year = root.querySelector<HTMLInputElement>('#object-field-year')!;
    year.value = '2017';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    const createBtn = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (btn) => btn.textContent?.trim() === '创建',
    )!;
    createBtn.click();
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const saved = onSaved.mock.calls[0]![0];
    expect(saved.object).toMatchObject({
      type: 'research.paper',
      name: 'Attention Is All You Need',
      properties: { year: 2017 },
    });

    root.querySelector<HTMLButtonElement>('[aria-label="删除对象"]')!.click();
    await nextTick();
    const confirmBtn = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (btn) => btn.textContent?.trim() === '确认删除',
    )!;
    confirmBtn.click();
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(saved.object.id));
    expect(store.objects.some((item) => item.object.id === saved.object.id)).toBe(false);
  } finally {
    unregister();
  }
});

it('renders unregistered historical project records read-only without losing properties', async () => {
  await adapter.create(
    '.tano/objects/a1b2c3.tano.json',
    JSON.stringify({
      version: 1,
      id: 'a1b2c3',
      type: 'project',
      name: '旧项目',
      description: '保留说明',
      archived: false,
      properties: { phase: 'review', active: true },
    }),
  );
  const store = useWorkspaceStore();
  await store.refresh();
  const legacy = store.objects.find((item) => item.object.id === 'a1b2c3')!;
  expect(legacy).toBeTruthy();

  app = createApp(() => h(ObjectDetailModal, { record: legacy })).use(pinia);
  app.mount(root);
  await nextTick();

  expect(root.textContent).toContain('此类型插件未启用');
  expect(root.textContent).toContain('review');
  expect(root.querySelector<HTMLTextAreaElement>('[aria-label="名称"]')!.disabled).toBe(true);
  expect(
    [...root.querySelectorAll<HTMLButtonElement>('button')].some(
      (btn) => btn.textContent?.trim() === '保存',
    ),
  ).toBe(false);
});
