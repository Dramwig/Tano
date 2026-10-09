import { computed, onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import { parseObject, validateObjectProperties } from '@tano/protocol';
import type { WorkspaceObject } from '@tano/protocol';
import { useWorkbenchRuntime } from '../runtime';
import { BrowserPersonalPlans, NativePersonalPlans, PERSONAL_PLANS_KEY } from '../personal-plans';
import { loadObjects, saveObject } from '../workspace-objects';
import type { ObjectRecord } from '../workspace-objects';
import { useWorkspaceStore } from './workspace';
import { recordHelpPlanEdit } from '../help-checklist';

export type PlanScope = 'workspace' | 'personal';
export const usePlanStore = defineStore('plans', () => {
  const runtime = useWorkbenchRuntime();
  const workspace = useWorkspaceStore();
  const adapter =
    runtime.personalPlans ??
    (runtime.native ? new NativePersonalPlans() : new BrowserPersonalPlans());
  const view = ref<PlanScope | 'all'>('workspace');
  const personalId = ref('');
  const personal = ref<ObjectRecord[]>([]);
  const errors = ref<string[]>([]);
  const loadError = ref('');
  const requiresDesktopRestart = ref(false);
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const task = queue.then(run, run);
    queue = task.catch(() => {});
    return task;
  }
  async function load() {
    const space = await adapter.refresh();
    const loaded = await loadObjects(adapter, space);
    personalId.value = space.id;
    personal.value = loaded.records.map((record) => ({
      ...record,
      source: { scope: 'personal', id: space.id, name: '个人' },
    }));
    errors.value = loaded.errors;
    loadError.value = '';
    requiresDesktopRestart.value = false;
  }
  const refreshPersonal = () =>
    serial(async () => {
      try {
        await load();
      } catch (error) {
        const message = String(error);
        requiresDesktopRestart.value = /command\s+personal_plans_\w+\s+not found/i.test(message);
        loadError.value = requiresDesktopRestart.value
          ? '当前桌面版本尚不支持个人计划，请更新并重启应用后重试。'
          : message;
      }
    });
  const personalWritable = computed(
    () => !!personalId.value && !loadError.value && !errors.value.length,
  );
  const workspaceWritable = computed(
    () =>
      !!workspace.workspace &&
      !workspace.workspace.readOnly &&
      workspace.capabilities.features.objectReferences,
  );
  const defaultScope = computed<PlanScope>(() =>
    view.value === 'personal' || !workspace.workspace ? 'personal' : 'workspace',
  );
  const workspaceRecords = computed<ObjectRecord[]>(() =>
    workspace.workspace
      ? workspace.objects.map((record) => ({
          ...record,
          source: {
            scope: 'workspace',
            id: workspace.workspace!.id,
            name: workspace.workspace!.name,
          },
        }))
      : [],
  );
  const records = computed(() =>
    view.value === 'personal'
      ? personal.value
      : view.value === 'workspace'
        ? workspaceRecords.value
        : [...workspaceRecords.value, ...personal.value],
  );
  function canEdit(record: ObjectRecord) {
    if (record.object.properties.syncReadOnly === true) return false;
    return record.source?.scope === 'personal'
      ? personalWritable.value && record.source.id === personalId.value
      : workspaceWritable.value && (!record.source || record.source.id === workspace.workspace?.id);
  }
  async function createPersonal(
    value: Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'properties' | 'archived'>,
  ) {
    return serial(async () => {
      await load();
      if (!personalWritable.value) throw new Error('请先修复个人计划存储');
      if (value.type !== 'event') throw new Error('个人计划仅支持事件');
      validateObjectProperties(value.type, value.properties);
      if (!adapter.reserveObjectId) throw new Error('个人计划存储尚未实现短 ID 分配');
      const id = await adapter.reserveObjectId(personal.value.map((record) => record.object.id));
      const object = parseObject(JSON.stringify({ ...value, version: 1, id }));
      const path = `.tano/objects/${id}.tano.json`;
      const content = JSON.stringify(object, null, 2) + '\n';
      await adapter.create(path, content);
      const snapshot = await adapter.read(path);
      const persisted = parseObject(snapshot.content);
      if (persisted.id !== id || persisted.type !== 'event')
        throw new Error('个人事项在创建后被外部修改，请重新加载');
      const record: ObjectRecord = {
        object: persisted,
        path,
        snapshot,
        source: { scope: 'personal', id: personalId.value, name: '个人' },
      };
      personal.value = [...personal.value, record];
      recordHelpPlanEdit(undefined, object);
      return record;
    });
  }
  async function updatePersonal(record: ObjectRecord, value: WorkspaceObject, expectedId: string) {
    return serial(async () => {
      if (
        expectedId !== personalId.value ||
        record.source?.scope !== 'personal' ||
        record.source.id !== expectedId
      )
        throw new Error('个人事项来源已变化，请重新打开');
      if (value.type !== 'event') throw new Error('个人计划仅支持事件');
      const saved = { ...(await saveObject(adapter, record, value)), source: record.source };
      personal.value = personal.value.map((item) =>
        item.object.id === saved.object.id ? saved : item,
      );
      recordHelpPlanEdit(record.object, value);
      return saved;
    });
  }
  function create(
    value: Parameters<typeof createPersonal>[0],
    scope: PlanScope,
    expectedWorkspace?: string,
  ) {
    if (scope === 'personal') return createPersonal(value);
    if (!expectedWorkspace || workspace.workspace?.id !== expectedWorkspace)
      throw new Error('工作区已切换，请重新选择保存位置');
    return workspace.createObject(value);
  }
  function update(record: ObjectRecord, value: WorkspaceObject) {
    if (record.source?.scope === 'personal') return updatePersonal(record, value, record.source.id);
    const id = record.source?.id ?? workspace.workspace?.id;
    if (!id) throw new Error('工作区已关闭');
    return workspace.updateObject(record, value, id);
  }
  const panel = computed(() => ({
    id: personalId.value,
    records: personal.value,
    errors: [...errors.value, ...(loadError.value ? [loadError.value] : [])],
    writable: personalWritable.value,
    createObject: createPersonal,
    updateObject: updatePersonal,
  }));
  const onFocus = () => {
    if (!requiresDesktopRestart.value) void refreshPersonal();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === PERSONAL_PLANS_KEY || event.key === null) onFocus();
  };
  // External file edits and other windows are visible without changing workspaces.
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') onFocus();
  }, 15000);
  window.addEventListener('focus', onFocus);
  window.addEventListener('storage', onStorage);
  onScopeDispose(() => {
    clearInterval(timer);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('storage', onStorage);
  });
  void refreshPersonal();
  return {
    view,
    personalId,
    personal,
    errors,
    loadError,
    requiresDesktopRestart,
    records,
    defaultScope,
    personalWritable,
    workspaceWritable,
    panel,
    refreshPersonal,
    canEdit,
    create,
    update,
    createPersonal,
    updatePersonal,
  };
});
