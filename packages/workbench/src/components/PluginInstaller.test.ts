// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef } from 'vue';
import { bundledObjectPlugins } from '@tano/protocol';
import type { App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import PluginInstaller from './PluginInstaller.vue';
import { bundledPluginCatalog, type PluginCatalogEntry } from '../plugin-catalog';
import { PluginPackageCache } from '../plugins/packages';

let app: App;
let root: HTMLElement;
let store: ReturnType<typeof useWorkspaceStore>;
let pinia: ReturnType<typeof createPinia>;
const showModal = HTMLDialogElement.prototype.showModal;
const close = HTMLDialogElement.prototype.close;
const catalogOverride = shallowRef<readonly PluginCatalogEntry[]>();
const publishingAvailable = shallowRef(false);

beforeEach(async () => {
  // jsdom does not implement the native dialog top layer.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  localStorage.clear();
  catalogOverride.value = undefined;
  publishingAvailable.value = false;
  pinia = createPinia();
  configureWorkbench(pinia, { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.openWorkspace();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(PluginInstaller, { catalog: catalogOverride.value }, publishingAvailable.value
    ? { publishing: () => h('textarea', { 'aria-label': '投稿草稿' }) } : undefined));
  app.use(pinia);
  app.mount(root);
});

afterEach(() => {
  app.unmount();
  store.dispose();
  disposePinia(pinia);
  root.remove();
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
  vi.restoreAllMocks();
});

function button(label: string) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) =>
      element.textContent?.trim() === label || element.getAttribute('aria-label') === label,
  )!;
}

it('offers publishing only when the product provides it and preserves drafts while browsing plugins', async () => {
  expect(button('我的投稿')).toBeUndefined();
  button('社区目录').click();
  await nextTick();
  expect(button('发布插件')).toBeUndefined();
  publishingAvailable.value = true;
  await nextTick();
  expect(root.querySelector('[aria-label="投稿草稿"]')).toBeNull();
  button('发布插件').click();
  await nextTick();
  expect(button('我的投稿').getAttribute('aria-pressed')).toBe('true');
  expect(button('导入插件')).toBeUndefined();
  expect(root.querySelector('.catalog-filter')).toBeNull();
  expect(root.querySelector('.center-footer')).toBeNull();
  const draft = root.querySelector<HTMLTextAreaElement>('[aria-label="投稿草稿"]')!;
  draft.value = '未提交的新版本说明';
  button('社区目录').click();
  await nextTick();
  expect(draft.parentElement?.style.display).toBe('none');
  button('我的投稿').click();
  await nextTick();
  expect(root.querySelector('[aria-label="投稿草稿"]')).toBe(draft);
  expect(draft.value).toBe('未提交的新版本说明');
  expect(draft.parentElement?.style.display).not.toBe('none');
});

it('installs a plugin and preserves its objects when disabled and re-enabled', async () => {
  button('安装研究工作台').click();
  await vi.waitFor(() => expect(store.installedPlugins).toHaveLength(1));
  const paper = await store.createObject({
    type: 'research.paper',
    name: '论文',
    properties: {},
    description: '',
    archived: false,
  });
  expect(store.referenceTargets.some((item) => item.id === paper.object.id)).toBe(true);

  button('已安装 1').click();
  await nextTick();
  button('管理研究工作台').click();
  await nextTick();
  button('停用插件').click();
  await vi.waitFor(() => expect(store.installedPlugins[0]?.enabled).toBe(false));
  expect(store.objects).toHaveLength(1);
  expect(store.referenceTargets.some((item) => item.id === paper.object.id)).toBe(false);

  button('启用插件').click();
  await vi.waitFor(() => expect(store.installedPlugins[0]?.enabled).toBe(true));
  expect(store.referenceTargets.some((item) => item.id === paper.object.id)).toBe(true);

  button('卸载插件').click();
  await vi.waitFor(() => expect(store.installedPlugins).toHaveLength(0));
  expect(store.objects).toHaveLength(1);
  expect(root.textContent).toContain('还没有安装插件');
});

it('combines category and object-type search and resets an empty result', async () => {
  const category = root.querySelector<HTMLSelectElement>('select[aria-label="插件分类"]')!;
  category.value = 'reading';
  category.dispatchEvent(new Event('change'));
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(1);
  expect(root.querySelector('.plugin-entry')?.textContent).toContain('阅读书架');
  const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = '  RESEARCH.PAPER  ';
  search.dispatchEvent(new Event('input'));
  await nextTick();
  expect(root.textContent).toContain('没有找到匹配的插件');
  category.value = 'all';
  category.dispatchEvent(new Event('change'));
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(1);
  expect(root.querySelector('.plugin-entry')?.textContent).toContain('研究工作台');
  search.value = '不存在的插件';
  search.dispatchEvent(new Event('input'));
  await nextTick();
  button('重置筛选').click();
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(bundledPluginCatalog.length);
  expect(search.value).toBe('');
});

it.each(['list', 'details'])('installs the bundled Git inspector from %s without importing a file or authorizing code', async (entry) => {
  if (entry === 'details') {
    button('查看Git 变更详情').click();
    await nextTick();
    button('安装插件').click();
  } else button('安装Git 变更').click();
  await vi.waitFor(() => expect(store.installedPlugins.some(item => item.manifest.id === 'git-inspector')).toBe(true));
  const installed = store.installedPlugins.find(item => item.manifest.id === 'git-inspector')!;
  expect(installed.authorized).toBe(false);
  expect(installed.rule?.integrity).toMatch(/^[a-f0-9]{64}$/);
  const pkg = await new PluginPackageCache().get(installed.rule!.integrity!);
  expect(pkg?.ui?.changes).toBeDefined();
  expect(pkg?.manifest).toEqual(installed.manifest);
  expect(store.pluginViews.some(view => view.pluginId === 'git-inspector')).toBe(true);
  if (entry === 'list') {
    button('查看Git 变更详情').click();
    await nextTick();
  }
  button('授权此版本运行').click();
  await vi.waitFor(() => expect(store.pluginRuntime.find(plugin => plugin.id === 'git-inspector')?.message)
    .toBe('当前运行环境不提供此插件要求的本机能力'));
  button('打开Git 变更').click();
  await nextTick();
  expect(store.activeId).toBe('plugin:git-inspector:changes');
  expect(root.querySelector('dialog')).toBeNull();
});

it('opens details, installs there, and shows the installed manifest version', async () => {
  button('查看研究工作台详情').click();
  await nextTick();
  const dialog = root.querySelector('dialog')!;
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain('年份、DOI');
  const first = dialog.querySelector<HTMLButtonElement>('button')!;
  const last = dialog.querySelector<HTMLButtonElement>('.pc-primary')!;
  first.focus();
  first.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(last);
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(first);
  dialog.querySelector<HTMLButtonElement>('.pc-primary')!.click();
  await vi.waitFor(() => expect(dialog.textContent).toContain('停用插件'));
  await store.changePlugin(
    { install: { ...bundledObjectPlugins[0], version: '2.0.0', name: '自定义研究台' } },
    store.workspace!.id,
  );
  await nextTick();
  expect(dialog.textContent).toContain('v2.0.0');
  expect(dialog.textContent).toContain('自定义研究台');
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  await nextTick();
  expect(root.querySelector('dialog')).toBeNull();
});

it('validates imports and invalidates a preview after editing before installation', async () => {
  button('导入插件').click();
  await nextTick();
  const textarea = root.querySelector('textarea')!;
  textarea.value = '{ invalid json }';
  textarea.dispatchEvent(new Event('input'));
  await nextTick();
  button('检查清单').click();
  await nextTick();
  expect(root.querySelector('[role="alert"]')).not.toBeNull();
  expect(root.querySelector('.plugin-preview')).toBeNull();

  textarea.value = JSON.stringify(bundledObjectPlugins[1]);
  textarea.dispatchEvent(new Event('input'));
  await nextTick();
  button('检查清单').click();
  await nextTick();
  expect(root.querySelector('.plugin-preview')?.textContent).toContain('阅读书架');
  textarea.value = '{}';
  textarea.dispatchEvent(new Event('input'));
  await nextTick();
  expect(root.querySelector('.plugin-preview')).toBeNull();

  textarea.value = JSON.stringify(bundledObjectPlugins[1]);
  textarea.dispatchEvent(new Event('input'));
  await nextTick();
  button('检查清单').click();
  await nextTick();
  button('安装此插件').click();
  await vi.waitFor(() => expect(root.querySelector('dialog')).toBeNull());
  expect(store.installedPlugins[0]?.manifest.id).toBe('reading');
  expect(root.querySelector('[aria-label="已安装插件"]')?.textContent).toContain('阅读书架');
});

it('keeps a failed install actionable and reports the error in its dialog', async () => {
  vi.spyOn(store, 'changePlugin').mockRejectedValueOnce(new Error('安装记录已在另一窗口改变'));
  button('查看研究工作台详情').click();
  await nextTick();
  const install = root.querySelector<HTMLButtonElement>('dialog .pc-primary')!;
  install.click();
  await vi.waitFor(() =>
    expect(root.querySelector('dialog [role="alert"]')?.textContent).toContain('另一窗口'),
  );
  expect(install.disabled).toBe(false);
  expect(store.installedPlugins).toHaveLength(0);
});

it('clears an earlier preview when a newly selected file cannot be imported', async () => {
  button('导入插件').click();
  await nextTick();
  const textarea = root.querySelector('textarea')!;
  textarea.value = JSON.stringify(bundledObjectPlugins[0]);
  textarea.dispatchEvent(new Event('input'));
  await nextTick();
  button('检查清单').click();
  await nextTick();
  expect(root.querySelector('.plugin-preview')).not.toBeNull();
  const file = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(file, 'files', { value: [{ size: 4 * 1024 * 1024 + 1 }] });
  file.dispatchEvent(new Event('change'));
  await nextTick();
  expect(root.querySelector('.plugin-preview')).toBeNull();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('不能超过 4 MiB');
});

it('browses a large catalog in batches and searches across unloaded entries', async () => {
  catalogOverride.value = Array.from({ length: 61 }, (_, index) => ({
    manifest: {
      ...bundledObjectPlugins[0],
      id: `sample${index}`,
      name: `插件 ${String(index).padStart(2, '0')}`,
    },
    category:
      index < 30 ? { id: 'research', label: '学术研究' } : { id: 'reading', label: '阅读写作' },
  }));
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(24);
  expect(root.querySelector('.catalog-heading')?.textContent).toContain('61');
  button('显示更多').click();
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(48);
  button('显示更多').click();
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(61);
  expect(root.querySelector('.catalog-more')).toBeNull();

  const category = root.querySelector<HTMLSelectElement>('select[aria-label="插件分类"]')!;
  category.value = 'reading';
  category.dispatchEvent(new Event('change'));
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(24);
  expect(root.querySelector('.catalog-heading')?.textContent).toContain('31');
  expect(root.querySelector('.plugin-entry')?.textContent).toContain('插件 30');
  const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = '插件 60';
  search.dispatchEvent(new Event('input'));
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(1);
  expect(root.querySelector('.plugin-entry')?.textContent).toContain('插件 60');
  expect(root.querySelector('.catalog-more')).toBeNull();
});

it('filters a long installed list by state before paginating', async () => {
  store.installedPlugins = Array.from({ length: 50 }, (_, index) => ({
    manifest: { ...bundledObjectPlugins[0], id: `sample${index}`, name: `已安装插件 ${index}` },
    enabled: index % 2 === 0,
  }));
  await nextTick();
  button('已安装 50').click();
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(24);
  const state = root.querySelector<HTMLSelectElement>('select[aria-label="安装状态"]')!;
  state.value = 'disabled';
  state.dispatchEvent(new Event('change'));
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(24);
  expect(root.querySelector('.catalog-heading')?.textContent).toContain('25');
  expect(
    [...root.querySelectorAll('.entry-state')].every((item) => item.textContent === '已停用'),
  ).toBe(true);
  button('显示更多').click();
  await nextTick();
  expect(root.querySelectorAll('.plugin-entry')).toHaveLength(25);
  expect(root.querySelector('.catalog-more')).toBeNull();
});
