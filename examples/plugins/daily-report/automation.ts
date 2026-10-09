import type { PluginAutomationExecution, PluginObjectSnapshot, TanoAutomationApi } from '@tano/workbench/plugin-sdk';

const label = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[\\\[\]]/g, '\\$&');
export default async function run(tano: TanoAutomationApi, execution: PluginAutomationExecution) {
  if (execution.automationId !== 'daily') throw new Error('未知日报入口');
  const { settings } = await tano.context();
  const folder = typeof settings.folder === 'string' && settings.folder.trim() ? settings.folder.replace(/\/+$/, '') : '日报';
  const tasks: PluginObjectSnapshot[] = [];
  let cursor: string | undefined;
  do {
    const page = await tano.objects.query({ type: 'event', properties: { checkable: true }, sort: 'name', limit: 50, ...(cursor ? { cursor } : {}) });
    tasks.push(...page.items); cursor = page.nextCursor;
  } while (cursor && tasks.length < 200);
  const completed = tasks.filter(task => task.object.properties.completed === true);
  const pending = tasks.filter(task => task.object.properties.completed !== true);
  const documents = (await tano.documents.query({ sort: 'modified', direction: 'desc', limit: 20 })).items.filter(doc => !doc.path.startsWith(`${folder}/`));
  const lines = [`# 工作区日报 · ${execution.scheduledAt.slice(0, 10)}`, '', `生成时间：${execution.scheduledAt}（UTC）`, '',
    `已完成 ${completed.length} 项，未完成 ${pending.length} 项。`, ...(cursor ? ['任务较多，本次仅列出按名称排序的前 200 项。'] : []), '', '## 未完成任务', ''];
  for (const { object } of pending) lines.push(`- [ ] [@${label(object.name)}](object://event/${object.id})`);
  if (!pending.length) lines.push('暂无未完成任务。');
  lines.push('', '## 已完成任务', '');
  for (const { object } of completed) lines.push(`- [x] [@${label(object.name)}](object://event/${object.id})`);
  if (!completed.length) lines.push('暂无已完成任务。');
  lines.push('', '## 最近更新的文档', '');
  for (const doc of documents) lines.push(`- [@${label(doc.name)}](object://document/${doc.id})`);
  if (!documents.length) lines.push('暂无其他文档。');
  const created = await tano.documents.create(`${folder}/${execution.scheduledAt.slice(0, 10)}-${execution.runId}.md`, lines.join('\n') + '\n');
  return { ...created, tasks: tasks.length, truncated: !!cursor };
}
