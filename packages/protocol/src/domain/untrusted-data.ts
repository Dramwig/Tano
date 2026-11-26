export const PLUGIN_UNTRUSTED_START = '[UNTRUSTED_PLUGIN_DATA';
export const PLUGIN_UNTRUSTED_END = '[/UNTRUSTED_PLUGIN_DATA]';

/** Escape any spoofed boundary tokens so untrusted tool/plugin output cannot break out. */
export function sanitizePluginBoundaryText(value: string): string {
  return value
    .replaceAll(PLUGIN_UNTRUSTED_START, '[ESCAPED_UNTRUSTED_PLUGIN_DATA')
    .replaceAll(PLUGIN_UNTRUSTED_END, '[/ESCAPED_UNTRUSTED_PLUGIN_DATA]');
}

/** Wrap untrusted plugin/tool-supplied data in explicit boundary markers before sending to an LLM. */
export function wrapUntrustedPluginData(pluginId: string, source: string, payload: unknown): string {
  const safePluginId = pluginId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeSource = source.replace(/[^a-zA-Z0-9._:-]/g, '_');
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return `${PLUGIN_UNTRUSTED_START} plugin="${safePluginId}" source="${safeSource}"]\n${sanitizePluginBoundaryText(body)}\n${PLUGIN_UNTRUSTED_END}`;
}
