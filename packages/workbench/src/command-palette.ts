import { blockTypes, commandEnabled, inlineTypes, insertionCommands, wrappingCommands } from '@tano/editor/selection-context';
import type { EditorSelectionContext } from '@tano/editor/selection-context';
import type { DocumentFeatures } from '@tano/editor/runtime';

export interface WorkbenchCommand {
  id: string;
  label: string;
  category?: string;
  keywords?: string;
  shortcut?: string | null;
  available?: boolean;
  run: () => unknown;
}

export function matchesCommand(command: { id: string; label: string; source?: string; keywords?: string; available?: boolean }, query: string) {
  if (command.available === false) return false;
  const text = `${command.label} ${command.source ?? ''} ${command.id} ${command.keywords ?? ''}`.toLocaleLowerCase();
  return query.trim().replace(/^>\s*/, '').toLocaleLowerCase().split(/\s+/).every(term => text.includes(term));
}

// Commands that require a URL or another form stay in their existing editor menus.
const formCommands = new Set(['link', 'mention', 'image', 'footnote', 'file', 'embed']);
const extraStyles = [
  { command: 'strikethrough', label: '删除线' },
  { command: 'underline', label: '下划线' },
  { command: 'highlight', label: '高亮' },
  { command: 'superscript', label: '上标' },
  { command: 'subscript', label: '下标' },
];

export function editorPaletteCommands(options: {
  editable: boolean;
  source: boolean;
  context: EditorSelectionContext;
  features: DocumentFeatures;
  run: (name: string, value?: string) => unknown;
}): WorkbenchCommand[] {
  if (!options.editable || options.source) return [];
  const { context, features, run } = options;
  const blocks = blockTypes.flatMap<WorkbenchCommand>(item => {
    if (formCommands.has(item.command) || !commandEnabled(item.command, undefined, features)) return [];
    if (!context.canTransform && !insertionCommands.has(item.command) && !wrappingCommands.has(item.command)) return [];
    if (item.command === 'heading') return Array.from({ length: 6 }, (_, index) => ({
      id: `editor.heading.${index + 1}`, category: '格式', label: `转换为 ${index + 1} 级标题`,
      keywords: `heading h${index + 1} 标题${index + 1}`,
      run: () => run('heading', String(index + 1)),
    }));
    const insert = insertionCommands.has(item.command);
    return [{ id: `editor.${item.command}`, category: insert ? '插入' : '格式',
      label: insert ? item.label : `转换为${item.label}`, keywords: item.type,
      run: () => run(item.command) }];
  });
  const inline = inlineTypes.filter(item => !formCommands.has(item.command)
    && commandEnabled(item.command, undefined, features)
    && (!context.inlineSource || ['bold', 'italic', 'code'].includes(item.command))
    && (context.canStyleText || !['bold', 'italic', 'code'].includes(item.command)))
    .map(item => ({ id: `editor.${item.command}`, category: '格式', label: item.label,
      keywords: item.type, run: () => run(item.command) }));
  const styles = context.canStyleText && !context.inlineSource
    ? extraStyles.filter(item => commandEnabled(item.command, undefined, features))
      .map(item => ({ id: `editor.${item.command}`, category: '格式', label: item.label, run: () => run(item.command) }))
    : [];
  return [...blocks, ...inline, ...styles];
}
