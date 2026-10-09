import type { PluginViewNode, TanoPluginApi } from '@tano/workbench/plugin-sdk';

export default async function activate(tano: TanoPluginApi) {
  let repository = '', number = '', status = '先在插件中心为 api.github.com 配置服务连接，允许 GET 和 /repos/ 路径。';
  let preview: { title: string; content: string; path: string } | undefined;
  let busy = false;
  async function render() {
    const children: PluginViewNode[] = [
      { type: 'heading', text: 'GitHub 议题导入' },
      { type: 'text', text: status },
      { type: 'input', key: 'repository', label: '仓库（owner/repository）', value: repository },
      { type: 'input', key: 'number', label: '议题编号', value: number },
    ];
    if (!busy) children.push({ type: 'button', label: '读取并预览', action: 'preview' });
    if (preview) {
      children.push({ type: 'heading', text: preview.title }, { type: 'text', text: `将创建：${preview.path}` },
        { type: 'code', text: preview.content.slice(0, 5000) + (preview.content.length > 5000 ? '\n…预览已截断，保存时保留完整正文。' : '') });
      if (!busy) children.push({ type: 'button', label: '确认创建 Markdown', action: 'import' });
    }
    await tano.views.render('import', { type: 'stack', children });
  }
  tano.views.onAction('import', async ({ action, values }) => {
    if (busy) return;
    busy = true;
    try {
      if (action === 'preview') {
        preview = undefined;
        repository = (values.repository ?? '').trim(); number = (values.number ?? '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(repository) || !/^[1-9][0-9]{0,8}$/.test(number)) throw new Error('请输入有效仓库名称和正整数议题编号');
        status = '正在读取议题…'; await render();
        const response = await tano.connections.request('https://api.github.com', { path: `/repos/${repository}/issues/${number}` });
        if (response.status !== 200) throw new Error(`GitHub 返回 HTTP ${response.status}，请检查连接权限、仓库和议题编号`);
        const issue = JSON.parse(response.body) as { title?: unknown; body?: unknown; number?: unknown; html_url?: unknown; pull_request?: unknown };
        if (issue.number !== Number(number) || typeof issue.title !== 'string' || issue.title.length > 1000 || issue.body !== null && typeof issue.body !== 'string' || typeof issue.body === 'string' && issue.body.length > 100000) throw new Error('议题内容无效或超过导入限制');
        const title = issue.title.replace(/[\r\n]/g, ' ');
        const url = `https://github.com/${repository}/issues/${number}`;
        preview = { title, path: `GitHub-${repository.replace('/', '-')}-${number}.md`, content: `# ${title}\n\n来源：${url}\n\n${issue.body ?? ''}\n` };
        status = '请核对预览，再确认创建文档。已有同名文档会保留。';
      } else if (action === 'import' && preview) {
        status = '正在创建文档…'; await render();
        const document = await tano.documents.create(preview.path, preview.content);
        status = `已创建 ${document.path}`; preview = undefined;
        await tano.documents.open(document.id);
      } else throw new Error('请先读取并预览议题');
    } catch (error) { status = String(error); }
    finally { busy = false; await render(); }
  });
  await tano.commands.register('open', () => tano.views.open('import'));
  await render();
}
