// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { BrowserPersonalPlans, PERSONAL_PLANS_KEY, planKey } from './personal-plans';
import { loadObjects, saveObject } from './workspace-objects';
import type { ObjectStorage } from './workspace-objects';
import { configureWorkbench } from './runtime';
import { DemoAdapter } from './adapter';
import { usePlanStore } from './stores/plans';
import { useWorkspaceStore } from './stores/workspace';

const value = (name = '个人计划') => ({
  version: 1 as const,
  id: 'a00001',
  type: 'event',
  name,
  description: '',
  archived: false,
  properties: { checkable: true, completed: false },
});
const path = '.tano/objects/a00001.tano.json';
const piniaInstances: ReturnType<typeof createPinia>[] = [];
beforeEach(() => {
  localStorage.clear();
  let queue = Promise.resolve<unknown>(undefined);
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, run: () => unknown) => {
        const task = queue.then(run, run);
        queue = task.catch(() => {});
        return task;
      },
    },
  });
});
afterEach(() => {
  for (const pinia of piniaInstances.splice(0)) disposePinia(pinia);
  vi.unstubAllGlobals();
});
function stores(personalPlans?: ObjectStorage) {
  const pinia = createPinia();
  piniaInstances.push(pinia);
  configureWorkbench(pinia, {
    adapter: new DemoAdapter(),
    native: false,
    mobile: false,
    personalPlans,
  });
  setActivePinia(pinia);
  return { plans: usePlanStore(), workspace: useWorkspaceStore() };
}
it('keeps personal data outside workspace files, after workspace close and after restarting the workbench', async () => {
  const first = stores();
  await first.workspace.openWorkspace();
  await first.plans.refreshPersonal();
  const record = await first.plans.create(value(), 'personal');
  expect(first.workspace.objects).toHaveLength(0);
  expect(first.workspace.workspace!.files.some((file) => file.path === record.path)).toBe(false);
  first.plans.view = 'personal';
  await first.workspace.leaveWorkspace();
  expect(first.plans.records.map((item) => item.object.name)).toEqual(['个人计划']);
  expect(first.plans.canEdit(first.plans.records[0]!)).toBe(true);
  first.workspace.dispose();
  const second = stores();
  await second.plans.refreshPersonal();
  expect(second.plans.personal[0]!.object.id).toBe(record.object.id);
  await second.plans.update(second.plans.personal[0]!, {
    ...record.object,
    name: '无需工作区也可编辑',
  });
  expect(second.plans.personal[0]!.object.name).toBe('无需工作区也可编辑');
  second.workspace.dispose();
});
it('merges independent edits between two windows and preserves both versions on a conflicting edit', async () => {
  const first = new BrowserPersonalPlans(),
    second = new BrowserPersonalPlans();
  await first.create(path, JSON.stringify(value()));
  const before = (await loadObjects(first, await first.refresh())).records[0]!;
  await second.write(
    path,
    JSON.stringify({ ...value(), description: '另一窗口修改' }),
    before.snapshot.hash,
  );
  const merged = await saveObject(first, before, { ...value(), name: '我的改名' });
  expect(merged.object.description).toBe('另一窗口修改');
  expect(merged.object.name).toBe('我的改名');
  const draft = { ...before.object, name: '冲突草稿' };
  await expect(saveObject(second, before, draft)).rejects.toThrow('冲突');
  expect(JSON.parse((await first.read(path)).content).name).toBe('我的改名');
  expect(draft.name).toBe('冲突草稿');
});
it('serializes competing browser writes without silently replacing the winner', async () => {
  const first = new BrowserPersonalPlans(),
    second = new BrowserPersonalPlans();
  await first.create(path, JSON.stringify(value()));
  const before = await first.read(path);
  const results = await Promise.all([
    first.write(path, JSON.stringify(value('窗口一')), before.hash),
    second.write(path, JSON.stringify(value('窗口二')), before.hash),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(['conflict', 'saved']);
  expect(JSON.parse((await first.read(path)).content).name).toBe('窗口一');
});
it('preserves corrupt personal storage and refuses to create over it', async () => {
  localStorage.setItem(PERSONAL_PLANS_KEY, 'broken');
  const adapter = new BrowserPersonalPlans();
  await expect(adapter.refresh()).rejects.toThrow('原数据已保留');
  await expect(adapter.create(path, JSON.stringify(value()))).rejects.toThrow('原数据已保留');
  expect(localStorage.getItem(PERSONAL_PLANS_KEY)).toBe('broken');
});
it('rejects unsafe paths, mismatched identities and mutations without a browser lock', async () => {
  const adapter = new BrowserPersonalPlans();
  await expect(adapter.create('../outside', JSON.stringify(value()))).rejects.toThrow('路径');
  await expect(adapter.create(path, JSON.stringify({ ...value(), id: 'a00002' }))).rejects.toThrow(
    'ID',
  );
  vi.stubGlobal('navigator', {});
  await expect(adapter.create(path, JSON.stringify(value()))).rejects.toThrow('Web Locks');
  expect(localStorage.getItem(PERSONAL_PLANS_KEY)).toBeNull();
});
it('never routes stale workspace mutations into the newly selected workspace', async () => {
  const { plans, workspace } = stores();
  await workspace.openWorkspace();
  const shared = await workspace.createObject(value('工作区事项'));
  const captured = plans.records.find((record) => record.object.id === shared.object.id)!;
  workspace.workspace!.id = 'another-workspace';
  await expect(plans.update(captured, { ...captured.object, name: '旧界面保存' })).rejects.toThrow(
    '工作区已切换',
  );
  expect(() => plans.create(value(), 'workspace', 'demo')).toThrow('工作区已切换');
  expect(
    planKey({ ...captured, source: { scope: 'personal', id: 'private', name: '个人' } }),
  ).not.toBe(planKey(captured));
  workspace.dispose();
});

it('keeps the base object consistent with the file hash when an external edit follows creation', async () => {
  const adapter = new BrowserPersonalPlans();
  const create = adapter.create.bind(adapter);
  vi.spyOn(adapter, 'create').mockImplementation(async (path, content) => {
    await create(path, content);
    const snapshot = await adapter.read(path);
    await adapter.write(
      path,
      JSON.stringify({ ...JSON.parse(content), description: '创建之后的外部修改' }),
      snapshot.hash,
    );
  });
  const { plans, workspace } = stores(adapter);
  const created = await plans.createPersonal(value());
  expect(created.object).toEqual(JSON.parse(created.snapshot.content));
  expect(created.object.description).toBe('创建之后的外部修改');
  await plans.updatePersonal(
    created,
    { ...created.object, name: '保留外部描述' },
    plans.personalId,
  );
  expect(JSON.parse((await adapter.read(created.path)).content).description).toBe(
    '创建之后的外部修改',
  );
  workspace.dispose();
});
