import { emptyFileMetadata, type FileMetadata } from './file-metadata';
import { frontmatterProperties, frontmatterValue } from './frontmatter';

/** Read-only projection; Markdown properties remain in the source document. */
export function markdownFileMetadata(id: string, content: string): FileMetadata {
  const file = emptyFileMetadata(id);
  for (const property of frontmatterProperties(content) ?? []) {
    const value = frontmatterValue(content, property.name);
    if (!value) continue;
    if (['tags', '标签'].includes(property.name)) {
      const tags: unknown = value.kind === 'list' ? JSON.parse(value.value) : value.value.split(/[,，]/);
      if (Array.isArray(tags)) file.tags.push(...tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean));
    } else if (!['object', 'list'].includes(value.kind)) {
      Object.defineProperty(file.properties, property.name, { enumerable: true, configurable: true, writable: true,
        value: value.kind === 'null' ? null : value.kind === 'number' ? Number(value.value) : value.kind === 'boolean' ? value.value === 'true' : value.value });
    }
  }
  file.tags = [...new Set(file.tags)];
  // Aliases are only for querying the common columns; never write them back.
  for (const [key, alias] of [['owner', '负责人'], ['status', '状态']]) {
    if (!Object.hasOwn(file.properties, key) && Object.hasOwn(file.properties, alias!)) file.properties[key!] = file.properties[alias!]!;
  }
  return file;
}
