import { pluginRecord, type PluginJson } from '@tano/protocol';
import type { PluginRuntimeState } from './host';
export interface PluginViewHeader {
  title: string;
  status?: string;
  statusAfter?: string;
  previewInfo?: { label: string; detail: string };
  actions: { id: string; label: string; icon?: 'open' | 'previous' | 'next' | 'minus' | 'plus' | 'fit' | 'info'; disabled?: boolean; accept?: string; group?: string }[];
}
export function parseViewHeader(value: PluginJson): PluginViewHeader {
  if (!pluginRecord(value) || typeof value.title !== 'string' || value.title.length > 200 ||
    (value.status !== undefined && (typeof value.status !== 'string' || value.status.length > 80)) ||
    !Array.isArray(value.actions) || value.actions.length > 10) throw new Error('插件页眉无效');
  const ids = new Set<string>();
  if (value.previewInfo !== undefined && (!pluginRecord(value.previewInfo) ||
    typeof value.previewInfo.label !== 'string' || !value.previewInfo.label.trim() || value.previewInfo.label.length > 80 ||
    typeof value.previewInfo.detail !== 'string' || !value.previewInfo.detail.trim() || value.previewInfo.detail.length > 2000)) throw new Error('插件预览说明无效');
  for (const action of value.actions) {
    if (!pluginRecord(action) || typeof action.id !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(action.id) || ids.has(action.id) ||
      typeof action.label !== 'string' || action.label.length > 80 ||
      (action.disabled !== undefined && typeof action.disabled !== 'boolean') ||
      (action.group !== undefined && (typeof action.group !== 'string' || !action.group.trim() || action.group.length > 40)) ||
      (action.icon !== undefined && (typeof action.icon !== 'string' || !['open', 'previous', 'next', 'minus', 'plus', 'fit', 'info'].includes(action.icon))) ||
      (action.accept !== undefined && (typeof action.accept !== 'string' || !/^\.[a-z0-9]+(?:,\.[a-z0-9]+)*$/i.test(action.accept) || action.accept.length > 100))) throw new Error('插件页眉操作无效');
    ids.add(action.id);
  }
  if (value.statusAfter !== undefined && (typeof value.statusAfter !== 'string' || !ids.has(value.statusAfter))) throw new Error('插件页眉状态位置无效');
  return value as unknown as PluginViewHeader;
}
export function pluginViewHeader(states: PluginRuntimeState[], view: { pluginId: string; id: string }) {
  return states.find(state => state.id === view.pluginId && state.status === 'running')?.views.find(item => item.id === view.id)?.header;
}
export function pluginPreviewStatus(states: PluginRuntimeState[], view: { pluginId: string; id: string }) {
  const info = pluginViewHeader(states, view)?.previewInfo;
  return info ? [{ kind: 'preview' as const, label: info.label, detail: info.detail }] : [];
}
