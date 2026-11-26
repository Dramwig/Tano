import { basename } from '@tano/protocol';
import { t } from '../i18n/i18n';
import type { DocumentTab } from '../stores/workspace';

/** Shared by the tab strip and the auxiliary native window title. */
export function documentTabLabel(tab: DocumentTab): string {
  if (tab.pluginDetail) return tab.pluginDetail.name;
  if (tab.directory) return t(tab.directory.name);
  if (tab.dataTable) return tab.dataTable.name;
  if (tab.graph) return t('关系图谱');
  if (tab.plugins) return t('插件');
  if (tab.calendar) return t('计划');
  if (tab.pluginView) return tab.pluginView.label;
  if (tab.view) return tab.view.label;
  if (tab.blank) return t('新标签页');
  return basename(tab.path).replace(/\.(md|markdown)$/i, '');
}
