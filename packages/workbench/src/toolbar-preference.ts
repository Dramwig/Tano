export type ToolbarMode = 'selection' | 'fixed' | 'bottom' | 'left' | 'right';

export const toolbarPreferenceKey = 'tano.preference.toolbarMode';

export const toolbarModeLabels: Record<ToolbarMode, string> = {
  selection: '随选区显示',
  fixed: '固定到顶部',
  bottom: '吸附在底部',
  left: '靠左停靠',
  right: '靠右停靠',
};

export function parseToolbarMode(value: unknown): ToolbarMode {
  return value === 'fixed' || value === 'bottom' || value === 'left' || value === 'right'
    ? value
    : 'selection';
}
