import { invoke } from '@tauri-apps/api/core';
import { parseCalendar, writeCalendar } from './ical';
import type { Account, Collection, ItemValue, RemoteAdapter, RemoteItem, SyncKind } from './types';
export interface Response { status: number; body: string; etag: string; url: string }
export type Transport = (path: string, method?: string, body?: string, headers?: Record<string, string>) => Promise<Response>;
export function nativeTransport(account: Account): Transport {
  return (path, method = 'GET', body, headers = {}) => invoke('plan_remote_request', { accountId: account.id, path, method, body: body ?? null, headers });
}
function check(response: Response) {
  if (response.status === 401 || response.status === 403) throw new Error('授权失效或没有权限，请重新连接并核对日历权限');
  if (response.status === 409 || response.status === 412) throw new Error('远端事项已变化，本次未覆盖，请重新同步');
  if (response.status === 429) throw new Error('服务请求过于频繁，请稍后重试');
  if (response.status < 200 || response.status >= 300) throw new Error(`同步请求未完成（HTTP ${response.status}）`);
  return response;
}
const encode = encodeURIComponent;
type Json = Record<string, any>;
async function json(transport: Transport, path: string, method = 'GET', body?: unknown, headers = {}): Promise<Json> {
  const response = check(await transport(path, method, body === undefined ? undefined : JSON.stringify(body), { 'Content-Type': 'application/json', ...headers }));
  return response.body ? JSON.parse(response.body) : {};
}
async function pages(transport: Transport, start: string, key: string, next: (data: Json) => string | undefined) {
  const result: Json[] = [], seen = new Set<string>();
  for (let path: string | undefined = start; path; ) {
    if (seen.has(path) || seen.size >= 100) throw new Error('分页未完整读取，本次同步已停止');
    seen.add(path);
    const data = await json(transport, path);
    if (!Array.isArray(data[key])) throw new Error('服务返回的清单格式无效');
    result.push(...data[key]); path = next(data);
  }
  return result;
}
const dateStart = (date: string) => new Date(`${date}T00:00:00`).toISOString();
const localDate = (date: string) => new Date(date).toLocaleDateString('sv-SE');
function googleItem(data: Json): RemoteItem {
  const date = data.start?.date;
  return { id: data.id, version: data.etag ?? '', raw: JSON.stringify(data), readOnly: !!data.recurringEventId || !!data.recurrence || (data.eventType && data.eventType !== 'default'), value: {
    name: data.summary || '未命名事件', description: data.description || '', archived: data.status === 'cancelled',
    ...(date ? { start: dateStart(date), end: dateStart(data.end?.date || date), allDay: true } : data.start?.dateTime ? { start: new Date(data.start.dateTime).toISOString(), end: new Date(data.end.dateTime).toISOString() } : {}),
  } };
}
function googleBody(value: ItemValue) {
  if (!value.start || !value.end) throw new Error('Google 日历事件需要开始和结束时间');
  return { summary: value.name, description: value.description, status: value.archived ? 'cancelled' : 'confirmed',
    start: value.allDay ? { date: localDate(value.start) } : { dateTime: value.start }, end: value.allDay ? { date: localDate(value.end) } : { dateTime: value.end } };
}
function google(transport: Transport): RemoteAdapter {
  return {
    async collections() { return (await pages(transport, 'users/me/calendarList?maxResults=250', 'items', d => d.nextPageToken ? `users/me/calendarList?maxResults=250&pageToken=${encode(d.nextPageToken)}` : undefined)).map(d => ({ id: d.id, name: d.summaryOverride || d.summary, writable: ['owner', 'writer'].includes(d.accessRole) })); },
    async list(collection) {
      const now = new Date(), from = new Date(now.getFullYear() - 1, now.getMonth(), 1), until = new Date(now.getFullYear() + 2, now.getMonth(), 1);
      const path = `calendars/${encode(collection)}/events?singleEvents=true&showDeleted=true&maxResults=2500&timeMin=${encode(from.toISOString())}&timeMax=${encode(until.toISOString())}`;
      return (await pages(transport, path, 'items', d => d.nextPageToken ? `${path}&pageToken=${encode(d.nextPageToken)}` : undefined)).map(googleItem);
    },
    async write(collection, item, value) {
      if (!item.version) throw new Error('远端缺少版本号，无法安全写入');
      const patch: Json = {};
      if (value.name !== item.value.name) patch.summary = value.name;
      if (value.description !== item.value.description) patch.description = value.description;
      if (value.archived !== item.value.archived) patch.status = value.archived ? 'cancelled' : 'confirmed';
      if (value.start !== item.value.start || value.end !== item.value.end || !!value.allDay !== !!item.value.allDay) {
        const schedule = googleBody(value);
        patch.start = schedule.start; patch.end = schedule.end;
      }
      if (!Object.keys(patch).length) return item;
      return googleItem(await json(transport, `calendars/${encode(collection)}/events/${encode(item.id)}?sendUpdates=none`, 'PATCH', patch, { 'If-Match': item.version }));
    },
    async create(collection, value, operationId) {
      const id = operationId.replaceAll('-', '');
      const existing = await transport(`calendars/${encode(collection)}/events/${id}`);
      if (existing.status === 200) return googleItem(JSON.parse(existing.body));
      if (existing.status !== 404) check(existing);
      return googleItem(await json(transport, `calendars/${encode(collection)}/events?sendUpdates=none`, 'POST', { ...googleBody(value), id }));
    },
  };
}
function xml(text: string) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || /<!DOCTYPE/i.test(text)) throw new Error('CalDAV 返回了无效的 XML');
  return doc;
}
const elements = (node: Document | Element, ns: string, local: string) => Array.from(node.getElementsByTagNameNS(ns, local));
const textOf = (node: Document | Element, ns: string, local: string) => elements(node, ns, local)[0]?.textContent || '';
const DAV = 'DAV:', CAL = 'urn:ietf:params:xml:ns:caldav';
const propfind = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/><c:calendar-home-set/><d:displayname/><d:resourcetype/><d:current-user-privilege-set/><c:supported-calendar-component-set/></d:prop></d:propfind>';
function caldav(account: Account, kind: SyncKind, transport: Transport): RemoteAdapter {
  const componentType = kind === 'calendar' ? 'VEVENT' : 'VTODO';
  async function props(path: string, depth = '0') { const response = check(await transport(path, 'PROPFIND', propfind, { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' })); return { doc: xml(response.body), url: response.url }; }
  const resource = (href: string, base: string) => new URL(href, base).href;
  async function read(path: string, wanted?: string) {
    const response = check(await transport(path));
    const parsed = parseCalendar(response.body, kind);
    if (parsed.warnings.length && !parsed.items.length) throw new Error(parsed.warnings.join('；'));
    const item = parsed.items.find(i => !wanted || i.id === wanted);
    if (!item) throw new Error('远端事项不可读取');
    return { ...item, id: path, version: response.etag, raw: response.body };
  }
  return {
    async collections() {
      let root = await props(account.server);
      let home = elements(root.doc, CAL, 'calendar-home-set')[0];
      if (!home) {
        const principal = elements(root.doc, DAV, 'current-user-principal')[0];
        if (principal) root = await props(resource(textOf(principal, DAV, 'href'), root.url));
        home = elements(root.doc, CAL, 'calendar-home-set')[0];
      }
      const found = await props(home ? resource(textOf(home, DAV, 'href'), root.url) : root.url, '1');
      const result: Collection[] = [];
      for (const response of elements(found.doc, DAV, 'response')) {
        const good = elements(response, DAV, 'propstat').filter(p => / 200 /.test(textOf(p, DAV, 'status')));
        for (const prop of good) {
          if (!elements(prop, CAL, 'calendar').length) continue;
          const supported = elements(prop, CAL, 'comp').map(c => c.getAttribute('name'));
          if (supported.length && !supported.includes(componentType)) continue;
          if (kind === 'todo' && !supported.includes('VTODO')) continue;
          const privileges = elements(prop, DAV, 'current-user-privilege-set');
          const writable = !privileges.length || elements(prop, DAV, 'write').length > 0 || elements(prop, DAV, 'all').length > 0;
          result.push({ id: resource(textOf(response, DAV, 'href'), found.url), name: textOf(prop, DAV, 'displayname') || '未命名日历', writable });
        }
      }
      return result;
    },
    async list(collection) {
      const query = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${componentType}"/></c:comp-filter></c:filter></c:calendar-query>`;
      const response = check(await transport(collection, 'REPORT', query, { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }));
      const result: RemoteItem[] = [];
      for (const resourceNode of elements(xml(response.body), DAV, 'response')) {
        const href = resource(textOf(resourceNode, DAV, 'href'), response.url);
        const ok = elements(resourceNode, DAV, 'propstat').find(p => / 200 /.test(textOf(p, DAV, 'status')) && textOf(p, CAL, 'calendar-data'));
        if (!ok) throw new Error('部分 CalDAV 事项读取失败，本次未推进同步');
        const raw = textOf(ok, CAL, 'calendar-data'), version = textOf(ok, DAV, 'getetag');
        const parsed = parseCalendar(raw, kind);
        if (parsed.ignored) throw new Error(`部分事项无法解析：${parsed.warnings.join('；')}`);
        for (const value of parsed.items) result.push({ ...value, id: value.readOnly ? `${href}#${encode(value.id)}` : href, raw, version });
      }
      return result;
    },
    async write(_collection, item, value) {
      if (!item.version || !item.raw) throw new Error('远端缺少版本或原文，无法安全写入');
      const uid = parseCalendar(item.raw, kind).items[0]?.id;
      if (!uid) throw new Error('远端缺少事项 UID');
      check(await transport(item.id, 'PUT', writeCalendar(value, kind, uid, item.raw), { 'If-Match': item.version, 'Content-Type': 'text/calendar; charset=utf-8' }));
      return read(item.id);
    },
    async create(collection, value, operationId) {
      const path = `${collection.replace(/\/?$/, '/')}${operationId}.ics`;
      const existing = await transport(path);
      if (existing.status === 200) return read(path);
      if (existing.status !== 404) check(existing);
      check(await transport(path, 'PUT', writeCalendar(value, kind, `${operationId}@tano`), { 'If-None-Match': '*', 'Content-Type': 'text/calendar; charset=utf-8' }));
      return read(path);
    },
  };
}
function todoistItem(data: Json): RemoteItem {
  return { id: data.id, version: JSON.stringify([data.updated_at, data.content, data.description, data.due, data.checked, data.is_deleted]), raw: JSON.stringify(data), readOnly: data.due?.is_recurring === true || data.is_uncompletable === true, value: {
    name: data.content || '未命名任务', description: data.description || '', completed: !!data.checked, archived: !!data.is_deleted,
    ...(data.due?.date ? { date: data.due.date.slice(0, 10) } : {}),
  } };
}
function todoist(transport: Transport): RemoteAdapter {
  async function all(path: string) { return pages(transport, path, 'results', d => d.next_cursor ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encode(d.next_cursor)}` : undefined); }
  return {
    async collections() { return (await all('projects')).map(d => ({ id: d.id, name: d.name, writable: true })); },
    async list(collection) { return (await all(`tasks?project_id=${encode(collection)}&limit=200`)).map(todoistItem); },
    async write(_collection, item, value) {
      const fresh = todoistItem(await json(transport, `tasks/${encode(item.id)}`));
      if (fresh.version !== item.version) throw new Error('Todoist 中的任务已变化，本次未覆盖，请重试');
      if (value.archived) throw new Error('归档不会自动删除 Todoist 任务，请在来源应用处理');
      const patch: Json = {};
      if (value.name !== fresh.value.name) patch.content = value.name;
      if (value.description !== fresh.value.description) patch.description = value.description;
      if (value.date !== fresh.value.date && value.date) patch.due_date = value.date;
      let updated = Object.keys(patch).length ? todoistItem(await json(transport, `tasks/${encode(item.id)}`, 'POST', patch)) : fresh;
      if (value.date !== fresh.value.date && !value.date) {
        // The REST update schema does not accept a null due_date; Sync accepts due: null.
        const uuid = crypto.randomUUID();
        const cleared = await json(transport, 'sync', 'POST', { commands: [{ type: 'item_update', uuid, args: { id: item.id, due: null } }] });
        if (cleared.sync_status?.[uuid] !== 'ok') throw new Error('Todoist 截止日期未能清除，请重试');
        updated = todoistItem(await json(transport, `tasks/${encode(item.id)}`));
      }
      if (value.completed !== fresh.value.completed) {
        await json(transport, `tasks/${encode(item.id)}/${value.completed ? 'close' : 'reopen'}`, 'POST');
        updated = todoistItem(await json(transport, `tasks/${encode(item.id)}`));
      }
      return updated;
    },
    async create(collection, value, operationId) {
      const created = todoistItem(await json(transport, 'tasks', 'POST', { project_id: collection, content: value.name, description: value.description, ...(value.date ? { due_date: value.date } : {}) }, { 'X-Request-Id': operationId }));
      if (value.completed) { await json(transport, `tasks/${encode(created.id)}/close`, 'POST'); return todoistItem(await json(transport, `tasks/${encode(created.id)}`)); }
      return created;
    },
  };
}
function microsoftItem(data: Json): RemoteItem {
  return { id: data.id, version: data['@odata.etag'] || data.lastModifiedDateTime || '', raw: JSON.stringify(data), readOnly: !!data.recurrence, value: { name: data.title || '未命名任务', description: data.body?.content || '', archived: !!data['@removed'], completed: data.status === 'completed', ...(data.dueDateTime?.dateTime ? { date: data.dueDateTime.dateTime.slice(0, 10) } : {}) } };
}
function microsoft(transport: Transport): RemoteAdapter {
  const all = (path: string) => pages(transport, path, 'value', d => d['@odata.nextLink']);
  const body = (value: ItemValue) => ({ title: value.name, body: { content: value.description, contentType: 'text' }, status: value.completed ? 'completed' : 'notStarted', dueDateTime: value.date ? { dateTime: `${value.date}T00:00:00`, timeZone: 'UTC' } : null });
  return {
    async collections() { return (await all('lists')).map(d => ({ id: d.id, name: d.displayName, writable: d.isOwner !== false })); },
    async list(collection) { return (await all(`lists/${encode(collection)}/tasks`)).map(microsoftItem); },
    async write(collection, item, value) {
      if (value.archived) throw new Error('归档不会自动删除 Microsoft To Do 任务，请在来源应用处理');
      const fresh = microsoftItem(await json(transport, `lists/${encode(collection)}/tasks/${encode(item.id)}`));
      if (fresh.version !== item.version) throw new Error('Microsoft To Do 中的任务已变化，本次未覆盖，请重试');
      const headers = item.version.startsWith('W/') || item.version.startsWith('"') ? { 'If-Match': item.version } : {};
      const patch: Json = {}, fields = body(value);
      if (value.name !== fresh.value.name) patch.title = fields.title;
      if (value.description !== fresh.value.description) patch.body = fields.body;
      if (value.date !== fresh.value.date) patch.dueDateTime = fields.dueDateTime;
      if (!!value.completed !== !!fresh.value.completed) patch.status = fields.status;
      if (!Object.keys(patch).length) return fresh;
      return microsoftItem(await json(transport, `lists/${encode(collection)}/tasks/${encode(item.id)}`, 'PATCH', patch, headers));
    },
    async create(collection, value) { return microsoftItem(await json(transport, `lists/${encode(collection)}/tasks`, 'POST', body(value))); },
  };
}
export function remoteAdapter(account: Account, kind: SyncKind, transport = nativeTransport(account)): RemoteAdapter {
  if (account.provider === 'google') return google(transport);
  if (account.provider === 'todoist') {
    const adapter = todoist(transport);
    return adapter;
  }
  if (account.provider === 'microsoft') return microsoft(transport);
  return caldav(account, kind, transport);
}
/** Active-only task APIs require a separate lookup for linked tasks that disappear. */
export async function readMissingTodoist(account: Account, ids: string[], transport = nativeTransport(account)) {
  const result: RemoteItem[] = [];
  for (const id of ids) {
    const response = await transport(`tasks/${encode(id)}`);
    if (response.status === 404) continue; // Absence is not evidence of deletion.
    result.push(todoistItem(JSON.parse(check(response).body)));
  }
  return result;
}
