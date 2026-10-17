// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest';
import { createAccountImportService } from './service';
import { thriftFields, thriftField, thriftResult } from './thrift';
import type { ImportAccount, ImportAccountHost, ImportProviderId, ImportRequest, ImportResponse } from './types';

beforeAll(() => {
  Object.defineProperty(File.prototype, 'arrayBuffer', { configurable: true, value() {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(this); });
  } });
});
const account = (provider: ImportProviderId): ImportAccount => ({ id: 'account', provider, label: 'Fixture', context: 'graph' });
function setup(read: (request: ImportRequest) => unknown) {
  const request = vi.fn(async (_account: ImportAccount, input: ImportRequest): Promise<ImportResponse> => ({ status: 200, body: JSON.stringify(read(input)) }));
  const host: ImportAccountHost = { request, capabilities: vi.fn(), accounts: vi.fn(), connect: vi.fn(), cancel: vi.fn(), disconnect: vi.fn() };
  return { service: createAccountImportService(host), request, host };
}
const signal = () => new AbortController().signal;

it('lists paginated Notion pages, reads nested blocks, and prepares Markdown without writing', async () => {
  const { service, request } = setup(input => {
    if (input.path === '/v1/search') return { results: [{ id: (input.body as any).start_cursor ? 'two' : 'one', properties: { title: { type: 'title', title: [{ plain_text: 'Page' }] } } }], has_more: !(input.body as any).start_cursor, next_cursor: 'next' };
    return { results: input.path.includes('/one/') ? [{ id: 'child', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Heading' }] }, has_children: true }] : [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Nested body' } }] } }], has_more: false };
  });
  const sources = await service.resources(account('notion'), signal());
  expect(sources.map(source => source.id)).toEqual(['one', 'two']);
  const result = await service.prepare(account('notion'), sources.slice(0, 1), signal(), vi.fn());
  expect(result.pages[0].content).toContain('## Heading');
  expect(result.pages[0].content).toContain('Nested body');
  expect(result.issues[0].message).toContain('附件');
  expect(request).toHaveBeenCalledTimes(4);
});

it.each([
  ['google-docs', [{ files: [{ id: 'doc', name: 'Document' }] }], '<h1>Google title</h1><p>Google body</p>', 'Google body'],
  ['asana', [{ data: [{ gid: 'ws', name: 'Workspace' }] }, { data: [{ gid: 'project', name: 'Project' }] }, { data: [{ name: 'Task', notes: 'Asana body', completed: true }] }], undefined, 'Asana body'],
  ['trello', [[{ id: 'board', name: 'Board' }]], JSON.stringify({ name: 'Board', lists: [{ id: 'list', name: 'Doing' }], cards: [{ name: 'Card', desc: 'Trello body', idList: 'list' }], checklists: [] }), 'Trello body'],
  ['jira', [[{ id: 'site', name: 'Site' }], { values: [{ id: '100', name: 'Project' }], isLast: true }, { issues: [{ key: 'T-1', fields: { summary: 'Issue', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Jira body' }] }] } } }], isLast: true }], undefined, 'Jira body'],
  ['confluence', [[{ id: 'site', name: 'Site' }], { results: [{ id: 'space', name: 'Space' }] }, { results: [{ title: 'Page', body: { storage: { value: '<p>Confluence body</p>' } } }] }], undefined, 'Confluence body'],
  ['monday', [{ data: { boards: [{ id: '123', name: 'Board' }] } }, { data: { boards: [{ items_page: { items: [{ name: 'Item', column_values: [{ id: 'text', text: 'Monday body' }] }], cursor: 'cursor' } }] } }, { data: { next_items_page: { items: [{ name: 'Next', column_values: [] }], cursor: null } } }], undefined, 'Monday body'],
  ['workflowy', [{ nodes: [{ id: 'root', name: 'Outline' }] }, { node: { name: 'Root', note: 'Workflowy body' } }, { nodes: [{ id: 'child' }] }, { node: { name: 'Child', completed: true } }, { nodes: [] }], undefined, 'Workflowy body'],
  ['roam', [{ result: [[1]] }, { result: [[{ 'node/title': 'Page', 'block/children': [{ 'block/string': 'Roam body' }] }]] }], undefined, 'Roam body'],
  ['quip', [{ desktop_folder_id: 'folder' }, { children: [{ folder_id: 'nested' }, { thread_id: 'thread' }] }, { children: [{ folder_id: 'folder' }, { thread_id: 'thread' }] }, { thread: { title: 'Document' } }, { thread: { title: 'Document' }, html: '<p>Quip body</p>' }], undefined, 'Quip body'],
] as const)('converts %s account content through the real import parser', async (provider, responses, html, expected) => {
  let index = 0;
  const { service, host } = setup(() => {
    if (index >= responses.length) throw new Error('Unexpected API request');
    return responses[index++];
  });
  const base = host.request;
  if (html) host.request = async (acct, input, abort) => input.path.includes('/export?') || input.path.startsWith('/1/boards/') ? { status: 200, body: html } : base(acct, input, abort);
  const sources = await service.resources(account(provider), signal());
  expect(sources).toHaveLength(1);
  const result = await service.prepare(account(provider), sources, signal(), vi.fn());
  expect(result.pages.map(page => page.content).join('\n')).toContain(expected);
  expect(index).toBe(responses.length);
});

it('stops repeated pagination and handles authorization, rate limits, invalid JSON and aborts', async () => {
  const repeated = setup(() => ({ files: [], nextPageToken: 'same' }));
  await expect(repeated.service.resources(account('google-docs'), signal())).rejects.toThrow('分页重复');
  expect(repeated.request).toHaveBeenCalledTimes(2);
  for (const [status, expected] of [[401, '授权'], [403, '授权'], [429, '频率'], [500, 'HTTP 500']] as const) {
    const { host, service } = setup(() => null);
    host.request = async () => ({ status, body: '' });
    await expect(service.resources(account('google-docs'), signal())).rejects.toThrow(expected);
  }
  const { host, service, request } = setup(() => null);
  host.request = async () => ({ status: 200, body: 'not JSON' });
  await expect(service.resources(account('google-docs'), signal())).rejects.toThrow();
  const abort = new AbortController(); abort.abort();
  await expect(service.resources(account('notion'), abort.signal)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await expect(service.prepare(account('notion'), [], signal(), vi.fn())).rejects.toThrow('请选择');
  await expect(service.resources(account('obsidian'), signal())).rejects.toThrow('没有公开');
});

// Encode independently using the published EDAM field IDs, including list/struct results.
function reply(type: number, value: number[]): string {
  return btoa(String.fromCharCode(128, 1, 0, 2, 0, 0, 0, 1, 120, 0, 0, 0, 0, type, 0, 0, ...value, 0));
}
const binary = (value: string) => Array.from(atob(value), char => char.charCodeAt(0));
it('reads Evernote EDAM notebooks, metadata and note content with the correct filter fields', async () => {
  const notebook = binary(thriftFields([{ id: 1, type: 11, value: 'book' }, { id: 2, type: 11, value: 'Notebook' }]));
  const metadata = binary(thriftFields([{ id: 1, type: 11, value: 'note' }]));
  const note = binary(thriftFields([{ id: 2, type: 11, value: 'Title' }, { id: 3, type: 11, value: '<en-note><div>Evernote body</div></en-note>' }]));
  const metadataResult = binary(thriftFields([{ id: 2, type: 8, value: 1 }])).slice(0, -1).concat([15, 0, 3, 12, 0, 0, 0, 1], metadata, [0]);
  const { host, service } = setup(() => null);
  host.request = vi.fn(async (_account, input) => {
    if (input.rpc === 'listNotebooks') return { status: 200, body: '', binary: reply(15, [12, 0, 0, 0, 1, ...notebook]) };
    if (input.rpc === 'findNotesMetadata') {
      const decoded = thriftResult(reply(12, binary(input.body as string)));
      expect(thriftField(thriftField(decoded, 2), 4)).toBe('book');
      expect(thriftField(thriftField(decoded, 5), 2)).toBe(1);
      return { status: 200, body: '', binary: reply(12, metadataResult) };
    }
    expect(input.rpc).toBe('getNote');
    return { status: 200, body: '', binary: reply(12, note) };
  });
  const sources = await service.resources(account('evernote'), signal());
  expect(sources).toEqual([{ id: 'book', name: 'Notebook' }]);
  const result = await service.prepare(account('evernote'), sources, signal(), vi.fn());
  expect(result.pages[0].content).toContain('Evernote body');
});

it('rejects truncated, invalid-version and exception Thrift replies', () => {
  expect(() => thriftResult(btoa('short'))).toThrow();
  expect(() => thriftResult(btoa(String.fromCharCode(0, 0, 0, 2)))).toThrow('版本');
  expect(() => thriftResult(reply(12, [0]))).not.toThrow();
  const exception = binary(reply(12, [0])); exception[3] = 3;
  expect(() => thriftResult(btoa(String.fromCharCode(...exception)))).toThrow('请求失败');
});
