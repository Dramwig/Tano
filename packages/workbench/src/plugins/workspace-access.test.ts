// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { documentOverviewPlugin } from './example';
import type { PluginPackage, PluginPermission } from '@tano/protocol';
import { nextTick } from 'vue';

const bridge = vi.hoisted(() => ({ receive: undefined as ((message: unknown) => void) | undefined, send: vi.fn() }));
vi.mock('./sandbox', () => ({ createPluginSandbox: (_source: string, receive: (message: unknown) => void) => {
  if (_source === documentOverviewPlugin.source) bridge.receive = receive;
  return { send: bridge.send, dispose: vi.fn() };
} }));

let store: ReturnType<typeof useWorkspaceStore>;
let adapter: DemoAdapter;
let sequence: number;
let readonly = false;
beforeEach(async () => {
  localStorage.clear(); bridge.send.mockClear(); bridge.receive = undefined; sequence = 0; readonly = false;
  class Adapter extends DemoAdapter {
    override async refresh() { const workspace = await super.refresh(); return { ...workspace, files: workspace.files.map(file => ({ ...file, readOnly: file.path === 'note.md' && readonly })) }; }
  }
  adapter = new Adapter({ files: { 'note.md': 'A\nB\nC\n', '.tano/rules/assistant.md': 'private rules' } });
  setActivePinia(configureWorkbench(createPinia(), { adapter, native: false, mobile: false }));
  store = useWorkspaceStore(); await store.initialize();
  const pkg: PluginPackage = { ...documentOverviewPlugin, manifest: { ...documentOverviewPlugin.manifest,
    permissions: ['documents.read', 'documents.write', 'objects.read', 'objects.write'] as PluginPermission[],
    views: [...documentOverviewPlugin.manifest.views, { id: 'board', label: '看板', location: 'tab' },
      { id: 'summary', label: '摘要', location: 'sidebar' }, { id: 'preferences', label: '偏好', location: 'settings' }] } };
  await store.changePlugin({ install: pkg.manifest, package: pkg }, store.workspace!.id);
  await store.authorizePlugin(pkg.manifest.id, store.installedPlugins[0]!.rule!.integrity, store.workspace!.id);
  await vi.waitFor(() => expect(bridge.receive).toBeDefined());
  bridge.receive!({ type: 'ready' });
});
afterEach(() => { store.dispose(); store.$dispose(); });
async function call(method: string, params: Record<string, unknown> = {}) {
  const id = ++sequence;
  bridge.receive!({ type: 'call', id, method, params });
  await vi.waitFor(() => expect(bridge.send.mock.calls.some(([message]) => message.id === id && message.type === 'result')).toBe(true));
  const message = bridge.send.mock.calls.find(([message]) => message.id === id && message.type === 'result')![0];
  if (message.error) throw new Error(message.error);
  return message.result;
}
const fileId = () => store.workspace!.files.find(file => file.path === 'note.md')!.id;
it('requires separate attachment permission even for plugins allowed to read Markdown', async () => {
  await expect(call('attachments.read', { fileId: fileId(), offset: 0 })).rejects.toThrow('attachments.read');
});

it('merges a plugin edit with independent disk edits and preserves both sides of overlaps', async () => {
  const original = await call('documents.read', { fileId: fileId() });
  await adapter.write('note.md', 'External\nB\nC\n', (await adapter.read('note.md')).hash);
  await call('documents.write', { fileId: fileId(), content: 'A\nB\nPlugin\n', baseHash: original.hash });
  expect((await adapter.read('note.md')).content).toBe('External\nB\nPlugin\n');
  await expect(call('documents.write', { fileId: fileId(), content: 'Overwrite\nB\nC\n', baseHash: original.hash })).rejects.toThrow('已保存在');
  expect((await adapter.read('note.md')).content).toBe('External\nB\nPlugin\n');
  const copy = (await adapter.refresh()).files.find(file => file.path.includes('.plugin-conflict-'))!;
  expect((await adapter.read(copy.path)).content).toBe('Overwrite\nB\nC\n');
});

it('rejects forged snapshots, internal paths and writes after document permissions change', async () => {
  const original = await call('documents.read', { fileId: fileId() });
  await expect(call('documents.write', { fileId: fileId(), content: 'bad', baseHash: 'forged', base: original })).rejects.toThrow('先读取');
  await expect(call('documents.create', { path: '.tano/rules/other.md', content: 'bad' })).rejects.toThrow('路径');
  expect((await call('documents.list')).every((file: { path: string }) => !file.path.startsWith('.tano/'))).toBe(true);
  readonly = true;
  await expect(call('documents.write', { fileId: fileId(), content: 'bad', baseHash: original.hash })).rejects.toThrow('阅读权限');
  expect((await adapter.read('note.md')).content).toBe('A\nB\nC\n');
});

it('sends visible-document edits through the editor transaction', async () => {
  await store.openFile(store.workspace!.files.find(file => file.id === fileId())!);
  const edit = vi.fn(async () => true);
  store.setPluginEditor(edit);
  const original = await call('documents.read', { fileId: fileId() });
  await call('documents.write', { fileId: fileId(), content: 'A\nB\nEdited\n', baseHash: original.hash });
  expect(edit).toHaveBeenCalledWith(fileId(), 'A\nB\nC\n', 'A\nB\nEdited\n');
  expect((await adapter.read('note.md')).content).toBe('A\nB\nC\n');
});

it('preserves an object proposal when another author changes the same field', async () => {
  const object = await call('objects.create', { object: { type: 'person', name: 'Original', description: '', archived: false, properties: {} } });
  const original = await call('objects.read', { objectId: object.id });
  const path = `.tano/objects/${object.id}.tano.json`;
  await adapter.write(path, JSON.stringify({ ...object, name: 'External' }), (await adapter.read(path)).hash);
  await expect(call('objects.update', { object: { ...object, name: 'Plugin' }, baseHash: original.hash })).rejects.toThrow('已保存在');
  expect(JSON.parse((await adapter.read(path)).content).name).toBe('External');
  const copy = (await adapter.refresh()).files.find(file => file.path.startsWith('.tano/conflicts/plugin-object-'))!;
  expect(JSON.parse((await adapter.read(copy.path)).content).pluginProposal.name).toBe('Plugin');
});

it('stops malformed worker messages without throwing into the application', () => {
  const message: Record<string, unknown> = { type: 'call', id: 1, method: 'documents.list' };
  message.params = message;
  expect(() => bridge.receive!(message)).not.toThrow();
  expect(store.pluginRuntime.find(plugin => plugin.id === 'document-overview')?.status).toBe('error');
});

it('routes declared views and removes every workbench entry when the plugin is disabled', async () => {
  await expect(call('views.open', { id: 'undeclared' })).rejects.toThrow('清单');
  await call('commands.register', { id: 'refresh' });
  await call('views.open', { id: 'board' });
  expect(store.activeId).toBe('plugin:document-overview:board');
  expect(store.tabs.find(tab => tab.id === store.activeId)?.pluginView?.label).toBe('看板');
  await call('views.open', { id: 'summary' });
  expect(store.activePluginSidebar).toBe('plugin:document-overview:summary');
  await call('views.open', { id: 'preferences' });
  expect(store.pluginSettingsRequest?.key).toBe('plugin:document-overview:preferences');
  expect(store.pluginSettingsPages[0]?.workspaceId).toBe(store.workspace!.id);
  await call('views.open', { id: 'overview' });
  expect(store.activeId).toBe('view:plugins');
  await store.changePlugin({ id: 'document-overview', enabled: false }, store.workspace!.id);
  await nextTick();
  expect(store.tabs.some(tab => tab.pluginView)).toBe(false);
  expect(store.activePluginSidebar).toBe('');
  expect(store.pluginSettingsPages).toEqual([]);
  expect(store.pluginCommands).toEqual([]);
});

it('rejects stale settings interactions without sending a callback to a new instance', async () => {
  const interaction = { workspaceId: store.workspace!.id, pluginId: 'document-overview', instanceId: store.pluginRuntime.find(plugin => plugin.id === 'document-overview')!.instanceId,
    kind: 'action' as const, name: 'preferences', payload: { action: 'save', values: {} } };
  await expect(store.interactWithPlugin({ ...interaction, workspaceId: 'old-workspace' })).rejects.toThrow('工作区已切换');
  await expect(store.interactWithPlugin({ ...interaction, instanceId: 'old-instance' })).rejects.toThrow('运行版本已变化');
  expect(bridge.send.mock.calls.some(([message]) => message.type === 'invoke')).toBe(false);
  const operation = store.interactWithPlugin(interaction);
  const invocation = bridge.send.mock.calls.find(([message]) => message.type === 'invoke')![0];
  expect(invocation).toMatchObject({ kind: 'action', name: 'preferences', payload: interaction.payload });
  bridge.receive!({ type: 'invoked', id: invocation.id });
  await operation;
});

it('restores a plugin tab through back navigation after opening the plugin center', async () => {
  store.openPluginView('document-overview', 'board');
  await store.openPluginsTab();
  expect(store.activeId).toBe('view:plugins');
  expect(store.canGoBack).toBe(true);
  await store.navigateHistory(-1);
  expect(store.activeId).toBe('plugin:document-overview:board');
  await store.navigateHistory(1);
  expect(store.activeId).toBe('view:plugins');
});

it('applies ranged edits against the remembered read and preserves independent external changes', async () => {
  const original = await call('documents.read', { fileId: fileId() });
  await adapter.write('note.md', 'External\nB\nC\n', (await adapter.read('note.md')).hash);
  await call('documents.edit', { fileId: fileId(), edits: [{ from: 4, to: 5, insert: 'Plugin' }], baseHash: original.hash });
  expect((await adapter.read('note.md')).content).toBe('External\nB\nPlugin\n');
  await expect(call('documents.edit', { fileId: fileId(), edits: [], baseHash: 'forged', base: original })).rejects.toThrow('先读取');
});

it('queries filtered object pages, remembers their hashes and emits property deltas only to authorized plugins', async () => {
  const object = await call('objects.create', { object: { type: 'event', name: 'Task', description: '', archived: false, properties: { checkable: true, completed: false } } });
  const page = await call('objects.query', { options: { properties: { completed: false }, limit: 1 } });
  expect(page.items[0].id).toBe(object.id);
  await new Promise(resolve => setTimeout(resolve, 180)); bridge.send.mockClear();
  await call('objects.update', { object: { ...object, properties: { ...object.properties, completed: true } }, baseHash: page.items[0].hash });
  await vi.waitFor(() => expect(bridge.send.mock.calls.some(([message]) => message.type === 'event' && message.event.type === 'objects.changed' && message.event.changes.some((change: { id: string; kind: string }) => change.id === object.id && change.kind === 'updated'))).toBe(true));
  expect((await call('objects.query', { options: { properties: { completed: false } } })).items).toEqual([]);
  await expect(call('relations.query')).rejects.toThrow('relations.read');
});
