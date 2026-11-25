// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import { coreObjectTypes, coreRelationTypes } from '@tano/protocol';
import type { WorkspaceObject, WorkspaceViewDefinition } from '@tano/protocol';
import ObjectDatabasePage from './ObjectDatabasePage.vue';

const fixture = vi.hoisted(() => ({ store: null as any }));
vi.mock('../../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
vi.mock('../../runtime', () => ({ useWorkbenchRuntime: () => ({}) }));

let app: App | undefined;
let root: HTMLDivElement;

afterEach(() => {
  app?.unmount();
  root?.remove();
});

it('hides legacy task creation button and syncs completed when changing event status', async () => {
  const eventTask: WorkspaceObject = {
    version: 1,
    id: 'a00001',
    type: 'event',
    name: '统一任务',
    description: '',
    archived: false,
    properties: { checkable: true, completed: false, status: '进行中' },
  };
  const view: WorkspaceViewDefinition = {
    version: 1,
    layer: 'view',
    workspaceId: 'ws',
    id: 'v00001',
    name: '任务看板',
    kind: 'table',
    sources: [],
    objectDatabase: {
      layout: 'table',
      types: ['event', 'task'],
      includeArchived: false,
      filters: [],
      sort: { field: 'name', direction: 'asc' },
      groupBy: 'property:status',
    },
  };
  const updateObject = vi.fn(async (record, value) => ({ ...record, object: value }));
  fixture.store = reactive({
    workspace: { id: 'ws', readOnly: false },
    capabilities: { features: { objectReferences: true } },
    workspaceSettings: { showPeopleDirectory: true },
    objectDefinitions: coreObjectTypes,
    relationDefinitions: coreRelationTypes,
    relations: [],
    referenceTargets: [],
    objectErrors: [],
    objects: [
      {
        object: eventTask,
        path: '.tano/objects/a00001.tano.json',
        snapshot: { content: JSON.stringify(eventTask), hash: 'h1', modified: 1 },
      },
    ],
    workspaceViews: [
      {
        view,
        path: '.tano/views/v00001.tano.json',
        snapshot: { content: JSON.stringify(view), hash: 'vh1', modified: 1 },
      },
    ],
    updateObject,
  });

  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(ObjectDatabasePage, { view }));
  app.mount(root);
  await nextTick();

  const createLabels = [...root.querySelectorAll('.controls button')].map((b) => b.textContent?.trim());
  expect(createLabels).toContain('新建事件');
  expect(createLabels).not.toContain('新建任务');

  const statusSelect = root.querySelector<HTMLSelectElement>('select[aria-label="状态：统一任务"]')!;
  statusSelect.value = '已完成';
  statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(updateObject).toHaveBeenCalledTimes(1));
  expect(updateObject.mock.calls[0]![1].properties).toMatchObject({
    checkable: true,
    status: '已完成',
    completed: true,
  });
});
