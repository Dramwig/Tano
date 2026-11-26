export {
  assistantAnswerText,
  assistantDisplayParts,
  assistantHistory,
  assistantMessageParts,
  type AssistantDisplayPart,
} from '@tano/protocol/assistant-history';
import { t, uiLocale } from '../i18n/i18n';
import { resolveAssistantExtension, useWorkbenchRuntime } from '../runtime';
import { assistantCopy } from './language';

export function assistantToolLabel(name: string) {
  const copy = assistantCopy(uiLocale.value);
  const toolLabels: Record<string, string> = copy.tools;
  if (Object.prototype.hasOwnProperty.call(toolLabels, name)) return toolLabels[name];
  if (name === 'inspect_plugins') return t('查看已启用插件');
  if (name === 'inspect_plugin_logs') return t('查看插件运行日志');
  if (name === 'open_plugin_view') return t('打开插件视图');
  try {
    const customLabel = resolveAssistantExtension(useWorkbenchRuntime())?.toolLabel?.(name);
    if (customLabel) return customLabel;
  } catch {
    /* outside Pinia runtime */
  }
  return name;
}
