import { validatePath } from './paths';
import { workspacePluginPath } from './extensions';

export const workspaceDataDirectory = '.tano';
export const objectDirectory = '.tano/objects';
export const workspaceCapabilityPath = '.tano/capabilities.json';
export const workspaceSettingsPath = '.tano/settings.tano.json';
export const workspaceRelationPath = '.tano/relations.tano-relations.json';
export const annotationDirectory = '.tano/annotations';
export const discussionDirectory = '.tano/discussions';
export const assistantRulesPath = '.tano/rules/assistant.md';
export const templateDirectory = '.tano/templates';
export const isTemplatePath = (path: string) => /^\.tano\/templates\/[0-9a-f]{6}\.md$/.test(path);

export function commentDataPath(kind: 'annotation' | 'discussion', fileId: string) {
  if (!/^[0-9a-f]{6}$/.test(fileId)) throw new Error('文档身份无效');
  return `${kind === 'annotation' ? annotationDirectory : discussionDirectory}/${fileId}.tano.json`;
}

export function isWorkspaceInternalPath(path: string) {
  return path === workspaceDataDirectory || path.startsWith(`${workspaceDataDirectory}/`);
}

/** Only portable Tano data is exposed to storage and sync; identity stays private. */
export function isWorkspaceDataPath(path: string) {
  return (
    path === workspaceCapabilityPath ||
    path === workspaceSettingsPath ||
    path === workspacePluginPath ||
    path === workspaceRelationPath ||
    path === assistantRulesPath ||
    isTemplatePath(path) ||
    (path.startsWith('.tano/conflicts/') && path.endsWith('.json')) ||
    (path.startsWith(`${objectDirectory}/`) && path.endsWith('.tano.json')) ||
    /^\.tano\/(?:annotations|discussions|document-layout|suggestions)\/[0-9a-f]{6}\.tano\.json$/.test(path)
  );
}

export function validateStoragePath(path: string): string | null {
  if (!isWorkspaceDataPath(path)) return validatePath(path);
  if (path.length > 220) return '路径过长，请使用更短的名称';
  return validatePath(path.slice(path.indexOf('/') + 1));
}
