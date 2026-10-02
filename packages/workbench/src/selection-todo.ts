import { referenceMarkdown } from '@tano/protocol';
import type { ReferenceTarget, WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from './workspace-objects';

export function selectionTodoDraft(text: string, source: ReferenceTarget, name: string) {
  const title = name.trim();
  if (!title || title.length > 200 || /[\u0000-\u001f]/.test(title)) throw new Error('请填写不超过 200 字符的任务名称');
  const quote = text.replace(/[\\`*_[\]<>#!+\-]/g, '\\$&').split(/\r?\n/).map(line => `> ${line}`).join('\n');
  const description = `${referenceMarkdown(source, source.name)}\n\n${quote}`;
  if (description.length > 20000) throw new Error('选中文字过长，请缩小选区后创建任务');
  return { type: 'event', name: title, description, archived: false, properties: { checkable: true, completed: false } } satisfies Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'archived' | 'properties'>;
}

export function selectionTodoSession(text: string, source: ReferenceTarget, port: {
  create: (draft: ReturnType<typeof selectionTodoDraft>) => Promise<ObjectRecord>;
  insert: (record: ObjectRecord, append: boolean) => Promise<void>;
}) {
  let created: ObjectRecord | undefined;
  let busy = false;
  let linked = false;
  return {
    text, source,
    name: text.trim().replace(/\s+/g, ' ').slice(0, 200),
    get created() { return created; },
    async save(name: string, append = false) {
      if (busy) throw new Error('正在保存任务');
      if (linked) return;
      busy = true;
      try {
        created ??= await port.create(selectionTodoDraft(text, source, name));
        await port.insert(created, append);
        linked = true;
      } finally { busy = false; }
    },
  };
}
export type SelectionTodoSession = ReturnType<typeof selectionTodoSession>;
