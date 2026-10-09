import type { PluginPackage } from '@tano/protocol';

export const documentOverviewPlugin = {
  packageVersion: 1,
  manifest: {
    manifestVersion: 2, apiVersion: 1, id: 'document-overview', name: '文档总览', version: '1.0.0',
    description: '通过插件 SDK 查询工作区文档，在独立视图中查看和打开文档。',
    objectTypes: [], relationTypes: [], permissions: ['documents.read'], networkOrigins: [], nativeCommands: [],
    commands: [{ id: 'refresh', label: '刷新文档总览' }], views: [{ id: 'overview', label: '工作区文档' }],
  },
  source: `async function refresh() {
  const documents = await tano.documents.list();
  await tano.views.render('overview', { type: 'stack', children: [
    { type: 'heading', text: '工作区文档 · ' + documents.length },
    { type: 'button', label: '刷新', action: 'refresh' },
    ...documents.slice(0, 100).map(file => ({ type: 'button', label: file.path, action: 'open.' + file.id }))
  ] });
}
await tano.commands.register('refresh', refresh);
tano.views.onAction('overview', async ({ action }) => {
  if (action === 'refresh') await refresh();
  else if (action.startsWith('open.')) await tano.documents.open(action.slice(5));
});
await refresh();`,
} satisfies PluginPackage;
