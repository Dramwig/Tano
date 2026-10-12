import { isDataTableFilePath, isMarkdown, isWorkspaceInternalPath, parseDataTable, validatePath } from '@tano/protocol';

/** Assistant access is limited to ordinary user documents and portable data tables. */
export const isAssistantFile = (path: string) => !validatePath(path) && !isWorkspaceInternalPath(path) &&
  (isMarkdown(path) || isDataTableFilePath(path));

export function validateAssistantContent(path: string, content: string, base?: string) {
  if (!isAssistantFile(path) || content.length > 512_000) throw new Error('文件路径或内容无效');
  if (isDataTableFilePath(path)) parseDataTable(content, base === undefined ? undefined : parseDataTable(base).id);
}

export const validAssistantDestination = (source: string, destination: string) =>
  isAssistantFile(destination) && isDataTableFilePath(source) === isDataTableFilePath(destination);
