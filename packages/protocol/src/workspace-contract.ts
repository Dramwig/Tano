import type { FileEntry } from './index';
import type { ReferenceIdentity } from './objects';
import { isShortId } from './short-id';
import { validObjectType } from './object-types';
import { workspaceViewDirectory } from './workspace-paths';
import { validateFileDatabaseQuery, type FileDatabaseQuery } from './file-database';
import { validateObjectViewQuery, type ObjectViewQuery } from './view-engine';

/**
 * Portable contract shared by the local workspace and future cloud adapters.
 *
 * File bytes remain authoritative. Objects add stable semantics and relations;
 * views only project the two sources and never own content.
 */
export const workspaceContractVersion = 1 as const;
export type WorkspaceLayer = 'file' | 'object' | 'view';
export type WorkspaceViewKind = 'files' | 'objects' | 'table' | 'graph';

export interface WorkspaceRevision {
  /** Content revision, normally the adapter's SHA-256 hash. */
  hash: string;
  modified?: number;
}

export interface WorkspaceFileRef {
  version: typeof workspaceContractVersion;
  layer: 'file';
  workspaceId: string;
  fileId: string;
  path: string;
  revision: WorkspaceRevision;
}

export interface WorkspaceObjectRef {
  version: typeof workspaceContractVersion;
  layer: 'object';
  workspaceId: string;
  type: string;
  id: string;
  path: string;
  revision: WorkspaceRevision;
}

export type WorkspaceViewSource =
  | { layer: 'file'; fileId: string }
  | { layer: 'object'; type: string; id: string };

export interface WorkspaceViewDefinition {
  version: typeof workspaceContractVersion;
  layer: 'view';
  workspaceId: string;
  id: string;
  name: string;
  kind: WorkspaceViewKind;
  /** Static sources. Dynamic database rows resolve stable IDs from the scoped File Registry. */
  sources: WorkspaceViewSource[];
  /** A display/query hint. It is never executable code. */
  query?: string;
  /** Dynamic directory projection; source files are never imported or copied. */
  database?: FileDatabaseQuery;
  objectDatabase?: ObjectViewQuery;
}

const viewId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);

export const workspaceViewPath = (id: string) => {
  if (!viewId(id)) throw new Error('视图身份无效');
  return `${workspaceViewDirectory}/${id}.tano.json`;
};

export const fileIdentity = (workspaceId: string, fileId: string) => {
  if (!workspaceId || !isShortId(fileId)) throw new Error('文件身份无效');
  return `file://${workspaceId}/${fileId}`;
};

export const objectIdentity = (workspaceId: string, type: string, id: string) => {
  if (!workspaceId || !validObjectType(type) || !isShortId(id)) throw new Error('对象身份无效');
  return `object://${workspaceId}/${type}/${id}`;
};

export const viewIdentity = (workspaceId: string, id: string) => {
  if (!workspaceId || !viewId(id)) throw new Error('视图身份无效');
  return `view://${workspaceId}/${id}`;
};

export function fileRef(workspaceId: string, file: FileEntry, hash: string): WorkspaceFileRef {
  if (file.kind !== 'file' || !isShortId(file.id) || !file.path || !hash)
    throw new Error('文件来源无效');
  return {
    version: workspaceContractVersion,
    layer: 'file',
    workspaceId,
    fileId: file.id,
    path: file.path,
    revision: { hash, modified: file.modified },
  };
}

export function parseWorkspaceView(content: string): WorkspaceViewDefinition {
  const value = JSON.parse(content) as WorkspaceViewDefinition;
  if (
    !value ||
    typeof value !== 'object' ||
    value.version !== workspaceContractVersion ||
    value.layer !== 'view' ||
    typeof value.workspaceId !== 'string' ||
    !value.workspaceId.trim() ||
    !viewId(value.id) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 200 ||
    !['files', 'objects', 'table', 'graph'].includes(value.kind) ||
    !Array.isArray(value.sources) ||
    value.sources.length > 500 ||
    (value.query !== undefined && (typeof value.query !== 'string' || value.query.length > 2000))
  )
    throw new Error('工作区视图格式无效');
  const seen = new Set<string>();
  for (const source of value.sources) {
    if (!source || typeof source !== 'object') throw new Error('工作区视图来源无效');
    const key = source.layer === 'file'
      ? `file:${source.fileId}`
      : source.layer === 'object'
        ? `object:${source.type}/${source.id}`
        : '';
    if (
      !key ||
      seen.has(key) ||
      (source.layer === 'file' && !isShortId(source.fileId)) ||
      (source.layer === 'object' && (!validObjectType(source.type) || !isShortId(source.id)))
    )
      throw new Error('工作区视图来源身份无效或重复');
    seen.add(key);
  }
  if (value.database !== undefined) {
    if (value.kind !== 'files') throw new Error('文件数据库必须使用文件视图');
    validateFileDatabaseQuery(value.database);
  }
  if (value.objectDatabase !== undefined) {
    if (value.kind !== 'objects' || value.database) throw new Error('对象数据库必须使用对象视图');
    validateObjectViewQuery(value.objectDatabase);
  }
  return value;
}

/** View sources are references, never paths. This check is deliberately pure and rebuildable. */
export function viewSources(
  view: WorkspaceViewDefinition,
  files: readonly WorkspaceFileRef[],
  objects: readonly WorkspaceObjectRef[],
) {
  const workspaceFiles = files.filter((file) => file.workspaceId === view.workspaceId);
  const workspaceObjects = objects.filter((object) => object.workspaceId === view.workspaceId);
  const workspaceFileIds = new Set(workspaceFiles.map((file) => file.fileId));
  const workspaceObjectIds = new Set(workspaceObjects.map((object) => `${object.type}/${object.id}`));
  return view.sources.filter((source) =>
    source.layer === 'file'
      ? workspaceFileIds.has(source.fileId)
      : workspaceObjectIds.has(`${source.type}/${source.id}`),
  );
}
