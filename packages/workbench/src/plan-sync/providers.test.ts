// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { remoteAdapter, readMissingTodoist } from './providers';
import type { Response, Transport } from './providers';
import type { Account, ItemValue } from './types';
const result = (body: unknown, status = 200, url = 'https://example.test/cal/') => ({ status, body: typeof body === 'string' ? body : JSON.stringify(body), etag: '"v1"', url });
const account = (provider: Account['provider']): Account => ({ id: 'a', provider, label: 'test', server: 'https://example.test/' });
const value: ItemValue = { name: '事项', description: '说明', start: '2026-09-30T03:00:00.000Z', end: '2026-09-30T04:00:00.000Z', archived: false };
describe('calendar and todo service adapters', () => {
  it('paginates Google lists and uses If-Match without dropping remote fields', async () => {
    const transport = vi.fn<Transport>().mockResolvedValueOnce(result({ items: [{ id: 'first', summary: 'A', accessRole: 'reader' }], nextPageToken: 'next' })).mockResolvedValueOnce(result({ items: [{ id: 'second', summary: 'B', accessRole: 'owner' }] }));
    const adapter = remoteAdapter(account('google'), 'calendar', transport);
    expect(await adapter.collections()).toEqual([{ id: 'first', name: 'A', writable: false }, { id: 'second', name: 'B', writable: true }]);
    transport.mockResolvedValueOnce(result({ id: 'event', etag: '"new"', summary: value.name, start: { dateTime: value.start }, end: { dateTime: value.end } }));
    await adapter.write('second', { id: 'event', version: '"base"', value }, { ...value, name: '只改标题' });
    expect(transport).toHaveBeenLastCalledWith('calendars/second/events/event?sendUpdates=none', 'PATCH', expect.any(String), expect.objectContaining({ 'If-Match': '"base"' }));
    expect(JSON.parse(transport.mock.calls.at(-1)![2]!)).toEqual({ summary: '只改标题' });
    transport.mockResolvedValueOnce(result('', 412));
    await expect(adapter.write('second', { id: 'event', version: '"old"', value }, { ...value, name: '只改标题' })).rejects.toThrow('未覆盖');
  });
  it('does not mistake rate limits or partial pagination for an empty calendar', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(result('', 429));
    await expect(remoteAdapter(account('google'), 'calendar', transport).list('c')).rejects.toThrow('频繁');
  });
  it('discovers CalDAV principal/home and requires VTODO support for task collections', async () => {
    const multi = (props: string, href = '/user/') => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
    const responses: Response[] = [result(multi('<d:current-user-principal><d:href>/user/</d:href></d:current-user-principal>')), result(multi('<c:calendar-home-set><d:href>/home/</d:href></c:calendar-home-set>')), result(multi('<d:resourcetype><c:calendar/></d:resourcetype><d:displayname>任务</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>', '/home/tasks/'))];
    const transport = vi.fn<Transport>().mockImplementation(async () => responses.shift()!);
    const found = await remoteAdapter(account('caldav'), 'todo', transport).collections();
    expect(found[0]).toMatchObject({ name: '任务', id: 'https://example.test/home/tasks/' });
    expect(transport.mock.calls[1]![0]).toBe('https://example.test/user/');
  });
  it('reads completed linked Todoist tasks separately from the active list', async () => {
    const transport = vi.fn<Transport>().mockResolvedValueOnce(result({ id: 'done', content: '已完成', checked: true, due: { date: '2026-10-01' } })).mockResolvedValueOnce(result('', 404));
    expect(await readMissingTodoist(account('todoist'), ['done', 'missing'], transport)).toEqual([expect.objectContaining({ value: expect.objectContaining({ completed: true, date: '2026-10-01' }) })]);
  });
  it('completes Todoist tasks without rewriting their content or timed due date', async () => {
    const task = { id: 'task', content: '保留原文', checked: false, due: { date: '2026-10-01T12:00:00', timezone: 'Asia/Shanghai' } };
    const transport = vi.fn<Transport>().mockResolvedValueOnce(result({ results: [task] })).mockResolvedValueOnce(result(task)).mockResolvedValueOnce(result('', 204)).mockResolvedValueOnce(result({ ...task, checked: true }));
    const adapter = remoteAdapter(account('todoist'), 'todo', transport);
    const item = (await adapter.list('project'))[0]!;
    const updated = await adapter.write('project', item, { ...item.value, completed: true });
    expect(updated.value.completed).toBe(true);
    expect(transport.mock.calls.filter(call => call[1] === 'POST').map(call => call[0])).toEqual(['tasks/task/close']);
  });
  it('clears Todoist dates with an acknowledged Sync command', async () => {
    const task = { id: 'task', content: '清除日期', checked: false, due: { date: '2026-10-01' } };
    const transport = vi.fn<Transport>().mockResolvedValueOnce(result({ results: [task] })).mockResolvedValueOnce(result(task)).mockImplementationOnce(async (path, method, body) => {
      const command = JSON.parse(body!).commands[0];
      expect([path, method, command.type, command.args]).toEqual(['sync', 'POST', 'item_update', { id: 'task', due: null }]);
      return result({ sync_status: { [command.uuid]: 'ok' } });
    }).mockResolvedValueOnce(result({ ...task, due: null }));
    const adapter = remoteAdapter(account('todoist'), 'todo', transport);
    const item = (await adapter.list('project'))[0]!;
    expect((await adapter.write('project', item, { ...item.value, date: undefined })).value.date).toBeUndefined();
  });
  it('preserves Microsoft HTML notes and in-progress status when changing only the title', async () => {
    const task = { id: 'task', title: '原标题', body: { content: '<b>说明</b>', contentType: 'html' }, status: 'inProgress', lastModifiedDateTime: 'version' };
    const transport = vi.fn<Transport>().mockResolvedValueOnce(result({ value: [task] })).mockResolvedValueOnce(result(task)).mockResolvedValueOnce(result({ ...task, title: '新标题' }));
    const adapter = remoteAdapter(account('microsoft'), 'todo', transport);
    const item = (await adapter.list('list'))[0]!;
    await adapter.write('list', item, { ...item.value, name: '新标题' });
    expect(JSON.parse(transport.mock.calls.at(-1)![2]!)).toEqual({ title: '新标题' });
  });
  it('detects Microsoft concurrent changes before writing and follows opaque next links', async () => {
    const transport = vi.fn<Transport>().mockResolvedValueOnce(result({ value: [{ id: 'l1', displayName: 'A' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/todo/lists?next=opaque' })).mockResolvedValueOnce(result({ value: [{ id: 'l2', displayName: 'B' }] }));
    const adapter = remoteAdapter(account('microsoft'), 'todo', transport);
    expect(await adapter.collections()).toHaveLength(2);
    transport.mockResolvedValueOnce(result({ id: 'task', title: 'changed', lastModifiedDateTime: 'new' }));
    await expect(adapter.write('l1', { id: 'task', version: 'old', value }, value)).rejects.toThrow('未覆盖');
    expect(transport).toHaveBeenCalledTimes(3);
  });
});
