// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import type { WorkspaceAdapter } from '@tano/protocol';
import { CLOUD_EXTENSION_API_VERSION, configureWorkbench, configureWorkbenchWithCloudExtension, createLocalExtensions, useWorkbenchRuntime } from './runtime';
import type { CloudExtension } from './runtime';
import { useWorkspaceStore } from './stores/workspace';
import { DemoAdapter } from './adapter';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); localStorage.clear(); });
function create(adapter: WorkspaceAdapter) {
  const pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  const store = useWorkspaceStore(pinia);
  cleanup.push(() => { store.dispose(); disposePinia(pinia); });
  return { pinia, store };
}
it('keeps late reads and edits bound to their own workbench storage', async () => {
  localStorage.clear();
  const firstAdapter = new DemoAdapter(), secondAdapter = new DemoAdapter();
  await firstAdapter.create('isolation.md', 'first');
  await secondAdapter.create('isolation.md', 'second');
  const original = firstAdapter.refresh.bind(firstAdapter);
  let release!: () => void;
  const waiting = new Promise<void>(done => { release = done; });
  firstAdapter.refresh = async () => { await waiting; return original(); };
  const first = create(firstAdapter);
  const pending = first.store.openWorkspace();
  const second = create(secondAdapter);
  await second.store.openWorkspace();
  await second.store.openFile(second.store.workspace!.files.find(file => file.path === 'isolation.md')!);
  release();
  await pending;
  await first.store.openFile(first.store.workspace!.files.find(file => file.path === 'isolation.md')!);
  expect(first.store.active?.content).toBe('first');
  expect(second.store.active?.content).toBe('second');
  first.store.edit('first edited');
  await first.store.flush();
  expect((await firstAdapter.read('isolation.md')).content).toBe('first edited');
  expect((await secondAdapter.read('isolation.md')).content).toBe('second');
  expect(() => configureWorkbench(first.pinia, {adapter: secondAdapter, native: false, mobile: false})).toThrow('已配置');
});

it('checks the cloud contract before registering lazy instance extensions', () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const runtime = { adapter: new DemoAdapter(), native: false, mobile: false };
  const extensions = createLocalExtensions();
  const create = vi.fn(() => extensions);
  expect(() => configureWorkbenchWithCloudExtension(pinia, runtime, {
    apiVersion: 2,
    createWorkbenchExtensions: () => extensions,
  } as unknown as CloudExtension)).toThrow('不支持的云扩展接口版本');
  configureWorkbenchWithCloudExtension(pinia, runtime, {
    apiVersion: CLOUD_EXTENSION_API_VERSION,
    createWorkbenchExtensions: create,
  });
  expect(create).not.toHaveBeenCalled();
  expect(useWorkbenchRuntime().extensions?.()).toBe(extensions);
  expect(create).toHaveBeenCalledWith(pinia);
  disposePinia(pinia);
});
