// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import SettingsWindow from './SettingsWindow.vue';

const events = vi.hoisted(() => ({ listeners: new Map<string, (event: { payload: any }) => unknown>(), emit: vi.fn(), stops: vi.fn(), selectAppearance: undefined as undefined | ((selection: any) => void), execute: undefined as undefined | ((interaction: any) => Promise<void>) }));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: events.emit,
  listen: vi.fn(async (name, handler) => { events.listeners.set(name, handler); return events.stops; }),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'settings-main', onCloseRequested: async () => events.stops }) }));
vi.mock('../settings-window', () => ({ SETTINGS_COMMAND: 'command', SETTINGS_STATE: 'state', SETTINGS_NAVIGATE: 'navigate', SETTINGS_RENDERED: 'rendered', SETTINGS_PLUGIN_RESULT: 'result',
  settingsWindowRequest: () => ({ opener: 'main', page: 'plugin:test:preferences' }),
}));
vi.mock('../runtime', () => ({ useWorkbenchRuntime: () => ({}) }));
vi.mock('./UpdatePanel.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./SettingsPanel.vue', () => ({ default: { props: ['executePlugin'], emits: ['appearance'], setup(props: { executePlugin: typeof events.execute }, { emit }: { emit: (name: string, value: any) => void }) { events.execute = props.executePlugin; events.selectAppearance = selection => emit('appearance', selection); }, template: '<div />' } }));

let app: App, root: HTMLDivElement;
beforeEach(async () => {
  events.listeners.clear(); events.emit.mockReset().mockResolvedValue(undefined); events.stops.mockClear(); events.execute = undefined;
  root = document.createElement('div'); document.body.append(root);
  app = createApp(SettingsWindow); app.mount(root);
  await vi.waitFor(() => expect(events.emit).toHaveBeenCalledWith('main', 'command', { type: 'ready' }));
  await events.listeners.get('state')!({ payload: { theme: 'light' } }); await nextTick();
});
afterEach(() => { app.unmount(); root.remove(); });
const interaction = { workspaceId: 'workspace-one', pluginId: 'test', instanceId: 'instance-one', kind: 'action', name: 'preferences', payload: { action: 'save', values: { title: '标题' } } };

it('waits for the owning workbench acknowledgement and keeps the originating workspace and instance', async () => {
  const completed = vi.fn();
  const pending = events.execute!(interaction).then(completed);
  const command = events.emit.mock.calls.find(([, , payload]) => payload.type === 'plugin-invoke')![2];
  expect(command).toEqual({ type: 'plugin-invoke', requestId: expect.any(String), interaction });
  await nextTick(); expect(completed).not.toHaveBeenCalled();
  events.listeners.get('result')!({ payload: { requestId: 'unrelated' } });
  await nextTick(); expect(completed).not.toHaveBeenCalled();
  events.listeners.get('result')!({ payload: { requestId: command.requestId } });
  await pending; expect(completed).toHaveBeenCalledOnce();
});

it('surfaces stale-instance errors returned by the owning workbench', async () => {
  const pending = events.execute!(interaction);
  const rejected = expect(pending).rejects.toThrow('插件运行版本已变化');
  const command = events.emit.mock.calls.find(([, , payload]) => payload.type === 'plugin-invoke')![2];
  events.listeners.get('result')!({ payload: { requestId: command.requestId, error: '插件运行版本已变化' } });
  await rejected;
});


it('mirrors theme modes and clears stale overrides after workspace fallback', async () => {
  const color = { id: 'paper', light: { paper: '#fff4da' }, dark: { paper: '#241e15' } };
  const shape = { id: 'paper', label: 'Paper', tokens: { 'radius-card': '2px' } };
  const layout = { id: 'paper', label: 'Paper', structure: 'document', surface: 'paper', pageWidth: 760 };
  await events.listeners.get('state')!({ payload: { theme: 'dark', appearance: { color, layout, shape } } });
  expect(document.documentElement.style.getPropertyValue('--paper')).toBe('#241e15');
  expect(document.documentElement.dataset.layout).toBe('document');
  expect(document.documentElement.style.getPropertyValue('--layout-page-width')).toBe('760px');
  expect(document.documentElement.dataset.colorTheme).toBe('paper');
  await events.listeners.get('state')!({ payload: { theme: 'light', appearance: { color, shape } } });
  expect(document.documentElement.style.getPropertyValue('--radius-card')).toBe('2px');
  await events.listeners.get('state')!({ payload: { theme: 'light', appearance: {} } });
  expect(document.documentElement.style.getPropertyValue('--paper')).toBe('');
  expect(document.documentElement.style.getPropertyValue('--radius-card')).toBe('');
  expect(document.documentElement.dataset.colorTheme).toBe('builtin:tano');
  expect(document.documentElement.dataset.layout).toBe('continuous');
  expect(document.documentElement.style.getPropertyValue('--layout-page-width')).toBe('');
});

it('forwards a complete preset as one workspace-scoped command', async () => {
  events.emit.mockClear();
  const selection = { workspaceId: 'workspace-one', kind: 'preset', id: 'paper:writing' };
  events.selectAppearance!(selection); await nextTick();
  expect(events.emit).toHaveBeenCalledExactlyOnceWith('main', 'command', { type: 'appearance', selection });
});

it('renders single-mode themes from the owner snapshot without losing the shared mode preference', async () => {
  for (const [color, expected] of [
    [{ id: 'day', light: { paper: '#fff9ed' } }, 'light'],
    [{ id: 'night', dark: { paper: '#17202a' } }, 'dark'],
  ] as const) {
    await events.listeners.get('state')!({ payload: { theme: 'light', appearance: { color } } });
    expect(document.documentElement.dataset.theme).toBe(expected);
  }
  await events.listeners.get('state')!({ payload: { theme: 'light', appearance: {} } });
  expect(document.documentElement.dataset.theme).toBe('light');
});
