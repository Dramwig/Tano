import type { FileEntry } from './index';
import { isMarkdown } from './paths';
import { isShortId } from './short-id';
import { coreObjectTypes, objectTypeRegistry, validObjectType } from './object-types';

export const objectTypes = coreObjectTypes;
export type ObjectType = string;
export type ReferenceType = string;
export interface WorkspaceObject {
  version: 1;
  id: string;
  type: ObjectType;
  name: string;
  description: string;
  archived: boolean;
  properties: Record<string, unknown>;
  [key: string]: unknown;
}
export interface ReferenceIdentity {
  type: ReferenceType;
  id: string;
}
export interface ReferenceTarget extends ReferenceIdentity {
  workspace: string;
  name: string;
  path: string;
  archived?: boolean;
  description?: string;
  size?: number;
  mime?: string;
  modified?: number;
  properties?: Record<string, unknown>;
}
export const objectSuffix = '.tano.json';
export const isObjectPath = (path: string) => path.endsWith(objectSuffix);
export const referenceTypeLabel = (type: string) =>
  objectTypeRegistry.get(type)?.label ?? `未启用类型（${type}）`;
export function parseObject(content: string): WorkspaceObject {
  const data = JSON.parse(content) as WorkspaceObject;
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    data.version !== 1 ||
    !isShortId(data.id) ||
    !validObjectType(data.type) ||
    typeof data.name !== 'string' ||
    !data.name.trim() ||
    data.name.length > 200 ||
    /[\u0000-\u001f]/.test(data.name) ||
    typeof data.description !== 'string' ||
    data.description.length > 20000 ||
    typeof data.archived !== 'boolean' ||
    !data.properties ||
    typeof data.properties !== 'object' ||
    Array.isArray(data.properties)
  )
    throw new Error('对象格式无效，请检查 version、id、type、name 和 properties');
  return data;
}
export function referenceUrl(target: ReferenceIdentity): string {
  if (!isShortId(target.id) || !validObjectType(target.type)) throw new Error('引用身份无效');
  return `object://${target.type}/${target.id}`;
}
export function parseReferenceUrl(url: string): ReferenceIdentity | null {
  const match = /^object:\/\/([a-z][a-z0-9.-]*)\/([0-9a-f]{6})$/.exec(url);
  return match && validObjectType(match[1]) ? { type: match[1]!, id: match[2]! } : null;
}
export function documentTargets(workspace: string, files: FileEntry[]): ReferenceTarget[] {
  return files
    .filter((file) => file.kind === 'file' && isMarkdown(file.path) && isShortId(file.id))
    .map((file) => ({
      workspace,
      type: 'document',
      id: file.id,
      name: file.name.replace(/\.(md|markdown)$/i, ''),
      path: file.path,
      size: file.size,
      modified: file.modified,
      mime: 'text/markdown',
    }));
}
const mimeTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
};
/** Resource metadata is derived from files; it never contains their body or bytes. MIME is an extension hint. */
export function assetTargets(workspace: string, files: FileEntry[]): ReferenceTarget[] {
  return files
    .filter(
      (file) =>
        file.kind === 'file' &&
        isShortId(file.id) &&
        !isMarkdown(file.path) &&
        !isObjectPath(file.path) &&
        !file.path.endsWith('.tano-relations.json') &&
        file.path !== 'capabilities.json' &&
        !file.path.split('/').some((part) => part.startsWith('.')),
    )
    .map((file) => ({
      workspace,
      type: 'asset',
      id: file.id,
      name: file.name,
      path: file.path,
      size: file.size,
      modified: file.modified,
      mime:
        mimeTypes[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream',
    }));
}
/** Callers provide the current workspace's targets. Names are search input, never identity. */
export function resolveReference(targets: readonly ReferenceTarget[], identity: ReferenceIdentity) {
  if (!objectTypeRegistry.get(identity.type)) return { error: 'unregistered' as const };
  const matches = targets.filter(
    (target) => target.type === identity.type && target.id === identity.id,
  );
  return matches.length === 1
    ? { target: matches[0]! }
    : { error: matches.length ? ('ambiguous' as const) : ('missing' as const) };
}
export function referenceCandidates(
  targets: readonly ReferenceTarget[],
  query: string,
): ReferenceTarget[] {
  const input = query
    .replace(/^@|^\[\[/, '')
    .replace(/\]\]$/, '')
    .trim();
  const qualifier = /^([a-z][a-z0-9.-]*)[:/](.*)$/i.exec(input);
  const name = (qualifier?.[2] ?? input).normalize('NFKC').toLocaleLowerCase();
  return targets
    .filter(
      (target) =>
        !!objectTypeRegistry.get(target.type) &&
        !target.archived &&
        (!qualifier || target.type === qualifier[1]!.toLowerCase()) &&
        `${target.name}\n${target.path}`.normalize('NFKC').toLocaleLowerCase().includes(name),
    )
    .sort(
      (a, b) =>
        Number(b.name.normalize('NFKC').toLocaleLowerCase() === name) -
          Number(a.name.normalize('NFKC').toLocaleLowerCase() === name) ||
        a.name.localeCompare(b.name) ||
        a.type.localeCompare(b.type) ||
        a.id.localeCompare(b.id),
    );
}
