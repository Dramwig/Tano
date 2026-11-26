import { isElement } from '@tano/editor/dom-realm';
import {
  isDataTableFilePath,
  isWorkspaceInternalPath,
  matchPluginFileExtension,
  type PluginCodeBlockRendererDefinition,
  type PluginCommandDefinition,
  type PluginEditorDecoration,
  type PluginFileHandlerDefinition,
  type PluginFileHandlerMode,
  type PluginSlashCommandDefinition,
  type PluginStatusBarItem,
  type PluginUiBundle,
  type PluginViewDefinition,
} from '@tano/protocol';
import type { InstalledObjectPlugin } from './workspace-plugins';
import type { PluginRuntimeState } from './host';
import { shortcutBindingFromEvent, shortcutKeys, shortcutDefinitions, type ShortcutBindings } from '../shell/shortcuts';

export interface PluginWorkbenchView extends PluginViewDefinition {
  key: string; pluginId: string; pluginName: string;
}
export interface PluginWorkbenchCommand extends PluginCommandDefinition {
  key: string; pluginId: string; pluginName: string; instanceId: string;
}
export interface PluginWorkbenchFileHandler extends PluginFileHandlerDefinition {
  pluginId: string; pluginName: string; system: boolean; viewKey: string;
}
export interface PluginWorkbenchStatusBarItem extends PluginStatusBarItem {
  key: string; pluginId: string; pluginName: string; instanceId: string;
}
export interface PluginWorkbenchSlashCommand extends PluginSlashCommandDefinition {
  key: string; pluginId: string; pluginName: string; instanceId: string;
}
export interface PluginWorkbenchCodeBlockRenderer extends PluginCodeBlockRendererDefinition {
  key: string; pluginId: string; pluginName: string; instanceId: string; bundle: PluginUiBundle;
}
export interface PluginWorkbenchDecoration extends PluginEditorDecoration {
  key: string; pluginId: string; pluginName: string; instanceId: string;
}
export interface PluginInteraction {
  workspaceId: string; pluginId: string; instanceId: string; kind: 'command' | 'action' | 'message' | 'diagnostic'; name: string; payload?: unknown;
}
export interface PluginSettingsPage {
  view: PluginWorkbenchView; workspaceId: string; runtime?: PluginRuntimeState;
}
export const pluginViewKey = (pluginId: string, viewId: string) => `plugin:${pluginId}:${viewId}`;
export function pluginWorkbenchViews(installations: InstalledObjectPlugin[]): PluginWorkbenchView[] {
  return installations.filter(item => item.enabled).flatMap(({ manifest }) => manifest.manifestVersion === 2
    ? manifest.views.map(view => ({ ...view, key: pluginViewKey(manifest.id, view.id), pluginId: manifest.id, pluginName: manifest.name })) : []);
}
export function pluginWorkbenchCommands(states: PluginRuntimeState[]): PluginWorkbenchCommand[] {
  return states.filter(state => state.status === 'running' || state.status === 'idle').flatMap(state => state.commands.map(command => ({
    ...command, key: `plugin:${state.id}:${command.id}`, pluginId: state.id, pluginName: state.name, instanceId: state.instanceId,
  })));
}
export function pluginWorkbenchStatusBarItems(states: PluginRuntimeState[]): PluginWorkbenchStatusBarItem[] {
  return states
    .filter(state => state.status === 'running')
    .flatMap(state =>
      (state.statusBar ?? []).map(item => ({
        ...item,
        key: `plugin:${state.id}:status:${item.id}`,
        pluginId: state.id,
        pluginName: state.name,
        instanceId: state.instanceId,
      })),
    )
    .sort((left, right) =>
      (right.priority ?? 0) - (left.priority ?? 0) ||
      left.pluginId.localeCompare(right.pluginId) ||
      left.id.localeCompare(right.id),
    );
}
export function pluginWorkbenchSlashCommands(
  installations: InstalledObjectPlugin[],
  states: PluginRuntimeState[],
): PluginWorkbenchSlashCommand[] {
  const active = new Map(
    states.filter(state => state.status === 'running' || state.status === 'idle').map(state => [state.id, state]),
  );
  return installations.flatMap(item => {
    const { manifest } = item;
    if (!item.enabled || manifest.manifestVersion !== 2 || !manifest.slashCommands?.length) return [];
    const runtime = active.get(manifest.id);
    if (!runtime) return [];
    const registered = new Set(runtime.commands.map(command => command.id));
    return manifest.slashCommands
      .filter(slash => registered.has(slash.command))
      .map(slash => ({
        ...slash,
        key: `plugin:${manifest.id}:slash:${slash.id}`,
        pluginId: manifest.id,
        pluginName: manifest.name,
        instanceId: runtime.instanceId,
      }));
  });
}
export function pluginWorkbenchCodeBlockRenderers(
  installations: InstalledObjectPlugin[],
  states: PluginRuntimeState[],
): PluginWorkbenchCodeBlockRenderer[] {
  const running = new Map(states.filter(state => state.status === 'running').map(state => [state.id, state]));
  return installations.flatMap(item => {
    const { manifest } = item;
    if (!item.enabled || manifest.manifestVersion !== 2 || !manifest.codeBlockRenderers?.length) return [];
    const runtime = running.get(manifest.id);
    if (!runtime?.uiBundles) return [];
    return manifest.codeBlockRenderers.flatMap(renderer => {
      const bundle = Object.hasOwn(runtime.uiBundles!, renderer.view) ? runtime.uiBundles![renderer.view] : undefined;
      if (!bundle) return [];
      return [
        {
          ...renderer,
          key: `plugin:${manifest.id}:codeblock:${renderer.view}`,
          pluginId: manifest.id,
          pluginName: manifest.name,
          instanceId: runtime.instanceId,
          bundle,
        },
      ];
    });
  });
}
export function pluginWorkbenchDecorations(
  states: PluginRuntimeState[],
  fileId: string,
): PluginWorkbenchDecoration[] {
  if (!fileId) return [];
  return states
    .filter(state => state.status === 'running')
    .flatMap(state =>
      (state.decorations?.[fileId] ?? []).map((item, index) => ({
        ...item,
        key: `plugin:${state.id}:deco:${fileId}:${item.id ?? index}`,
        pluginId: state.id,
        pluginName: state.name,
        instanceId: state.instanceId,
      })),
    );
}
export function pluginWorkbenchFileHandlers(
  installations: InstalledObjectPlugin[],
  states: PluginRuntimeState[],
): PluginWorkbenchFileHandler[] {
  const active = new Map(states.filter(state => state.status === 'running' || state.status === 'idle').map(state => [state.id, state]));
  return installations.flatMap(item => {
    const { manifest } = item;
    if (!item.enabled || manifest.manifestVersion !== 2 || !manifest.fileHandlers?.length) return [];
    const runtime = active.get(manifest.id);
    if (!runtime) return [];
    const registered = new Set(runtime.commands.map(command => command.id));
    return manifest.fileHandlers
      .filter(handler => registered.has(handler.command))
      .map(handler => ({
        ...handler,
        pluginId: manifest.id,
        pluginName: manifest.name,
        system: !!item.system,
        viewKey: pluginViewKey(manifest.id, handler.view),
      }));
  });
}
export function resolvePluginFileHandler(
  path: string,
  mode: PluginFileHandlerMode,
  handlers: readonly PluginWorkbenchFileHandler[],
): PluginWorkbenchFileHandler | undefined {
  if (!path || isWorkspaceInternalPath(path) || isDataTableFilePath(path)) return undefined;
  let bestLength = 0;
  let matches: PluginWorkbenchFileHandler[] = [];
  for (const handler of handlers) {
    if (handler.mode !== mode) continue;
    let longest = 0;
    for (const ext of handler.extensions) {
      if (matchPluginFileExtension(path, ext) && ext.length > longest) longest = ext.length;
    }
    if (!longest) continue;
    if (longest > bestLength) {
      bestLength = longest;
      matches = [handler];
    } else if (longest === bestLength) {
      matches.push(handler);
    }
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const systemMatches = matches.filter(item => item.system);
    if (systemMatches.length === 1) return systemMatches[0];
  }
  return undefined;
}
export function isPluginPreviewTab(tabId: string, installations: readonly InstalledObjectPlugin[]): boolean {
  return installations.some(item =>
    item.enabled &&
    item.manifest.manifestVersion === 2 &&
    !!item.manifest.fileHandlers?.some(
      handler => handler.mode === 'preview' && pluginViewKey(item.manifest.id, handler.view) === tabId,
    ),
  );
}
// Host/editor bindings win. Ambiguous plugin bindings never trigger either command.
// Formatting/navigation and browser reserved keys must remain available to the host.
const reserved = new Set(['Mod+B', 'Mod+I', 'Mod+U', 'Mod+Z', 'Mod+Y', 'Mod+Shift+Z', 'Mod+A', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+L', 'Mod+R', 'Mod+W', 'Mod+T', 'Mod+P', 'F5', 'F12']);
export function pluginShortcutCommand(event: KeyboardEvent, commands: PluginWorkbenchCommand[], bindings: ShortcutBindings) {
  if (event.defaultPrevented || event.isComposing || event.repeat) return;
  if (isElement(event.target) && event.target.closest('input, textarea, select, [contenteditable], [role="dialog"], dialog')) return;
  const key = shortcutBindingFromEvent(event);
  if (!key || reserved.has(key) || shortcutDefinitions.some(item => shortcutKeys(bindings[item.id]).includes(key))) return;
  const matches = commands.filter(command => command.shortcut === key);
  return matches.length === 1 ? matches[0] : undefined;
}
