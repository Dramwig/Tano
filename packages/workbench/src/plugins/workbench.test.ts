// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parsePluginPackage, canonicalPluginJson, matchPluginFileExtension, type ExecutablePluginManifest } from '@tano/protocol';
import { documentOverviewPlugin } from './example';
import {
  isPluginPreviewTab,
  pluginShortcutCommand,
  pluginWorkbenchCommands,
  pluginWorkbenchFileHandlers,
  pluginWorkbenchViews,
  resolvePluginFileHandler,
  type PluginWorkbenchCommand,
} from './workbench';
import { defaultShortcutBindings } from '../shell/shortcuts';

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

it('validates view layout and fileHandlers declarations while preserving backward compatibility', () => {
  const editorPkg = parsePluginPackage(JSON.stringify({
    ...documentOverviewPlugin,
    manifest: {
      ...documentOverviewPlugin.manifest,
      permissions: ['documents.read', 'ui'],
      commands: [{ id: 'open', label: '打开白板' }],
      views: [{ id: 'board', label: '白板', location: 'tab', layout: 'fill' }],
      fileHandlers: [{ extensions: ['.canvas.md'], mode: 'editor', view: 'board', command: 'open' }],
    },
  }));
  const editorManifest = editorPkg.manifest as ExecutablePluginManifest;
  expect(editorManifest.views[0]?.layout).toBe('fill');
  expect(editorManifest.fileHandlers).toEqual([
    { extensions: ['.canvas.md'], mode: 'editor', view: 'board', command: 'open' },
  ]);

  const previewPkg = parsePluginPackage(JSON.stringify({
    ...documentOverviewPlugin,
    manifest: {
      ...documentOverviewPlugin.manifest,
      permissions: ['attachments.read', 'ui'],
      commands: [{ id: 'preview', label: '预览表格' }],
      views: [{ id: 'viewer', label: 'CSV 预览', location: 'tab', layout: 'contained' }],
      fileHandlers: [{ extensions: ['.csv', '.tsv'], mode: 'preview', view: 'viewer', command: 'preview' }],
    },
  }));
  expect((previewPkg.manifest as ExecutablePluginManifest).fileHandlers?.[0]?.extensions).toEqual(['.csv', '.tsv']);

  expect(matchPluginFileExtension('notes/Plan.Canvas.MD', '.canvas.md')).toBe(true);
  expect(matchPluginFileExtension('dir\\deck.PPTX', '.pptx')).toBe(true);
  expect(matchPluginFileExtension('.pptx', '.pptx')).toBe(false);
  expect(matchPluginFileExtension('dir/.canvas.md', '.canvas.md')).toBe(false);
});

it.each([
  // fill layout only allowed on tab views
  { views: [{ id: 'side', label: '侧栏', location: 'sidebar', layout: 'fill' }] },
  { views: [{ id: 'panel', label: '面板', layout: 'fill' }] },
  { views: [{ id: 'board', label: '看板', location: 'tab', layout: 'fullscreen' }] },
  // plain markdown & reserved extensions forbidden
  {
    permissions: ['documents.read'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'board', label: '看板', location: 'tab' }],
    fileHandlers: [{ extensions: ['.md'], mode: 'editor', view: 'board', command: 'open' }],
  },
  {
    permissions: ['documents.read'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'board', label: '看板', location: 'tab' }],
    fileHandlers: [{ extensions: ['.markdown'], mode: 'editor', view: 'board', command: 'open' }],
  },
  {
    permissions: ['attachments.read'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'viewer', label: '预览', location: 'tab' }],
    fileHandlers: [{ extensions: ['.md'], mode: 'preview', view: 'viewer', command: 'open' }],
  },
  {
    permissions: ['attachments.read'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'viewer', label: '预览', location: 'tab' }],
    fileHandlers: [{ extensions: ['.tano'], mode: 'preview', view: 'viewer', command: 'open' }],
  },
  // missing required permission
  {
    permissions: ['ui'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'board', label: '看板', location: 'tab' }],
    fileHandlers: [{ extensions: ['.canvas.md'], mode: 'editor', view: 'board', command: 'open' }],
  },
  {
    permissions: ['documents.read'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'viewer', label: '预览', location: 'tab' }],
    fileHandlers: [{ extensions: ['.csv'], mode: 'preview', view: 'viewer', command: 'open' }],
  },
  // invalid view/command references or duplicate extensions
  {
    permissions: ['documents.read'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'side', label: '侧栏', location: 'sidebar' }],
    fileHandlers: [{ extensions: ['.canvas.md'], mode: 'editor', view: 'side', command: 'open' }],
  },
  {
    permissions: ['documents.read'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'board', label: '看板', location: 'tab' }],
    fileHandlers: [{ extensions: ['.canvas.md'], mode: 'editor', view: 'board', command: 'missing' }],
  },
  {
    permissions: ['attachments.read'],
    commands: [{ id: 'open', label: '打开' }],
    views: [{ id: 'viewer', label: '预览', location: 'tab' }],
    fileHandlers: [
      { extensions: ['.csv'], mode: 'preview', view: 'viewer', command: 'open' },
      { extensions: ['.csv'], mode: 'preview', view: 'viewer', command: 'open' },
    ],
  },
])('rejects invalid view layout or fileHandlers declaration: %j', fields => {
  expect(() => parsePluginPackage(JSON.stringify({
    ...documentOverviewPlugin,
    manifest: { ...documentOverviewPlugin.manifest, ...fields },
  }))).toThrow();
});

it('resolves fileHandlers deterministically, protects system defaults and rejects ambiguous third-party conflicts', () => {
  const makeManifest = (id: string, mode: 'editor' | 'preview', extensions: string[]): ExecutablePluginManifest =>
    parsePluginPackage(JSON.stringify({
      ...documentOverviewPlugin,
      manifest: {
        ...documentOverviewPlugin.manifest,
        id,
        name: id,
        permissions: [mode === 'editor' ? 'documents.read' : 'attachments.read', 'ui'],
        commands: [{ id: 'open', label: '打开' }],
        views: [{ id: 'main', label: '视图', location: 'tab', layout: 'fill' }],
        fileHandlers: [{ extensions, mode, view: 'main', command: 'open' }],
      },
    })).manifest as ExecutablePluginManifest;

  const sysWord = makeManifest('word-preview', 'preview', ['.doc', '.docx']);
  const altWord = makeManifest('alt-word', 'preview', ['.docx']);
  const csvA = makeManifest('csv-a', 'preview', ['.csv']);
  const csvB = makeManifest('csv-b', 'preview', ['.csv']);
  const canvas = makeManifest('canvas-app', 'editor', ['.canvas.md']);

  const installations = [
    { manifest: sysWord, enabled: true, system: true },
    { manifest: altWord, enabled: true },
    { manifest: csvA, enabled: true },
    { manifest: csvB, enabled: true },
    { manifest: canvas, enabled: true },
  ];
  const running = (id: string, registered = true) => ({
    id,
    name: id,
    instanceId: `${id}-1`,
    status: 'running' as const,
    message: '',
    views: [],
    commands: registered ? [{ id: 'open', label: '打开' }] : [],
  });
  const states = [running('word-preview'), running('alt-word'), running('csv-a'), running('csv-b'), running('canvas-app')];

  const handlers = pluginWorkbenchFileHandlers(installations, states);
  // System plugin wins over competing third-party plugin for .docx
  expect(resolvePluginFileHandler('docs/spec.docx', 'preview', handlers)?.pluginId).toBe('word-preview');
  // Disabling the system plugin lets the third-party handler take over
  const withoutSystem = pluginWorkbenchFileHandlers(
    installations.map(item => (item.manifest.id === 'word-preview' ? { ...item, enabled: false } : item)),
    states,
  );
  expect(resolvePluginFileHandler('docs/spec.docx', 'preview', withoutSystem)?.pluginId).toBe('alt-word');
  // Ambiguous third-party conflict returns undefined (no silent hijack)
  expect(resolvePluginFileHandler('data/report.csv', 'preview', handlers)).toBeUndefined();
  // Compound Markdown editor matches case-insensitively and ignores internal/table files
  expect(resolvePluginFileHandler('board/Demo.Canvas.MD', 'editor', handlers)?.pluginId).toBe('canvas-app');
  expect(resolvePluginFileHandler('.tano/internal.canvas.md', 'editor', handlers)).toBeUndefined();
  expect(resolvePluginFileHandler('items.table.json', 'preview', handlers)).toBeUndefined();
  // Unregistered command is not eligible
  const unregistered = pluginWorkbenchFileHandlers(installations, [running('canvas-app', false)]);
  expect(resolvePluginFileHandler('board/demo.canvas.md', 'editor', unregistered)).toBeUndefined();
  // isPluginPreviewTab recognizes any enabled preview handler tab dynamically
  expect(isPluginPreviewTab('plugin:word-preview:main', installations)).toBe(true);
  expect(isPluginPreviewTab('plugin:csv-a:main', installations)).toBe(true);
  expect(isPluginPreviewTab('plugin:canvas-app:main', installations)).toBe(false);
});
