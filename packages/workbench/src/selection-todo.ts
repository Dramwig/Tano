import { referenceMarkdown } from '@tano/protocol';
import type { ReferenceTarget, WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from './workspace-objects';
import { writePlanDate, type PlanDateValue } from './plan-date';

export interface SelectionPlanOptions {
  kind?: 'task' | 'event';
  date?: PlanDateValue;
}
export interface PlanDocumentSource {
  workspaceId: string;
  fileId: string;
  selection: { text: string; from?: number; to?: number };
}
export function planDocumentSource(value: unknown): PlanDocumentSource | undefined {
  if (!value || typeof value !== 'object') return;
  const source = value as PlanDocumentSource;
  if (typeof source.workspaceId !== 'string' || typeof source.fileId !== 'string' ||
      !source.selection || typeof source.selection.text !== 'string') return;
  const { from, to } = source.selection;
  if ((from !== undefined || to !== undefined) &&
      (!Number.isInteger(from) || !Number.isInteger(to) || from! < 0 || to! < from!)) return;
  return source;
}

export function selectionTodoDraft(text: string, source: ReferenceTarget, name: string, options: SelectionPlanOptions = {}) {
  const title = name.trim();
  if (!title || title.length > 200 || /[\u0000-\u001f]/.test(title)) throw new Error('请填写不超过 200 字符的任务名称');
  const quote = text.replace(/[\\`*_[\]<>#!+\-]/g, '\\$&').split(/\r?\n/).map(line => `> ${line}`).join('\n');
  const description = `${referenceMarkdown(source, source.name)}\n\n${quote}`;
  if (description.length > 20000) throw new Error('选中文字过长，请缩小选区后创建任务');
  if (options.kind === 'event' && !options.date?.date) throw new Error('请为事件选择日期');
  const properties = writePlanDate({ checkable: options.kind !== 'event', completed: false }, options.date ?? { date: '', time: '', end: '' });
  return { type: 'event', name: title, description, archived: false, properties } satisfies Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'archived' | 'properties'>;
}

export function selectionTodoSession(text: string, source: ReferenceTarget, port: {
  create: (draft: ReturnType<typeof selectionTodoDraft>) => Promise<ObjectRecord>;
  insert: (record: ObjectRecord, append: boolean) => Promise<void>;
}, context?: { workspaceName: string; source: PlanDocumentSource }) {
  let created: ObjectRecord | undefined;
  let busy = false;
  let linked = false;
  return {
    text, source, workspaceName: context?.workspaceName ?? source.workspace,
    name: text.trim().replace(/\s+/g, ' ').slice(0, 200),
    get created() { return created; },
    async save(name: string, append = false, options: SelectionPlanOptions = {}) {
      if (busy) throw new Error('正在保存任务');
      if (linked) return;
      busy = true;
      try {
        if (!created) {
          const draft = selectionTodoDraft(text, source, name, options);
          if (context) draft.properties.documentSource = context.source;
          created = await port.create(draft);
        }
        await port.insert(created, append);
        linked = true;
      } finally { busy = false; }
    },
  };
}
export type SelectionTodoSession = ReturnType<typeof selectionTodoSession>;
