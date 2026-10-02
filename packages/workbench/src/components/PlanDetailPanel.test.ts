// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import type { WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import type { ReferenceContext } from '../content-references';
const fixture = vi.hoisted(() => ({ store: null as unknown, plans: null as unknown }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
vi.mock('../stores/plans', () => ({ usePlanStore: () => fixture.plans }));
vi.mock('../runtime', () => ({ useWorkbenchRuntime: () => ({}) }));
import PlanDetailPanel from './PlanDetailPanel.vue';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
function record(personal = false): ObjectRecord {
  const object: WorkspaceObject = { version: 1, id: 'b00001', type: 'event', name: '跟进计划', description: '原始描述', archived: false,
    properties: { checkable: true, completed: false, date: '2026-10-02', due: '2026-10-03', owner: 'a00002', custom: { keep: true } } };
  return { object, path: '.tano/objects/b00001.tano.json', snapshot: { content: JSON.stringify(object), hash: 'base', modified: 1 },
    source: { scope: personal ? 'personal' : 'workspace', id: personal ? 'private' : 'ws', name: personal ? '个人' : '项目' } };
}
function mountPanel(initial = record()) {
  const store = reactive({ workspace: { id: 'ws', name: '项目', path: 'workspace' }, objects: [initial], referenceRevision: 'base',
    referenceTargets: [{ workspace: 'ws', type: 'document', id: 'a00001', name: '计划', path: '计划.md' }],
    getReferenceContext: vi.fn(async (): Promise<ReferenceContext> => ({ outgoing: [], incoming: [], errors: [] })), refresh: vi.fn(async () => {}) });
  const plans = reactive({ personalId: 'private', personal: initial.source?.scope === 'personal' ? [initial] : [] as ObjectRecord[],
    workspaceWritable: true, personalWritable: true,
    canEdit: vi.fn((value: ObjectRecord) => value.object.properties.syncReadOnly !== true),
    update: vi.fn(async (value: ObjectRecord, object: WorkspaceObject) => ({ ...value, object,
      snapshot: { content: JSON.stringify(object), hash: 'saved', modified: 2 } })),
    create: vi.fn(async (object: WorkspaceObject, _scope: 'workspace' | 'personal', _expectedId?: string) => ({ ...initial, object: { ...object, id: 'b00002' } })),
    refreshPersonal: vi.fn(async () => {}),
  });
  fixture.store = store; fixture.plans = plans;
  const close = vi.fn(), openReference = vi.fn(), openRecord = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(PlanDetailPanel, { record: initial, onClose: close, onOpenReference: openReference, onOpenRecord: openRecord }));
  app.mount(root);
  return { store, plans, close, openReference, openRecord };
}
async function input(selector: string, value: string) {
  if (selector === 'textarea') {
    if (!root.querySelector('[aria-label=描述]')) await click('编辑描述');
    selector = '[aria-label=描述]';
  }
  const element = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
}
async function click(label: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label)!;
  button.click(); await nextTick();
}

it('edits descriptions and document references without exposing the object inspector or changing other properties', async () => {
  const original = record(); const { plans } = mountPanel(original);
  expect(root.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('任务详情');
  expect(root.textContent).not.toContain('结构化属性');
  expect(root.textContent).not.toContain('Level 2');
  expect([...root.querySelectorAll('select')].filter(select => !select.closest('[aria-label="重复任务"]'))).toHaveLength(0);
  await input('textarea', '需要阅读 ');
  root.querySelector<HTMLTextAreaElement>('[aria-label=描述]')!.setSelectionRange(5, 5);
  await click('插入文档引用');
  root.querySelector<HTMLButtonElement>('.description-candidates button')!.click(); await nextTick();
  await click('保存');
  await vi.waitFor(() => expect(plans.update).toHaveBeenCalledOnce());
  const [base, value] = plans.update.mock.calls[0]!;
  expect(base.snapshot.hash).toBe('base');
  expect(value.description).toBe('需要阅读 [@计划](object://document/a00001)');
  expect(value.properties).toEqual(original.object.properties);
  expect(root.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(true);
});

it('keeps an edited draft across external scans and uses the original base for conflict detection', async () => {
  const original = record(); const { store, plans, close } = mountPanel(original);
  await input('[aria-label=名称]', '本地名称');
  store.objects = [{ ...original, object: { ...original.object, name: '远端名称' }, snapshot: { ...original.snapshot, hash: 'external' } }];
  await nextTick();
  expect(root.querySelector<HTMLInputElement>('[aria-label=名称]')!.value).toBe('本地名称');
  expect(root.textContent).toContain('保存时将尝试合并');
  plans.update.mockRejectedValue(new Error('外部修改冲突，草稿仍保留'));
  await click('保存');
  await vi.waitFor(() => expect(root.textContent).toContain('外部修改冲突'));
  expect(plans.update.mock.calls[0]![0].snapshot.hash).toBe('base');
  expect(original.object.name).toBe('跟进计划');
  await click('关闭任务详情');
  expect(close).not.toHaveBeenCalled();
  expect(root.querySelector('.plan-detail-unsaved')).not.toBeNull();
  await click('继续编辑');
  expect(root.querySelector('.plan-detail-unsaved')).toBeNull();
  expect(root.querySelector<HTMLInputElement>('[aria-label=名称]')!.value).toBe('本地名称');
});

it('copies a conflicting task with its references and extra properties while removing sync ownership', async () => {
  const original = record(); original.object.properties.syncConnection = 'connection'; original.object.properties.syncRemoteId = 'remote';
  const { plans, openRecord } = mountPanel(original);
  await input('textarea', '[计划](object://document/a00001)');
  plans.update.mockRejectedValue(new Error('冲突'));
  await click('保存'); await vi.waitFor(() => expect(root.textContent).toContain('另存副本'));
  await click('另存副本'); await vi.waitFor(() => expect(openRecord).toHaveBeenCalledOnce());
  const [value, scope, id] = plans.create.mock.calls[0]!;
  expect(scope).toBe('workspace'); expect(id).toBe('ws');
  expect(value.description).toBe('[计划](object://document/a00001)');
  expect(value.properties).toMatchObject({ custom: { keep: true }, owner: 'a00002', syncConflictCopy: true });
  expect(value.properties.syncConnection).toBeUndefined();
  expect(value.properties.syncRemoteId).toBeUndefined();
  expect(original.object.description).toBe('原始描述');
});

it('guards reference navigation until unsaved changes are saved or discarded', async () => {
  const { store, plans, openReference } = mountPanel();
  store.getReferenceContext.mockResolvedValue({ outgoing: [{ source: { workspace: 'ws', type: 'event', id: 'b00001', name: '跟进计划', path: '.tano/objects/b00001.tano.json' }, target: { type: 'document', id: 'a00001' }, name: '计划', missing: false, archived: false, excerpt: '关联计划' }], incoming: [], errors: [] });
  await input('textarea', '本地描述');
  await vi.waitFor(() => expect(root.querySelector('.reference-connections button')).not.toBeNull());
  root.querySelector<HTMLButtonElement>('.reference-connections button')!.click(); await nextTick();
  expect(openReference).not.toHaveBeenCalled();
  await click('保存并继续');
  await vi.waitFor(() => expect(openReference).toHaveBeenCalledWith({ type: 'document', id: 'a00001' }));
  expect(plans.update).toHaveBeenCalledOnce();
});

it('isolates personal tasks from workspace references and saves to their original space', async () => {
  const original = record(true); const { plans, store } = mountPanel(original);
  expect(root.querySelector('[aria-label="插入文档引用"]')).toBeNull();
  await input('textarea', '个人备注');
  await click('保存'); await vi.waitFor(() => expect(plans.update).toHaveBeenCalledOnce());
  expect(plans.update.mock.calls[0]![0].source).toEqual(original.source);
  expect(store.getReferenceContext).not.toHaveBeenCalled();
});

it('disables writes for read-only tasks and after switching workspaces', async () => {
  const original = record(); original.object.properties.syncReadOnly = true;
  const { store, plans } = mountPanel(original);
  expect(root.textContent).toContain('只读连接');
  expect(root.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true);
  store.workspace = { id: 'another', name: '其他', path: 'elsewhere' }; await nextTick();
  expect(root.textContent).toContain('所属空间已切换');
  await click('保存'); expect(plans.update).not.toHaveBeenCalled();
});

it('saves completion, due date and inclusive all-day ranges without losing the event model', async () => {
  const original = record(); original.object.properties = { checkable: true, completed: false, allDay: true,
    start: new Date('2026-10-02T00:00:00').toISOString(), end: new Date('2026-10-05T00:00:00').toISOString() };
  const { plans } = mountPanel(original);
  const values = () => [...root.querySelectorAll<HTMLInputElement>('.plan-date-inputs input')].map(input => input.value);
  expect(values()).toEqual(['2026-10-02', '2026-10-04']);
  const completed = root.querySelector<HTMLInputElement>('[aria-label=已完成]')!;
  completed.checked = true; completed.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
  await input('.plan-detail-due input', '2026-10-06');
  await click('保存'); await vi.waitFor(() => expect(plans.update).toHaveBeenCalledOnce());
  expect(plans.update.mock.calls[0]![1].properties).toEqual({ ...original.object.properties, completed: true, due: '2026-10-06' });
});

it('keeps legacy task completion and status consistent', async () => {
  const original = record(); original.object.type = 'task'; original.object.properties = { status: 'done' };
  const { plans } = mountPanel(original);
  const completed = root.querySelector<HTMLInputElement>('[aria-label=已完成]')!;
  expect(completed.checked).toBe(true);
  completed.checked = false; completed.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
  await click('保存'); await vi.waitFor(() => expect(plans.update).toHaveBeenCalledOnce());
  expect(plans.update.mock.calls[0]![1]).toMatchObject({ type: 'task', properties: { completed: false, status: 'todo' } });
});
