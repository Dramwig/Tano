// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import {
  parsePluginPackage,
  TANO_PLUGIN_API_VERSION,
  type ExecutablePluginManifest,
  type PluginPackage,
  type Workspace,
} from '@tano/protocol';
import { PluginExecutionHost, type PluginRuntimeState } from './host';
import { PluginPackageCache } from './packages';
import type { PluginSandboxFactory } from './sandbox';
import { documentOverviewPlugin } from './example';
import PluginSettingsForm from './components/PluginSettingsForm.vue';

const workspace: Workspace = {
  id: 'ws-1',
  name: '测试工作区',
  path: '/tmp/ws-1',
  files: [],
};

function makePackage(overrides: Record<string, unknown>): PluginPackage {
  return parsePluginPackage(
    JSON.stringify({
      ...documentOverviewPlugin,
      manifest: { ...documentOverviewPlugin.manifest, ...overrides },
    }),
  );
}

beforeEach(() => localStorage.clear());

it('blocks plugins whose engines.tano or platforms do not match the host without launching a sandbox', async () => {
  const pkg = makePackage({ engines: { tano: '>=9.0.0' }, platforms: ['desktop-local'] });
  const integrity = await new PluginPackageCache(localStorage).put(pkg);
  const factory = vi.fn<PluginSandboxFactory>();
  let states: PluginRuntimeState[] = [];
  const host = new PluginExecutionHost(
    { call: vi.fn() },
    (next) => { states = next; },
    { host: { coreVersion: '0.14.0', platform: 'web' } },
    localStorage,
    factory,
  );
  host.sync(workspace, [{
    manifest: pkg.manifest,
    enabled: true,
    authorized: true,
    rule: { manifest: pkg.manifest, integrity, mode: 'optional', settings: {} },
  }]);
  expect(factory).not.toHaveBeenCalled();
  expect(states[0]?.status).toBe('blocked');
  expect(states[0]?.message).toContain('>=9.0.0');
  host.dispose();
});

it('serves hostInfo(), merges settingsSchema defaults in context(), and returns structured error codes', async () => {
  const pkg = makePackage({
    permissions: ['documents.read'],
    settingsSchema: [
      { key: 'interval', label: '间隔', type: 'number', default: 25, min: 5, max: 60 },
      { key: 'label', label: '标签', type: 'string', default: '专注' },
    ],
  });
  const integrity = await new PluginPackageCache(localStorage).put(pkg);
  let receive!: (message: unknown) => void;
  const send = vi.fn();
  const factory: PluginSandboxFactory = (_source, onMessage) => {
    receive = onMessage;
    return { send, dispose: vi.fn() };
  };
  const host = new PluginExecutionHost(
    { call: vi.fn() },
    () => {},
    { host: { coreVersion: '0.14.0', platform: 'desktop-local' }, native: { 'git.status': vi.fn() } },
    localStorage,
    factory,
  );
  host.sync(workspace, [{
    manifest: pkg.manifest,
    enabled: true,
    authorized: true,
    rule: { manifest: pkg.manifest, integrity, mode: 'optional', settings: { interval: 40 } },
  }]);
  await vi.waitFor(() => expect(receive).toBeDefined());
  receive({ type: 'ready' });

  receive({ type: 'call', id: 1, method: 'hostInfo', params: {} });
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', id: 1 })));
  expect(send.mock.calls.find(([msg]) => msg.id === 1)?.[0].result).toEqual({
    coreVersion: '0.14.0',
    apiVersion: TANO_PLUGIN_API_VERSION,
    platform: 'desktop-local',
    capabilities: expect.arrayContaining(['documents', 'fileHandlers', 'settingsSchema', 'activationEvents', 'native:git.status']),
  });

  receive({ type: 'call', id: 2, method: 'context', params: {} });
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', id: 2 })));
  expect(send.mock.calls.find(([msg]) => msg.id === 2)?.[0].result.settings).toEqual({
    interval: 40,
    label: '专注',
  });

  // Calling an unauthorized API returns structured code + retryable flag
  receive({ type: 'call', id: 3, method: 'documents.create', params: { path: 'a.md', content: 'x' } });
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', id: 3 })));
  expect(send.mock.calls.find(([msg]) => msg.id === 3)?.[0]).toMatchObject({
    type: 'result',
    id: 3,
    code: 'PERMISSION_DENIED',
    retryable: false,
  });
  host.dispose();
});

it('keeps lazy activationEvents plugins idle until triggered, then activates and uses gracefulDispose on stop', async () => {
  const pkg = makePackage({
    commands: [{ id: 'run', label: '立即执行' }],
    activationEvents: ['onCommand:run'],
  });
  const integrity = await new PluginPackageCache(localStorage).put(pkg);
  let receive: ((message: unknown) => void) | undefined;
  const send = vi.fn();
  const dispose = vi.fn();
  const gracefulDispose = vi.fn();
  const factory = vi.fn<PluginSandboxFactory>((_source, onMessage) => {
    receive = onMessage;
    return { send, dispose, gracefulDispose };
  });
  let states: PluginRuntimeState[] = [];
  const host = new PluginExecutionHost(
    { call: vi.fn() },
    (next) => { states = next; },
    { host: { coreVersion: '0.14.0', platform: 'web' } },
    localStorage,
    factory,
  );
  host.sync(workspace, [{
    manifest: pkg.manifest,
    enabled: true,
    authorized: true,
    rule: { manifest: pkg.manifest, integrity, mode: 'optional', settings: {} },
  }]);

  // Idle before first trigger: sandbox not created yet, command still discoverable
  expect(factory).not.toHaveBeenCalled();
  expect(states[0]?.status).toBe('idle');
  expect(states[0]?.commands.map((c) => c.id)).toEqual(['run']);

  // Triggering the command wakes up the plugin and dispatches once ready
  const invokePromise = host.invoke(pkg.manifest.id, 'command', 'run', { workspaceId: workspace.id });
  await vi.waitFor(() => expect(receive).toBeDefined());
  expect(factory).toHaveBeenCalledOnce();
  receive!({ type: 'call', id: 1, method: 'commands.register', params: { id: 'run' } });
  receive!({ type: 'ready' });
  await vi.waitFor(() => expect(send.mock.calls.some(([msg]) => msg.type === 'invoke' && msg.name === 'run')).toBe(true));
  const invokedMsg = send.mock.calls.find(([msg]) => msg.type === 'invoke' && msg.name === 'run')![0];
  receive!({ type: 'invoked', id: invokedMsg.id });
  await invokePromise;
  expect(states[0]?.status).toBe('running');

  // Cleanly stopping uses gracefulDispose rather than abrupt dispose
  host.dispose();
  expect(gracefulDispose).toHaveBeenCalledOnce();
  expect(dispose).not.toHaveBeenCalled();
});

let mountedApp: App | undefined;
let mountedRoot: HTMLElement | undefined;
afterEach(() => {
  mountedApp?.unmount();
  mountedRoot?.remove();
});

it('renders declarative settingsSchema controls and updates JSON settings live', async () => {
  const schema = (makePackage({
    settingsSchema: [
      { key: 'title', label: '标题', type: 'string', default: '日报' },
      { key: 'limit', label: '数量', type: 'number', min: 1, max: 50, default: 10 },
      { key: 'enabled', label: '自动汇总', type: 'boolean', default: false },
      { key: 'order', label: '排序', type: 'select', options: [{ value: 'asc', label: '正序' }, { value: 'desc', label: '倒序' }], default: 'asc' },
    ],
  }).manifest as ExecutablePluginManifest).settingsSchema!;
  const model = ref('{}');
  mountedRoot = document.createElement('div');
  document.body.append(mountedRoot);
  mountedApp = createApp({
    render: () => h(PluginSettingsForm, { schema, modelValue: model.value, 'onUpdate:modelValue': (v: string) => { model.value = v; } }),
  });
  mountedApp.mount(mountedRoot);
  await nextTick();

  const text = mountedRoot.querySelector<HTMLInputElement>('input[type="text"]')!;
  expect(text.value).toBe('日报');
  text.value = '周报';
  text.dispatchEvent(new Event('input'));
  await nextTick();
  expect(JSON.parse(model.value)).toEqual({ title: '周报' });

  const checkbox = mountedRoot.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));
  await nextTick();
  expect(JSON.parse(model.value)).toEqual({ title: '周报', enabled: true });

  const select = mountedRoot.querySelector<HTMLSelectElement>('select')!;
  select.value = 'desc';
  select.dispatchEvent(new Event('change'));
  await nextTick();
  expect(JSON.parse(model.value)).toEqual({ title: '周报', enabled: true, order: 'desc' });
});
