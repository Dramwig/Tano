import { validatePath } from './paths';

export const workspaceDataDirectory = '.tano';
export const objectDirectory = '.tano/objects';
export const workspaceCapabilityPath = '.tano/capabilities.json';
export const workspaceRelationPath = '.tano/relations.tano-relations.json';

export function isWorkspaceInternalPath(path: string) {
  return path === workspaceDataDirectory || path.startsWith(`${workspaceDataDirectory}/`);
}

/** Only portable Tano data is exposed to storage and sync; identity stays private. */
export function isWorkspaceDataPath(path: string) {
  return (
    path === workspaceCapabilityPath ||
    path === workspaceRelationPath ||
    (path.startsWith('.tano/conflicts/') && path.endsWith('.json')) ||
    (path.startsWith(`${objectDirectory}/`) && path.endsWith('.tano.json'))
  );
}

export function validateStoragePath(path: string): string | null {
  if (!isWorkspaceDataPath(path)) return validatePath(path);
  if (path.length > 220) return '路径过长，请使用更短的名称';
  return validatePath(path.slice(path.indexOf('/') + 1));
}
