import { ObjectTypeRegistry, coreObjectTypes, validObjectType } from './object-types';
import type { ObjectField } from './object-types';
import type { RelationTypeDefinition } from './relations';

export interface ObjectPluginManifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  objectTypes: { type: string; label: string; fields: ObjectField[] }[];
  relationTypes: RelationTypeDefinition[];
}
/** Data-only manifests: no script, network, renderer, or filesystem execution. */
export function parseObjectPlugin(content: string): ObjectPluginManifest {
  if (content.length > 256 * 1024) throw new Error('插件清单不能超过 256 KB');
  const value = JSON.parse(content);
  const keys = (object: unknown, allowed: string[]) => {
    if (
      !object ||
      typeof object !== 'object' ||
      Array.isArray(object) ||
      Object.keys(object).some((key) => !allowed.includes(key))
    )
      throw new Error('插件清单包含不支持的字段或可执行扩展');
  };
  const label = (text: unknown, limit = 80): text is string =>
    typeof text === 'string' &&
    !!text.trim() &&
    text.length <= limit &&
    !/[\u0000-\u001f]/.test(text);
  keys(value, [
    'manifestVersion',
    'id',
    'name',
    'version',
    'description',
    'objectTypes',
    'relationTypes',
  ]);
  if (
    value.manifestVersion !== 1 ||
    typeof value.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,39}$/.test(value.id) ||
    !label(value.name) ||
    typeof value.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    typeof value.description !== 'string' ||
    value.description.length > 2000 ||
    !Array.isArray(value.objectTypes) ||
    value.objectTypes.length > 50 ||
    !Array.isArray(value.relationTypes ?? []) ||
    (value.relationTypes?.length ?? 0) > 100
  )
    throw new Error('插件清单的名称、版本或类型列表无效');
  const registry = new ObjectTypeRegistry();
  for (const definition of value.objectTypes) {
    keys(definition, ['type', 'label', 'fields']);
    if (
      !label(definition.label) ||
      !Array.isArray(definition.fields ?? []) ||
      (definition.fields?.length ?? 0) > 50
    )
      throw new Error('插件对象字段无效');
    for (const field of definition.fields ?? []) {
      keys(field, ['key', 'label', 'type', 'required']);
      if (
        typeof field.key !== 'string' ||
        !label(field.label) ||
        (field.required !== undefined && typeof field.required !== 'boolean')
      )
        throw new Error('插件属性字段无效');
    }
    registry.registerObjectType({ ...definition, plugin: value.id });
  }
  const available = new Set([
    ...coreObjectTypes.map((type) => type.type),
    ...value.objectTypes.map((type: { type: string }) => type.type),
    '*',
  ]);
  const relationIds = new Set<string>();
  const relations: RelationTypeDefinition[] = [];
  for (const definition of value.relationTypes ?? []) {
    keys(definition, ['type', 'label', 'sourceTypes', 'targetTypes', 'level', 'plugin']);
    if (
      !validObjectType(definition.type) ||
      !definition.type.startsWith(`${value.id}.`) ||
      relationIds.has(definition.type) ||
      !label(definition.label) ||
      [definition.sourceTypes, definition.targetTypes].some(
        (types) =>
          !Array.isArray(types) ||
          !types.length ||
          types.some((type: unknown) => !available.has(type)),
      )
    )
      throw new Error('插件关系定义或端点类型无效');
    relationIds.add(definition.type);
    relations.push({ ...definition, level: 2, plugin: value.id });
  }
  return {
    ...value,
    objectTypes: value.objectTypes.map((type: { fields?: ObjectField[] }) => ({
      ...type,
      fields: type.fields ?? [],
    })),
    relationTypes: relations,
  };
}

export const bundledObjectPlugins: readonly ObjectPluginManifest[] = [
  {
    manifestVersion: 1,
    id: 'research',
    name: '研究工作台',
    version: '1.0.0',
    description: '管理论文、数据集和实验，连接论文使用的数据与实验。',
    objectTypes: [
      {
        type: 'research.paper',
        label: '论文',
        fields: [
          { key: 'year', label: '年份', type: 'number' },
          { key: 'doi', label: 'DOI', type: 'text' },
        ],
      },
      {
        type: 'research.dataset',
        label: '数据集',
        fields: [{ key: 'url', label: '来源链接', type: 'text' }],
      },
      {
        type: 'research.experiment',
        label: '实验',
        fields: [{ key: 'status', label: '进度', type: 'text' }],
      },
    ],
    relationTypes: [
      {
        type: 'research.uses',
        label: '使用数据集',
        sourceTypes: ['research.paper', 'research.experiment'],
        targetTypes: ['research.dataset'],
        level: 2,
        plugin: 'research',
      },
      {
        type: 'research.validates',
        label: '验证论文',
        sourceTypes: ['research.experiment'],
        targetTypes: ['research.paper'],
        level: 2,
        plugin: 'research',
      },
    ],
  },
  {
    manifestVersion: 1,
    id: 'reading',
    name: '阅读书架',
    version: '1.0.0',
    description: '记录书籍与阅读笔记，将书籍关联到工作区文档。',
    objectTypes: [
      {
        type: 'reading.book',
        label: '书籍',
        fields: [
          { key: 'author', label: '作者', type: 'text' },
          { key: 'isbn', label: 'ISBN', type: 'text' },
        ],
      },
    ],
    relationTypes: [
      {
        type: 'reading.notes',
        label: '阅读笔记',
        sourceTypes: ['reading.book'],
        targetTypes: ['document'],
        level: 2,
        plugin: 'reading',
      },
    ],
  },
];
