// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { usePlanStore } from '../stores/plans';
import { planKey } from '../personal-plans';
import SidebarPlan from './SidebarPlan.vue';

vi.mock('motion/mini', () => ({
  animate: vi.fn(() => ({ stop: vi.fn(), cancel: vi.fn(), finished: Promise.resolve() })),
}));

let app: App;
let root: HTMLElement;
let adapter: DemoAdapter;
let store: ReturnType<typeof useWorkspaceStore>;
let plans: ReturnType<typeof usePlanStore>;
let pinia: ReturnType<typeof createPinia>;
const active = ref(true);
const date = ref(new Date(2026, 9, 8));
const select = vi.fn();

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('navigator', {
    locks: { request: async (_name: string, run: () => unknown) => run() },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  active.value = true;
  date.value = new Date(2026, 9, 8);
  select.mockClear();
  pinia = createPinia();
  adapter = new DemoAdapter();
  configureWorkbench(pinia, { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.openWorkspace();
  plans = usePlanStore();
  await plans.refreshPersonal();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() =>
    h(SidebarPlan, { date: date.value, active: active.value, 'onSelect-event': select }),
  );
  app.use(pinia);
  app.mount(root);
});
afterEach(() => {
  app.unmount();
  store.dispose();
  disposePinia(pinia);
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function create(
  name = '整理资料',
  properties: Record<string, unknown> = { checkable: true },
) {
  const record = await store.createObject({
    type: 'event',
    name,
    description: '保留内容',
    archived: false,
    properties,
  });
  await nextTick();
  return record;
}
function row(name = '整理资料', section?: string) {
  const container = section ? root.querySelector(`[aria-label="${section}"]`)! : root;
  return [...container.querySelectorAll<HTMLButtonElement>('.plan-event-detail')].find(
    (button) => button.querySelector('strong')?.textContent === name,
  )!;
}
const menu = () => document.querySelector<HTMLElement>('.plan-event-context-menu');
const items = () => [...(menu()?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
function key(target: Element, value: string, shiftKey = false) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }),
  );
}
async function settle() {
  await nextTick();
  await nextTick();
  await nextTick();
}
async function open(name = '整理资料', section?: string, x = 100, y = 150) {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  row(name, section).dispatchEvent(event);
  await settle();
  expect(event.defaultPrevented).toBe(true);
  expect(menu()).not.toBeNull();
}
async function action(label: string) {
  const button = items().find((button) => button.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  button!.click();
  await settle();
}

it('opens the shared compact menu without selecting or changing a task and edits through the existing detail route', async () => {
  const record = await create();
  const update = vi.spyOn(plans, 'update');
  await open();
  expect(menu()!.classList.contains('compact-action-menu')).toBe(true);
  expect(menu()!.parentElement).toBe(document.body);
  expect(items().map((item) => item.textContent?.trim())).toEqual([
    '编辑任务',
    '标记完成',
    '归档任务',
  ]);
  expect(row().getAttribute('aria-expanded')).toBe('true');
  expect(select).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  await action('编辑任务');
  expect(select).toHaveBeenCalledWith(record.object.id);
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(row());
});

it('completes and reopens persisted tasks from unscheduled, completed, and daily lists', async () => {
  await create();
  await open();
  await action('标记完成');
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(true));
  root.querySelector<HTMLButtonElement>('[aria-label="已完成"]')!.click();
  await settle();
  await open('整理资料', '已完成任务');
  await action('标记未完成');
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(false));
  expect(row('整理资料', '未安排任务')).toBeDefined();
  const record = store.objects[0]!;
  await plans.update(record, {
    ...record.object,
    properties: { ...record.object.properties, date: '2026-10-08' },
  });
  await settle();
  await open('整理资料', '当天安排');
  await action('标记完成');
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(true));
  expect(root.querySelector<HTMLInputElement>('[aria-label="当天安排"] input')!.checked).toBe(true);
  expect(root.querySelector<HTMLInputElement>('[aria-label="已完成任务"] input')!.checked).toBe(
    true,
  );
  expect(JSON.parse((await adapter.read(record.path)).content).properties.completed).toBe(true);
});

it('offers event actions without completion and archives using the base hash while merging external edits', async () => {
  const record = await create('项目讨论', { date: '2026-10-08' });
  await open('项目讨论', '当天安排');
  expect(items().map((item) => item.textContent?.trim())).toEqual(['编辑事件', '归档事件']);
  const external = { ...record.object, description: '外部补充的内容' };
  expect(
    (await adapter.write(record.path, JSON.stringify(external), record.snapshot.hash)).status,
  ).toBe('saved');
  await action('归档事件');
  await vi.waitFor(() => expect(store.objects[0]!.object.archived).toBe(true));
  expect(store.objects[0]!.object.description).toBe('外部补充的内容');
  expect(store.objects[0]!.object.id).toBe(record.object.id);
  expect(root.textContent).not.toContain('项目讨论');
  expect(JSON.parse((await adapter.read(record.path)).content)).toMatchObject({
    archived: true,
    description: '外部补充的内容',
  });
});

it('keeps personal and workspace actions isolated even when their short IDs collide', async () => {
  const workspaceRecord = await create('工作区事项');
  const personal = await plans.createPersonal({
    type: 'event',
    name: '个人事项',
    description: '',
    archived: false,
    properties: { checkable: true },
  });
  store.objects[0]!.object.id = personal.object.id;
  plans.view = 'all';
  await settle();
  await open('个人事项');
  await action('编辑任务');
  expect(select).toHaveBeenCalledWith(planKey(personal));
  await open('个人事项');
  await action('归档任务');
  await vi.waitFor(() => expect(plans.personal[0]!.object.archived).toBe(true));
  expect(workspaceRecord.object.archived).toBe(false);
  expect(row('工作区事项')).toBeDefined();
  expect(row('个人事项')).toBeUndefined();
});

it('disables writes for readonly or pending tasks and preserves state and reports failed writes', async () => {
  await create();
  store.workspace!.readOnly = true;
  await open();
  expect(items()[0]!.textContent).toContain('查看详情');
  expect(
    items()
      .slice(1)
      .every((button) => button.disabled),
  ).toBe(true);
  await action('查看详情');
  expect(select).toHaveBeenCalledOnce();
  store.workspace!.readOnly = false;
  let reject!: (error: Error) => void;
  const update = vi.spyOn(store, 'updateObject').mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await open();
  await action('标记完成');
  await open();
  expect(
    items()
      .slice(1)
      .every((button) => button.disabled),
  ).toBe(true);
  items()[2]!.click();
  expect(update).toHaveBeenCalledOnce();
  reject(new Error('外部修改冲突'));
  await vi.waitFor(() =>
    expect(root.querySelector('[role=alert]')?.textContent).toContain('外部修改冲突'),
  );
  expect(store.objects[0]!.object.properties.completed).not.toBe(true);
  expect(store.objects[0]!.object.archived).toBe(false);
});

it('supports keyboard navigation, viewport bounds, outside dismissal and sidebar lifecycle changes', async () => {
  await create();
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(184);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(95);
  await open('整理资料', undefined, window.innerWidth - 1, window.innerHeight - 1);
  expect(menu()!.style.left).toBe(`${window.innerWidth - 192}px`);
  expect(menu()!.style.top).toBe(`${window.innerHeight - 103}px`);
  expect(document.activeElement).toBe(items()[0]);
  key(items()[0]!, 'ArrowUp');
  expect(document.activeElement).toBe(items()[2]);
  key(items()[2]!, 'Home');
  expect(document.activeElement).toBe(items()[0]);
  key(items()[0]!, 'End');
  expect(document.activeElement).toBe(items()[2]);
  key(items()[2]!, 'Escape');
  await settle();
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(row());
  for (const [value, shift] of [
    ['ContextMenu', false],
    ['F10', true],
  ] as const) {
    key(row(), value, shift);
    await settle();
    expect(menu()).not.toBeNull();
    key(items()[0]!, 'Escape');
    await settle();
  }
  for (const type of ['pointerdown', 'contextmenu', 'scroll', 'resize']) {
    await open();
    (type === 'resize' ? window : document.body).dispatchEvent(new Event(type, { bubbles: true }));
    await settle();
    expect(menu()).toBeNull();
  }
  await open();
  active.value = false;
  await settle();
  expect(menu()).toBeNull();
  active.value = true;
  await settle();
  await open();
  date.value = new Date(2026, 9, 9);
  await settle();
  expect(menu()).toBeNull();
  await open();
  plans.view = 'personal';
  await settle();
  expect(menu()).toBeNull();
});

it('does not let the context menu bypass a pending delivery review', async () => {
  await create();
  store.objects[0]!.object.properties.deliveryReview = {
    version: 1,
    id: crypto.randomUUID(),
    documentId: 'abcdef',
    documentHash: 'a'.repeat(64),
    criteriaHash: 'b'.repeat(64),
    reviewerId: '123abc',
    submitterId: '456def',
    state: 'pending',
    submittedAt: '2026-10-08T09:00:00Z',
  };
  await open();
  expect(items()[1]!.disabled).toBe(true);
  expect(items()[1]!.title).toContain('验收');
  expect(root.querySelector<HTMLInputElement>('[aria-label="完成：整理资料"]')!.disabled).toBe(
    true,
  );
  items()[1]!.click();
  expect(store.objects[0]!.object.properties.completed).not.toBe(true);
});
