// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parsePluginPackage, canonicalPluginJson } from '@tano/protocol';
import { documentOverviewPlugin } from './example';
import { pluginWorkbenchViews, pluginWorkbenchCommands, pluginShortcutCommand, type PluginWorkbenchCommand } from './workbench';
import { defaultShortcutBindings } from '../shortcuts';

const command: PluginWorkbenchCommand = { id: 'open', key: 'plugin:test:open', label: '打开', pluginId: 'test', pluginName: '测试插件', instanceId: 'one', shortcut: 'Alt+Shift+J' };

it('keeps canonical bytes stable for packages without the new contribution fields', () => {
  expect(canonicalPluginJson(parsePluginPackage(JSON.stringify(documentOverviewPlugin)))).toBe(canonicalPluginJson(documentOverviewPlugin));
});

it('parses contribution metadata and keeps disabled plugins out of the workbench', () => {
  const pkg = parsePluginPackage(JSON.stringify({ ...documentOverviewPlugin, manifest: { ...documentOverviewPlugin.manifest,
    commands: [{ id: 'open', label: '打开', shortcut: 'Alt+Shift+J', menus: ['workspace', 'file', 'document'] }],
    views: [{ id: 'board', label: '看板', location: 'tab' }, { id: 'settings', label: '设置', location: 'settings' }] } }));
  const views = pluginWorkbenchViews([{ manifest: pkg.manifest, enabled: true }]);
  expect(views.map(view => [view.key, view.location])).toEqual([['plugin:document-overview:board', 'tab'], ['plugin:document-overview:settings', 'settings']]);
  expect(pluginWorkbenchViews([{ manifest: pkg.manifest, enabled: false }])).toEqual([]);
  expect(pluginWorkbenchCommands([{ id: 'test', name: '测试插件', instanceId: 'one', status: 'running', message: '', views: [], commands: [{ id: 'open', label: '打开' }] }])[0]?.instanceId).toBe('one');
  expect(pluginWorkbenchCommands([{ id: 'test', name: '测试插件', instanceId: 'one', status: 'error', message: '', views: [], commands: [{ id: 'open', label: '打开' }] }])).toEqual([]);
});

it.each([
  { commands: [{ id: 'open', label: '打开', shortcut: 'J' }] },
  { commands: [{ id: 'open', label: '打开', shortcut: 'Shift+Alt+J' }] },
  { commands: [{ id: 'open', label: '打开', shortcut: 'Mod+Alt+J' }] },
  { commands: [{ id: 'open', label: '打开', menus: [['file']] }] },
  { commands: [{ id: 'open', label: '打开', menus: ['file', 'file'] }] },
  { commands: [{ id: 'open', label: '打开', menus: ['system'] }] },
  { views: [{ id: 'board', label: '看板', location: ['tab'] }] },
  { views: [{ id: 'board', label: '看板', location: 'native' }] },
])('rejects malformed workbench contributions: %j', fields => {
  expect(() => parsePluginPackage(JSON.stringify({ ...documentOverviewPlugin, manifest: { ...documentOverviewPlugin.manifest, ...fields } }))).toThrow();
});

it('routes an unambiguous plugin shortcut while preserving host and browser shortcuts', () => {
  const event = new KeyboardEvent('keydown', { key: 'J', altKey: true, shiftKey: true });
  expect(pluginShortcutCommand(event, [command], defaultShortcutBindings)).toBe(command);
  expect(pluginShortcutCommand(event, [command, { ...command, pluginId: 'other' }], defaultShortcutBindings)).toBeUndefined();
  expect(pluginShortcutCommand(event, [command], { ...defaultShortcutBindings, save: 'Alt+Shift+J' })).toBeUndefined();
  const paste = { ...command, shortcut: 'Mod+V' };
  expect(pluginShortcutCommand(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }), [paste], defaultShortcutBindings)).toBeUndefined();
});

it.each(['input', 'textarea', 'select', 'editable', 'dialog'])('does not intercept shortcuts inside %s', kind => {
  const target = document.createElement(kind === 'editable' ? 'div' : kind);
  if (kind === 'editable') target.setAttribute('contenteditable', 'true');
  target.addEventListener('keydown', event => expect(pluginShortcutCommand(event as KeyboardEvent, [command], defaultShortcutBindings)).toBeUndefined());
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'J', altKey: true, shiftKey: true }));
});

it('ignores repeated, composing and already handled keys', () => {
  for (const flags of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }])
    expect(pluginShortcutCommand(new KeyboardEvent('keydown', { key: 'J', altKey: true, shiftKey: true, ...flags }), [command], defaultShortcutBindings)).toBeUndefined();
  const event = new KeyboardEvent('keydown', { key: 'J', altKey: true, shiftKey: true, cancelable: true });
  event.preventDefault();
  expect(pluginShortcutCommand(event, [command], defaultShortcutBindings)).toBeUndefined();
});
