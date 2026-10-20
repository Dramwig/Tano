import { isShortId } from './short-id';

export interface FileMetadata {
  version: 1;
  fileId: string;
  tags: string[];
  properties: Record<string, string | number | boolean | null>;
}
export function fileMetadataPath(fileId: string) {
  if (!isShortId(fileId)) throw new Error('文件身份无效');
  return `.tano/files/${fileId}.tano.json`;
}
export const emptyFileMetadata = (fileId: string): FileMetadata => ({ version: 1, fileId, tags: [], properties: {} });
export function parseFileMetadata(content: string, fileId: string): FileMetadata {
  fileMetadataPath(fileId);
  const value = JSON.parse(content) as FileMetadata;
  if (!value || value.version !== 1 || value.fileId !== fileId ||
    !Array.isArray(value.tags) || value.tags.length > 100 ||
    value.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100) ||
    new Set(value.tags).size !== value.tags.length ||
    !value.properties || typeof value.properties !== 'object' || Array.isArray(value.properties) ||
    Object.keys(value.properties).length > 100 ||
    Object.entries(value.properties).some(([key, item]) => !key.trim() || key.length > 100 ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      !(item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) ||
        (typeof item === 'string' && item.length <= 10000)))) throw new Error('文件元数据格式无效');
  return { version: 1, fileId, tags: value.tags, properties: value.properties };
}
