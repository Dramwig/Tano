// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { calendarEvents } from '../calendar';
import SidebarPlan from './SidebarPlan.vue';

let app: App;
let root: HTMLElement;
let store: ReturnType<typeof useWorkspaceStore>;
let pinia: ReturnType<typeof createPinia>;
const date = ref(new Date(2026, 8, 29));
const selectEvent = vi.fn();
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  date.value = new Date(2026, 8, 29);
  selectEvent.mockClear();
  pinia = createPinia();
  configureWorkbench(pinia, { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.openWorkspace();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() =>
    h(SidebarPlan, {
      date: date.value,
      'onSelect-date': (value: Date) => {
        date.value = value;
      },
      'onSelect-event': selectEvent,
    }),
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
const control = <T extends HTMLElement>(label: string) =>
  document.querySelector<T>(`[aria-label="${label}"]`)!;
const section = (name: string) => root.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
async function quickAdd(name: string) {
  control<HTMLButtonElement>('添加未安排任务').click();
  await nextTick();
  const input = control<HTMLInputElement>('事件名称');
  input.value = name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}
const submit = () =>
  document
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

it('creates, completes, reopens and schedules one persisted event while the sidebar follows the selected date', async () => {
  await quickAdd('整理资料');
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  const id = store.objects[0]!.object.id;
  expect(store.objects[0]!.object).toMatchObject({
    type: 'event',
    properties: { checkable: true, completed: false },
  });
  expect(section('未安排任务').textContent).toContain('整理资料');
  control<HTMLInputElement>('完成：整理资料').click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(true));
  expect(control<HTMLInputElement>('标记未完成：整理资料').checked).toBe(true);
  control<HTMLInputElement>('标记未完成：整理资料').click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(false));
  control<HTMLButtonElement>('将 整理资料 安排到 2026-09-29').click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.date).toBe('2026-09-29'));
  expect(store.objects).toHaveLength(1);
  expect(store.objects[0]!.object.id).toBe(id);
  expect(section('当天安排').textContent).toContain('整理资料');
  expect(section('未安排任务').textContent).not.toContain('整理资料');
  date.value = new Date(2026, 8, 30);
  await nextTick();
  expect(section('当天安排').textContent).not.toContain('整理资料');
  expect(control<HTMLButtonElement>('2026-09-30，0 个事件').getAttribute('aria-pressed')).toBe(
    'true',
  );
  const persisted = JSON.parse(localStorage.getItem('tano.demo.v2')!);
  expect(JSON.parse(persisted.files[store.objects[0]!.path].content).properties.date).toBe(
    '2026-09-29',
  );
});

it('creates ordinary timed events through the same form and opens their detail', async () => {
  await quickAdd('项目讨论');
  document.querySelector<HTMLInputElement>('.plan-checkable input')!.click();
  await nextTick();
  expect(document.querySelectorAll('input[type=datetime-local]')).toHaveLength(2);
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  expect(store.objects[0]!.object).toMatchObject({
    type: 'event',
    properties: { checkable: false },
  });
  expect(calendarEvents(store.objects)).toHaveLength(1);
  expect(section('当天安排').querySelector('input[type=checkbox]')).toBeNull();
  section('当天安排').querySelector<HTMLButtonElement>('.plan-event-detail')!.click();
  expect(selectEvent).toHaveBeenCalledWith(store.objects[0]!.object.id);
});

it('selects a schedule with the keyboard and cancels the draft with Escape even when its menu is open', async () => {
  await quickAdd('日期任务');
  const trigger = control<HTMLButtonElement>('时间安排');
  trigger.click();
  await nextTick();
  const menu = document.querySelector<HTMLElement>('[role=menu]')!;
  expect(document.activeElement?.textContent?.trim()).toBe('未安排');
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement?.textContent?.trim()).toBe('仅日期');
  (document.activeElement as HTMLButtonElement).click();
  await nextTick();
  expect(document.querySelector('[role=menu]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  const day = document.querySelector<HTMLInputElement>('input[type=date]')!;
  day.value = '2026-10-02';
  day.dispatchEvent(new Event('input', { bubbles: true }));
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  expect(store.objects[0]!.object.properties).toMatchObject({
    checkable: true,
    date: '2026-10-02',
  });
  expect(calendarEvents(store.objects)).toHaveLength(0);
  await quickAdd('取消草稿');
  control<HTMLButtonElement>('时间安排').click();
  await nextTick();
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
  expect(store.objects).toHaveLength(1);
});

it('preserves the creation draft and resets the completion checkbox when storage rejects a write', async () => {
  const create = vi
    .spyOn(store, 'createObject')
    .mockRejectedValueOnce(new Error('保存失败，请重试'));
  await quickAdd('保留草稿');
  submit();
  await vi.waitFor(() =>
    expect(document.querySelector('[role=alert]')?.textContent).toContain('保存失败'),
  );
  expect(control<HTMLInputElement>('事件名称').value).toBe('保留草稿');
  create.mockRestore();
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  vi.spyOn(store, 'updateObject').mockRejectedValueOnce(new Error('外部修改冲突'));
  control<HTMLInputElement>('完成：保留草稿').click();
  await vi.waitFor(() =>
    expect(root.querySelector('[role=alert]')?.textContent).toContain('外部修改冲突'),
  );
  await nextTick();
  expect(store.objects[0]!.object.properties.completed).toBe(false);
  expect(control<HTMLInputElement>('完成：保留草稿').checked).toBe(false);
});

it('opens a separate panel with the selected date and returns keyboard focus when dismissed', async () => {
  const trigger = control<HTMLButtonElement>('为 9 月 29 日 添加事件');
  trigger.focus();
  trigger.click();
  await nextTick();
  const panel = document.querySelector<HTMLElement>('[role=dialog][aria-label="新建事件"]')!;
  expect(panel).not.toBeNull();
  expect(root.contains(panel)).toBe(false);
  expect(root.querySelector('form')).toBeNull();
  expect(document.activeElement).toBe(control<HTMLInputElement>('事件名称'));
  expect(panel.querySelector<HTMLInputElement>('input[type=date]')!.value).toBe('2026-09-29');
  const close = control<HTMLButtonElement>('关闭新建事件');
  close.focus();
  close.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(document.activeElement?.textContent?.trim()).toBe('取消');
  panel.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(store.objects).toHaveLength(0);
});

it('keeps the panel open during saving and closes it once the event is persisted', async () => {
  const create = store.createObject;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(store, 'createObject').mockImplementation(async (value) => {
    await gate;
    return create(value);
  });
  await quickAdd('等待保存');
  submit();
  await nextTick();
  const panel = document.querySelector<HTMLElement>('[role=dialog]')!;
  expect(control<HTMLButtonElement>('关闭新建事件').disabled).toBe(true);
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  panel.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await nextTick();
  expect(document.querySelector('[role=dialog]')).toBe(panel);
  release();
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
  expect(section('未安排任务').textContent).toContain('等待保存');
});

it('disables every mutation in read-only workspaces and normalizes new legacy task requests to events', async () => {
  await store.createObject({
    type: 'task',
    name: '旧接口新任务',
    description: '',
    archived: false,
    properties: { status: 'todo' },
  });
  expect(store.objects[0]!.object.type).toBe('event');
  store.workspace!.readOnly = true;
  await nextTick();
  expect(control<HTMLButtonElement>('添加事件').disabled).toBe(true);
  expect(control<HTMLInputElement>('完成：旧接口新任务').disabled).toBe(true);
  expect(control<HTMLButtonElement>('将 旧接口新任务 安排到 2026-09-29').disabled).toBe(true);
});
