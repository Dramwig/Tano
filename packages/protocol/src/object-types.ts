/** Declarative object types shared by the editor, storage validation and future plugin hosts. */
import { parseTaskReview } from './task-review';
import { validateTaskRepeat } from './task-repeat';
import { isActionableTask, isPlanCompleted } from './plan-item';
export interface ObjectField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'datetime';
  required?: boolean;
}
export interface ObjectTypeDefinition {
  type: string;
  label: string;
  level: 2;
  category: 'core' | 'plugin';
  storage: 'record' | 'resource';
  /** Retained for existing files and references; not offered for new objects. */
  legacy?: boolean;
  plugin?: string;
  fields: readonly ObjectField[];
}
export const coreObjectTypes: readonly ObjectTypeDefinition[] = [
  {
    type: 'task', label: '任务', level: 2, category: 'core', storage: 'record', legacy: true, fields: [
      { key: 'status', label: '状态', type: 'text' },
      { key: 'due', label: '截止日期', type: 'text' },
      { key: 'priority', label: '优先级', type: 'number' },
      { key: 'completed', label: '已完成', type: 'boolean' },
    ],
  },
  { type: 'person', label: '人物', level: 2, category: 'core', storage: 'record', fields: [] },
  { type: 'document', label: '文档', level: 2, category: 'core', storage: 'resource', fields: [] },
  {
    type: 'event',
    label: '事件',
    level: 2,
    category: 'core',
    storage: 'record',
    fields: [
      { key: 'checkable', label: '需要完成', type: 'boolean' },
      { key: 'completed', label: '已完成', type: 'boolean' },
      { key: 'status', label: '状态', type: 'text' },
      { key: 'priority', label: '优先级', type: 'number' },
      { key: 'due', label: '截止日期', type: 'text' },
      { key: 'date', label: '计划日期（不指定时间）', type: 'text' },
      { key: 'endDate', label: '结束日期', type: 'text' },
      { key: 'start', label: '开始时间', type: 'datetime' },
      { key: 'end', label: '结束时间', type: 'datetime' },
      { key: 'allDay', label: '全天', type: 'boolean' },
      { key: 'timezone', label: '时区', type: 'text' },
      { key: 'location', label: '地点', type: 'text' },
    ],
  },
  { type: 'asset', label: '资产', level: 2, category: 'core', storage: 'resource', fields: [] },
].map((definition) =>
  Object.freeze({
    ...definition,
    fields: Object.freeze(definition.fields.map((field) => Object.freeze(field))),
  }),
) as readonly ObjectTypeDefinition[];

export const validObjectType = (type: unknown): type is string =>
  typeof type === 'string' &&
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(type) &&
  type.length <= 80;
export class ObjectTypeRegistry {
  private definitions = new Map(coreObjectTypes.map((definition) => [definition.type, definition]));
  private listeners = new Set<() => void>();
  list() {
    return [...this.definitions.values()];
  }
  get(type: string) {
    return this.definitions.get(type);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Namespaced IDs prevent two domain plugins or a plugin and core from shadowing each other. */
  registerObjectType(input: {
    plugin: string;
    type: string;
    label: string;
    fields?: readonly ObjectField[];
  }) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(input.plugin) ||
      !validObjectType(input.type) ||
      !input.type.startsWith(`${input.plugin}.`)
    )
      throw new Error('插件对象类型须使用 plugin.type 命名空间');
    if (this.definitions.has(input.type)) throw new Error('对象类型已注册');
    if (!input.label.trim() || input.label.length > 80) throw new Error('对象类型需要有效名称');
    const keys = new Set<string>();
    for (const field of input.fields ?? []) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.key) ||
        ['constructor', 'prototype', '__proto__'].includes(field.key) ||
        keys.has(field.key) ||
        !field.label.trim() ||
        !['text', 'number', 'boolean', 'datetime'].includes(field.type)
      )
        throw new Error('插件属性定义无效或重复');
      keys.add(field.key);
    }
    const definition: ObjectTypeDefinition = Object.freeze({
      type: input.type,
      label: input.label,
      plugin: input.plugin,
      level: 2,
      category: 'plugin',
      storage: 'record',
      fields: Object.freeze((input.fields ?? []).map((field) => Object.freeze({ ...field }))),
    });
    this.definitions.set(input.type, definition);
    for (const listener of this.listeners) listener();
    return () => {
      if (this.definitions.get(input.type) !== definition) return;
      this.definitions.delete(input.type);
      for (const listener of this.listeners) listener();
    };
  }
}
/** Shared schema authority for object CRUD, relation endpoints and view fields. */
export class SchemaRegistry extends ObjectTypeRegistry {
  readonly version = 1;
  validate(type: string, properties: Record<string, unknown>) {
    validateObjectProperties(type, properties, this);
  }
}
export const schemaRegistry = new SchemaRegistry();
/** Compatibility name used by editor and plugin integrations. */
export const objectTypeRegistry: ObjectTypeRegistry = schemaRegistry;
export const registerObjectType = (
  input: Parameters<ObjectTypeRegistry['registerObjectType']>[0],
) => objectTypeRegistry.registerObjectType(input);

/** A local calendar date, intentionally independent of a time zone. */
export function validEventDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** RFC 3339 timestamps with an explicit offset keep events unambiguous across devices. */
export function validEventTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match;
  return (
    +month! >= 1 &&
    +month! <= 12 &&
    +day! >= 1 &&
    +day! <= new Date(Date.UTC(+year!, +month!, 0)).getUTCDate() &&
    +hour! < 24 &&
    +minute! < 60 &&
    +(second ?? 0) < 60 &&
    +(match[8] ?? 0) <= 23 &&
    +(match[9] ?? 0) < 60
  );
}
export function validateObjectProperties(
  type: string,
  properties: Record<string, unknown>,
  registry = objectTypeRegistry,
) {
  validateTaskRepeat(type, properties);
  if (properties.deliveryReview !== undefined) {
    const review = parseTaskReview(properties.deliveryReview);
    if (!isActionableTask({ type, properties })) throw new Error('只有任务可以提交交付审阅');
    if (isPlanCompleted({ type, properties }) && review.state !== 'approved') throw new Error('此任务需由指定审阅人确认通过后完成');
  }
  const definition = registry.get(type);
  if (!definition) throw new Error(`类型 ${type} 未启用，请先注册对应领域插件；原文件已保留`);
  if (definition.storage !== 'record')
    throw new Error('文档和资产来自工作区文件，不创建重复内容对象');
  for (const field of definition.fields) {
    const value = properties[field.key];
    if (value === undefined || value === '') {
      if (field.required) throw new Error(`请填写${field.label}`);
      continue;
    }
    const valid =
      field.type === 'datetime'
        ? validEventTime(value)
        : field.type === 'text'
          ? typeof value === 'string'
          : field.type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === 'boolean';
    if (!valid)
      throw new Error(
        `${field.label}格式无效${field.type === 'datetime' ? '，请使用带时区的日期时间' : ''}`,
      );
  }
  if (type === 'task' && properties.due !== undefined && properties.due !== '' && !validEventDate(properties.due)) throw new Error('截止日期格式无效，请使用 YYYY-MM-DD');
  if (type === 'event') {
    const hasStart = properties.start !== undefined && properties.start !== '';
    const hasEnd = properties.end !== undefined && properties.end !== '';
    const hasDate = properties.date !== undefined && properties.date !== '';
    const hasEndDate = properties.endDate !== undefined && properties.endDate !== '';
    if (hasStart !== hasEnd) throw new Error('开始时间和结束时间需要一起填写');
    if (hasStart && Date.parse(String(properties.end)) < Date.parse(String(properties.start)))
      throw new Error('结束时间不能早于开始时间');
    if (hasDate && !validEventDate(properties.date)) throw new Error('计划日期格式无效');
    if (hasEndDate) {
      if (!hasDate) throw new Error('结束日期需要与计划日期一起填写');
      if (!validEventDate(properties.endDate)) throw new Error('结束日期格式无效');
      if (String(properties.endDate) < String(properties.date)) throw new Error('结束日期不能早于计划日期');
    }
    if (properties.due !== undefined && properties.due !== '' && !validEventDate(properties.due)) throw new Error('截止日期格式无效，请使用 YYYY-MM-DD');
    if (hasDate && hasStart) throw new Error('计划日期与具体时间段只能选择一种安排方式');
    if (properties.timezone !== undefined && properties.timezone !== '' && (typeof properties.timezone !== 'string' || properties.timezone.length > 100))
      throw new Error('时区格式无效');
    if (properties.location !== undefined && properties.location !== '' && (typeof properties.location !== 'string' || properties.location.length > 500))
      throw new Error('地点格式无效');
    if (properties.reminders !== undefined) {
      if (
        !Array.isArray(properties.reminders) ||
        properties.reminders.length > 5 ||
        !properties.reminders.every((item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 43200)
      ) {
        throw new Error('提醒设置无效');
      }
    }
    if (properties.completed === true && properties.checkable !== true)
      throw new Error('只有需要完成的事件可以标记为已完成');
  }
}
