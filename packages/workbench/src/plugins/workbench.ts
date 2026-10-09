import type { PluginCommandDefinition, PluginViewDefinition } from '@tano/protocol';
import type { InstalledObjectPlugin } from '../workspace-plugins';
import type { PluginRuntimeState } from './host';
import { shortcutBindingFromEvent, shortcutDefinitions, type ShortcutBindings } from '../shortcuts';

export interface PluginWorkbenchView extends PluginViewDefinition {
  key: string; pluginId: string; pluginName: string;
}
export interface PluginWorkbenchCommand extends PluginCommandDefinition {
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
  return states.filter(state => state.status === 'running').flatMap(state => state.commands.map(command => ({
    ...command, key: `plugin:${state.id}:${command.id}`, pluginId: state.id, pluginName: state.name, instanceId: state.instanceId,
  })));
}
// Host/editor bindings win. Ambiguous plugin bindings never trigger either command.
// Formatting/navigation and browser reserved keys must remain available to the host.
const reserved = new Set(['Mod+B', 'Mod+I', 'Mod+U', 'Mod+Z', 'Mod+Y', 'Mod+Shift+Z', 'Mod+A', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+L', 'Mod+R', 'Mod+W', 'Mod+T', 'Mod+P', 'F5', 'F12']);
export function pluginShortcutCommand(event: KeyboardEvent, commands: PluginWorkbenchCommand[], bindings: ShortcutBindings) {
  if (event.defaultPrevented || event.isComposing || event.repeat) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="dialog"], dialog')) return;
  const key = shortcutBindingFromEvent(event);
  if (!key || reserved.has(key) || shortcutDefinitions.some(item => bindings[item.id] === key)) return;
  const matches = commands.filter(command => command.shortcut === key);
  return matches.length === 1 ? matches[0] : undefined;
}
