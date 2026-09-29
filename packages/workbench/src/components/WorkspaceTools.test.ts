// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { relationPath } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
const fixture = vi.hoisted(() => ({ adapter: null as unknown }));
import { useWorkspaceStore } from '../stores/workspace';
import WorkspaceTools from './WorkspaceTools.vue';
import PluginInstaller from './PluginInstaller.vue';
import type { WorkspaceTool } from './WorkspaceTools.vue';
let app: App,
  root: HTMLElement,
  pinia: ReturnType<typeof createPinia>,
  store: ReturnType<typeof useWorkspaceStore>;
const tab = ref<WorkspaceTool>('relations'),
  open = ref(true);
beforeEach(async () => {
  localStorage.clear();
  fixture.adapter = new DemoAdapter();
  pinia = createPinia();
  configureWorkbench(pinia, { adapter: fixture.adapter as DemoAdapter, native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.openWorkspace();
  tab.value = 'relations';
  open.value = true;
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() =>
    h('div', [
      h(PluginInstaller),
      h(WorkspaceTools, {
        tab: tab.value,
        open: open.value,
        onTab: (value) => {
          tab.value = value;
        },
      }),
    ]),
  );
  app.use(pinia);
  app.mount(root);
  await nextTick();
});
afterEach(() => {
  app.unmount();
  store.dispose();
  disposePinia(pinia);
  root.remove();
});
function button(text: string, selector = 'button') {
  return [...root.querySelectorAll<HTMLButtonElement>(selector)].find(
    (element) => element.textContent?.trim() === text,
  )!;
}
async function fill(label: string, value: string) {
  const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${label}"]`,
  )!;
  input.value = value;
  input.dispatchEvent(
    new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
  );
  await nextTick();
}
it('installs through the UI, connects plugin objects, and restores references after disabling/re-enabling', async () => {
  button('安装插件').click();
  await vi.waitFor(() => expect(store.installedPlugins).toHaveLength(1));
  const paper = await store.createObject({
    type: 'research.paper',
    name: '同名对象',
    properties: {},
    description: '',
    archived: false,
  });
  const dataset = await store.createObject({
    type: 'research.dataset',
    name: '同名对象',
    properties: {},
    description: '',
    archived: false,
  });
  tab.value = 'relations';
  await nextTick();
  await fill('关系类型', 'research.uses');
  await fill('关系来源', `research.paper/${paper.object.id}`);
  await fill('关系目标', `research.dataset/${dataset.object.id}`);
  root
    .querySelector('form.relation-composer')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(store.relations).toHaveLength(1));
  expect(store.relations[0]).toMatchObject({
    type: 'research.uses',
    source: { id: paper.object.id },
    target: { id: dataset.object.id },
  });
  expect(store.referenceTargets.some((item) => item.path === relationPath)).toBe(false);
  await fill('筛选对象', `research.dataset/${dataset.object.id}`);
  await fill('关系方向', 'incoming');
  expect(root.querySelectorAll('.relation-list li')).toHaveLength(1);
  await fill('关系方向', 'outgoing');
  expect(root.querySelectorAll('.relation-list li')).toHaveLength(0);
  button('停用').click();
  await vi.waitFor(() =>
    expect(store.referenceTargets.some((item) => item.type === 'research.paper')).toBe(false),
  );
  expect(store.relations).toHaveLength(1);
  expect(store.objects).toHaveLength(2);
  button('启用').click();
  await vi.waitFor(() =>
    expect(store.referenceTargets.some((item) => item.type === 'research.paper')).toBe(true),
  );
  expect(store.relationDefinitions.some((item) => item.type === 'research.uses')).toBe(true);
});
it('creates calendar events, keeps drafts on panel close, and rejects invalid ranges and external conflicts', async () => {
  tab.value = 'calendar';
  await nextTick();
  button('新建事件').click();
  await nextTick();
  await fill('事件标题', '跨天会议');
  await fill('事件开始时间', '2026-09-26T23:00');
  await fill('事件结束时间', '2026-09-27T01:00');
  open.value = false;
  await nextTick();
  open.value = true;
  await nextTick();
  expect((root.querySelector('[aria-label="事件标题"]') as HTMLInputElement).value).toBe(
    '跨天会议',
  );
  root
    .querySelector('form.calendar-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.querySelector('.calendar-form')).toBeNull());
  const record = store.objects[0]!;
  expect(record.object.properties.start).toBe(new Date('2026-09-26T23:00').toISOString());
  expect(root.querySelector('[aria-label="2026-09-27，1 个事件"]')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('.agenda-event')!.click();
  await nextTick();
  await fill('事件结束时间', '2026-09-26T22:00');
  root
    .querySelector('form.calendar-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.textContent).toContain('结束时间不能早于开始时间'));
  await fill('事件结束时间', '2026-09-27T01:00');
  await fill('事件标题', '本地修改');
  await (fixture.adapter as DemoAdapter).write(
    record.path,
    JSON.stringify({ ...record.object, name: '外部修改' }),
    record.snapshot.hash,
  );
  root
    .querySelector('form.calendar-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.textContent).toContain('存在冲突'));
  expect((root.querySelector('[aria-label="事件标题"]') as HTMLInputElement).value).toBe(
    '本地修改',
  );
  expect((await (fixture.adapter as DemoAdapter).read(record.path)).content).toContain('外部修改');
});
it('keeps relation and event mutations disabled when Level 2 is off', async () => {
  store.capabilities.features.objectReferences = false;
  tab.value = 'calendar';
  await nextTick();
  expect(button('新建事件').disabled).toBe(true);
  expect(root.querySelector<HTMLButtonElement>('.relation-composer button')!.disabled).toBe(true);
  await expect(
    store.createRelation(
      'related',
      { type: 'document', id: 'a00001' },
      { type: 'document', id: 'a00002' },
    ),
  ).rejects.toThrow('Level 2');
});
