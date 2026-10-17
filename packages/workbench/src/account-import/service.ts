import { prepareImport, importName, importLimits } from '../document-import';
import type { PreparedImport } from '../document-import';
import type { AccountImportService, ImportAccount, ImportAccountHost, ImportRequest, ImportResource } from './types';
import { thriftFields, thriftField, thriftResult } from './thrift';

type Data = Record<string, any>;
const enc = encodeURIComponent;
const text = (value: unknown) => String(value ?? '').replace(/\r/g, '');
const title = (value: unknown) => text(value).replace(/\n/g, ' ');
const rich = (values: Data[] = []) => values.map(value => value.plain_text ?? value.text?.content ?? '').join('');
const array = (value: unknown): Data[] => { if (!Array.isArray(value)) throw new Error('第三方服务返回的列表格式无效'); return value; };
const selected = (id: unknown, name: unknown): ImportResource => {
  if (typeof id !== 'string' || !id || id.length > 1000) throw new Error('第三方内容缺少有效标识');
  return { id, name: title(name) || '未命名' };
};
function adf(node: Data | undefined, depth = 0): string {
  if (!node || depth > 100) return '';
  if (node.type === 'text') return text(node.text);
  if (node.type === 'hardBreak') return '\n';
  const value = (node.content ?? []).map((child: Data) => adf(child, depth + 1)).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(node.type) ? `${value}\n` : value;
}

export function createAccountImportService(host: ImportAccountHost): AccountImportService {
  let requests = 0;
  async function response(account: ImportAccount, request: ImportRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    if (++requests > 10000) throw new Error('读取请求超过限制，请分批导入');
    const result = await host.request(account, request, signal);
    signal.throwIfAborted();
    if (result.status === 401 || result.status === 403) throw new Error('账号授权已失效或没有读取权限，请重新连接并检查授权范围');
    if (result.status === 429) throw new Error('第三方服务请求频率受限，请稍后重试');
    if (result.status < 200 || result.status >= 300) throw new Error(`读取第三方内容失败（HTTP ${result.status}）`);
    return result;
  }
  async function json(account: ImportAccount, path: string, signal: AbortSignal, body?: unknown): Promise<Data> {
    const result = await response(account, { path, ...(body !== undefined ? { method: 'POST' as const, body } : {}) }, signal);
    const data = JSON.parse(result.body);
    if (!data || typeof data !== 'object' || data.errors?.length) throw new Error('第三方服务未能完成读取，请检查账号权限');
    return data;
  }
  async function paginate(read: (cursor?: string) => Promise<{ items: Data[]; next?: string }>) {
    const items: Data[] = [], seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = await read(cursor);
      items.push(...result.items);
      if (items.length > 20000) throw new Error('第三方内容超过 20,000 条，请缩小导入范围');
      if (!result.next) return items;
      if (seen.has(result.next)) throw new Error('第三方分页重复，已停止读取');
      seen.add(result.next); cursor = result.next;
    }
    throw new Error('第三方内容超过 100 页，请缩小导入范围');
  }
  async function asana(account: ImportAccount, path: string, signal: AbortSignal) {
    return paginate(async cursor => {
      const result = await json(account, `${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&offset=${enc(cursor)}` : ''}`, signal);
      return { items: array(result.data), next: result.next_page?.offset };
    });
  }
  async function atlassian(account: ImportAccount, kind: 'jira' | 'confluence', signal: AbortSignal) {
    const sites = array(await json(account, '/oauth/token/accessible-resources', signal));
    const result: ImportResource[] = [];
    for (const site of sites) {
      const prefix = `/ex/${kind}/${enc(site.id)}`;
      if (kind === 'jira') {
        const projects = await paginate(async start => {
          const data = await json(account, `${prefix}/rest/api/3/project/search?maxResults=100&startAt=${start ?? '0'}`, signal);
          return { items: array(data.values), next: data.isLast === false ? String(Number(data.startAt) + Number(data.maxResults)) : undefined };
        });
        result.push(...projects.map(project => selected(`${site.id}:${project.id}`, `${site.name} / ${project.name}`)));
      } else {
        const spaces = await paginate(async cursor => {
          const data = await json(account, `${prefix}/wiki/api/v2/spaces?limit=100${cursor ? `&cursor=${enc(cursor)}` : ''}`, signal);
          return { items: array(data.results), next: data._links?.next ? new URL(data._links.next, 'https://api.atlassian.com').searchParams.get('cursor') ?? undefined : undefined };
        });
        result.push(...spaces.map(space => selected(`${site.id}:${space.id}`, `${site.name} / ${space.name}`)));
      }
    }
    return result;
  }
  async function monday(account: ImportAccount, query: string, signal: AbortSignal) {
    return (await json(account, '/v2', signal, { query: `query TanoImport ${query}`, operationName: 'TanoImport' })).data as Data;
  }
  async function edam(account: ImportAccount, rpc: NonNullable<ImportRequest['rpc']>, fields: Parameters<typeof thriftFields>[0], signal: AbortSignal) {
    const result = await response(account, { path: '', rpc, body: thriftFields(fields) }, signal);
    if (!result.binary) throw new Error('Evernote 响应缺少内容');
    return thriftResult(result.binary);
  }
  async function resources(account: ImportAccount, signal: AbortSignal): Promise<ImportResource[]> {
    switch (account.provider) {
      case 'notion': return (await paginate(async cursor => {
        const data = await json(account, '/v1/search', signal, { filter: { property: 'object', value: 'page' }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
        return { items: array(data.results), next: data.has_more ? data.next_cursor : undefined };
      })).map(page => selected(page.id, rich(Object.values(page.properties ?? {}).flatMap((property: any) => property.type === 'title' ? property.title : []))));
      case 'google-docs': return (await paginate(async cursor => {
        const data = await json(account, `/drive/v3/files?q=${enc("mimeType='application/vnd.google-apps.document' and trashed=false")}&fields=files(id,name),nextPageToken&pageSize=100${cursor ? `&pageToken=${enc(cursor)}` : ''}`, signal);
        return { items: array(data.files), next: data.nextPageToken };
      })).map(file => selected(file.id, file.name));
      case 'asana': {
        const projects: ImportResource[] = [];
        for (const workspace of await asana(account, '/api/1.0/workspaces', signal))
          projects.push(...(await asana(account, `/api/1.0/workspaces/${enc(workspace.gid)}/projects?archived=false`, signal)).map(project => selected(project.gid, `${workspace.name} / ${project.name}`)));
        return projects;
      }
      case 'confluence': return atlassian(account, 'confluence', signal);
      case 'jira': return atlassian(account, 'jira', signal);
      case 'trello': return array(await json(account, '/1/members/me/boards?fields=name&filter=open', signal)).map(board => selected(board.id, board.name));
      case 'monday': return (await paginate(async page => {
        const data = await monday(account, `{ boards(limit:100,page:${page ?? '1'}) { id name } }`, signal);
        const boards = array(data.boards);
        return { items: boards, next: boards.length === 100 ? String(Number(page ?? 1) + 1) : undefined };
      })).map(board => selected(board.id, board.name));
      case 'workflowy': return array((await json(account, '/api/v1/nodes', signal)).nodes).map(node => selected(node.id, node.name ?? node.text));
      case 'roam': {
        const data = await json(account, `/api/graph/${enc(account.context)}/q`, signal, { query: '[:find (count ?p) :where [?p :node/title]]' });
        array(data.result);
        return [selected(account.context, account.context)];
      }
      case 'quip': {
        const user = await json(account, '/1/users/current', signal);
        const folders = new Set<string>(), threads = new Map<string, ImportResource>();
        async function folder(id: string, depth = 0) {
          if (folders.has(id)) return;
          if (depth > 100 || folders.size >= 2000) throw new Error('Quip 文件夹层级或数量超过限制');
          folders.add(id);
          for (const item of array((await json(account, `/1/folders/${enc(id)}`, signal)).children)) {
            if (item.folder_id) await folder(item.folder_id, depth + 1);
            if (item.thread_id && !threads.has(item.thread_id)) {
              const thread = await json(account, `/1/threads/${enc(item.thread_id)}`, signal);
              threads.set(item.thread_id, selected(item.thread_id, thread.thread?.title));
              if (threads.size > 2000) throw new Error('Quip 文档超过 2,000 个，请分批导入');
            }
          }
        }
        if (user.desktop_folder_id) await folder(user.desktop_folder_id);
        return [...threads.values()];
      }
      case 'evernote': return array(await edam(account, 'listNotebooks', [], signal)).map(notebook => selected(thriftField(notebook, 1), thriftField(notebook, 2)));
      case 'obsidian': throw new Error('Obsidian 没有公开的账号内容读取 API，请导入本地仓库或导出文件');
    }
  }
  async function prepare(account: ImportAccount, chosen: ImportResource[], signal: AbortSignal, progress: (name: string) => void): Promise<PreparedImport> {
    if (!chosen.length || chosen.length > importLimits.entries) throw new Error('请选择 1–2,000 项内容');
    const files: File[] = []; let outputBytes = 0;
    function add(name: string, content: string, ext = 'md') {
      const bytes = new TextEncoder().encode(content);
      outputBytes += bytes.byteLength;
      if (bytes.byteLength > importLimits.fileBytes || outputBytes > importLimits.totalBytes || files.length >= importLimits.entries) throw new Error('所选内容超过导入限制，请分批导入');
      files.push(new File([content], `${files.length + 1}-${importName(name)}.${ext}`));
    }
    let blockCount = 0;
    async function notionBlocks(id: string, depth = 0): Promise<string> {
      if (depth > 100) throw new Error('Notion 页面层级超过限制');
      const blocks = await paginate(async cursor => {
        const data = await json(account, `/v1/blocks/${enc(id)}/children?page_size=100${cursor ? `&start_cursor=${enc(cursor)}` : ''}`, signal);
        return { items: array(data.results), next: data.has_more ? data.next_cursor : undefined };
      });
      const lines: string[] = [];
      for (const block of blocks) {
        if (++blockCount > 20000) throw new Error('Notion 内容超过 20,000 个块，请分批导入');
        const data = block[block.type] ?? {}, value = rich(data.rich_text);
        lines.push(block.type.startsWith('heading_') ? `${'#'.repeat(Number(block.type.at(-1)))} ${value}`
          : block.type === 'to_do' ? `- [${data.checked ? 'x' : ' '}] ${value}`
          : block.type === 'bulleted_list_item' ? `- ${value}` : block.type === 'numbered_list_item' ? `1. ${value}`
          : block.type === 'code' ? `\`\`\`${data.language ?? ''}\n${value}\n\`\`\``
          : block.type === 'equation' ? `$$\n${data.expression}\n$$`
          : block.type === 'divider' ? '---'
          : block.type === 'image' || block.type === 'file' ? `${block.type === 'image' ? '!' : ''}[${rich(data.caption) || '附件'}](${data.external?.url ?? data.file?.url ?? ''})`
          : block.type === 'table_row' ? `| ${(data.cells ?? []).map((values: Data[]) => rich(values).replace(/\|/g, '\\|')).join(' | ')} |`
          : value || (block.type === 'child_page' ? `子页面：${data.title}` : `[${block.type}]`));
        if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') lines.push(await notionBlocks(block.id, depth + 1));
      }
      return lines.join('\n\n');
    }
    for (const resource of chosen) {
      signal.throwIfAborted(); progress(resource.name);
      const heading = `# ${title(resource.name)}\n\n`;
      switch (account.provider) {
        case 'notion': add(resource.name, heading + await notionBlocks(resource.id)); break;
        case 'google-docs': add(resource.name, (await response(account, { path: `/drive/v3/files/${enc(resource.id)}/export?mimeType=text%2Fhtml` }, signal)).body, 'html'); break;
        case 'trello': add(resource.name, (await response(account, { path: `/1/boards/${enc(resource.id)}?lists=all&list_fields=name&cards=all&card_fields=name,desc,idList,closed,due&checklists=all` }, signal)).body, 'json'); break;
        case 'asana': {
          const tasks = await asana(account, `/api/1.0/projects/${enc(resource.id)}/tasks?opt_fields=name,notes,completed,due_on,assignee.name`, signal);
          add(resource.name, heading + tasks.map(task => `## ${title(task.name)}\n\n- [${task.completed ? 'x' : ' '}] ${title(task.name)}\n${task.due_on ? `截止日期：${task.due_on}\n` : ''}${task.assignee?.name ? `负责人：${title(task.assignee.name)}\n` : ''}\n${text(task.notes)}\n`).join('\n')); break;
        }
        case 'jira': {
          const [site, project] = resource.id.split(':');
          if (!/^\d+$/.test(project ?? '')) throw new Error('Jira 项目标识无效');
          const issues = await paginate(async cursor => {
            const data = await json(account, `/ex/jira/${enc(site)}/rest/api/3/search/jql`, signal, { jql: `project = ${project}`, maxResults: 100, fields: ['summary', 'description', 'status', 'assignee', 'duedate'], ...(cursor ? { nextPageToken: cursor } : {}) });
            return { items: array(data.issues), next: data.isLast === false ? data.nextPageToken : undefined };
          });
          add(resource.name, heading + issues.map(issue => `## ${title(issue.key)} ${title(issue.fields?.summary)}\n\n状态：${title(issue.fields?.status?.name)}\n\n${adf(issue.fields?.description)}`).join('\n')); break;
        }
        case 'confluence': {
          const [site, space] = resource.id.split(':');
          const pages = await paginate(async cursor => {
            const data = await json(account, `/ex/confluence/${enc(site)}/wiki/api/v2/spaces/${enc(space)}/pages?limit=100&body-format=storage${cursor ? `&cursor=${enc(cursor)}` : ''}`, signal);
            return { items: array(data.results), next: data._links?.next ? new URL(data._links.next, 'https://api.atlassian.com').searchParams.get('cursor') ?? undefined : undefined };
          });
          for (const page of pages) add(`${resource.name}-${page.title}`, `<h1>${escapeHtml(title(page.title))}</h1>${page.body?.storage?.value ?? ''}`, 'html');
          break;
        }
        case 'monday': {
          if (!/^\d+$/.test(resource.id)) throw new Error('Monday 看板标识无效');
          const board = array((await monday(account, `{ boards(ids:[${resource.id}]) { name items_page(limit:100) { cursor items { id name group { title } column_values { id text } } } } }`, signal)).boards)[0];
          let batch = board?.items_page, lines = heading, cursor: string | undefined; const seen = new Set<string>();
          for (let page = 0; ; page++) {
            for (const item of array(batch?.items)) lines += `## ${title(item.name)}\n\n${item.group?.title ? `分组：${title(item.group.title)}\n` : ''}${array(item.column_values).map(column => `- ${title(column.id)}：${text(column.text)}`).join('\n')}\n\n`;
            cursor = batch.cursor;
            if (!cursor) break;
            if (page >= 99 || seen.has(cursor)) throw new Error('Monday 分页超过限制或重复，请缩小导入范围');
            seen.add(cursor);
            batch = (await monday(account, `{ next_items_page(limit:100,cursor:${JSON.stringify(cursor)}) { cursor items { id name group { title } column_values { id text } } } }`, signal)).next_items_page;
          }
          add(resource.name, lines); break;
        }
        case 'workflowy': {
          let count = 0;
          async function outline(id: string, depth: number): Promise<string> {
            if (depth > 100 || ++count > 20000) throw new Error('Workflowy 层级或条目数量超过限制');
            const node = (await json(account, `/api/v1/nodes/${enc(id)}`, signal)).node;
            if (!node) throw new Error('Workflowy 节点不可读取');
            const children = array((await json(account, `/api/v1/nodes?parent_id=${enc(id)}`, signal)).nodes);
            let result = `${'  '.repeat(depth)}- ${node.completed ? '[x] ' : ''}${title(node.name ?? node.text)}\n`;
            if (node.note) result += `${'  '.repeat(depth + 1)}${text(node.note).replace(/\n/g, `\n${'  '.repeat(depth + 1)}`)}\n`;
            for (const child of children) result += await outline(child.id, depth + 1);
            return result;
          }
          add(resource.name, heading + await outline(resource.id, 0)); break;
        }
        case 'roam': {
          const data = await json(account, `/api/graph/${enc(account.context)}/q`, signal, { query: '[:find (pull ?p [:node/title :block/string :block/order {:block/children ...}]) :where [?p :node/title]]' });
          let count = 0;
          function blocks(nodes: Data[], depth = 0): string {
            if (depth > 100) throw new Error('Roam 页面层级超过限制');
            return [...nodes].sort((left, right) => Number(left['block/order'] ?? 0) - Number(right['block/order'] ?? 0)).map(node => {
              if (++count > 20000) throw new Error('Roam 内容超过 20,000 个块');
              return `${'  '.repeat(depth)}- ${text(node['block/string']).replace(/\n/g, `\n${'  '.repeat(depth + 1)}`)}\n${blocks(node['block/children'] ?? [], depth + 1)}`;
            }).join('');
          }
          for (const row of array(data.result)) { const page = Array.isArray(row) ? row[0] : row; add(page['node/title'], `# ${title(page['node/title'])}\n\n${blocks(page['block/children'] ?? [])}`); }
          break;
        }
        case 'quip': {
          const thread = await json(account, `/1/threads/${enc(resource.id)}`, signal);
          add(thread.thread?.title ?? resource.name, text(thread.html), 'html'); break;
        }
        case 'evernote': {
          let offset = 0;
          for (let page = 0; page < 100; page++) {
            const result = await edam(account, 'findNotesMetadata', [
              { id: 2, type: 12, value: [{ id: 4, type: 11, value: resource.id }] }, { id: 3, type: 8, value: offset }, { id: 4, type: 8, value: 100 },
              { id: 5, type: 12, value: [{ id: 2, type: 2, value: true }] },
            ], signal);
            const notes = array(thriftField(result, 3));
            for (const metadata of notes) {
              const note = await edam(account, 'getNote', [{ id: 2, type: 11, value: thriftField(metadata, 1) }, { id: 3, type: 2, value: true }, { id: 4, type: 2, value: false }, { id: 5, type: 2, value: false }, { id: 6, type: 2, value: false }], signal);
              add(`${resource.name}-${thriftField(note, 2)}`, text(thriftField(note, 3)).replace(/<en-todo checked="true"\s*\/?\s*>/g, '[x] ').replace(/<en-todo[^>]*>/g, '[ ] '), 'html');
            }
            offset += notes.length;
            if (offset >= Number(thriftField(result, 2))) break;
            if (!notes.length || page === 99) throw new Error('Evernote 分页未完整读取，请缩小导入范围');
          }
          break;
        }
        case 'obsidian': throw new Error('请使用 Obsidian 本地仓库导入');
      }
    }
    signal.throwIfAborted();
    const prepared = await prepareImport(files, progress);
    prepared.issues.push({ name: account.label, message: '账号导入读取当前可访问的正文与列表；评论、历史版本、附件原文件及第三方特有布局不会一并迁移，外部附件链接可能过期' });
    return prepared;
  }
  return { host, resources, prepare };
}
function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
