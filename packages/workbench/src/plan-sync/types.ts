import type { ObjectRecord } from '../workspace-objects';
export type SyncKind = 'calendar' | 'todo';
export type ProviderId = 'google' | 'icloud' | 'feishu' | 'caldav' | 'todoist' | 'microsoft';
export interface Account { id: string; provider: ProviderId; label: string; server: string }
export interface Collection { id: string; name: string; writable: boolean }
export interface ItemValue {
  name: string;
  description: string;
  start?: string;
  end?: string;
  date?: string;
  allDay?: boolean;
  completed?: boolean;
  archived: boolean;
}
export interface RemoteItem { id: string; version: string; value: ItemValue; raw?: string; readOnly?: boolean }
export interface RemoteAdapter {
  collections(): Promise<Collection[]>;
  list(collection: string): Promise<RemoteItem[]>;
  write(collection: string, item: RemoteItem, value: ItemValue): Promise<RemoteItem>;
  create(collection: string, value: ItemValue, operationId: string): Promise<RemoteItem>;
}
export interface Binding { localId: string; remote: RemoteItem; base: ItemValue }
export interface SyncConflict { remoteId: string; localId: string; local: ItemValue; remote: ItemValue; reason: string }
export interface Connection {
  id: string; accountId: string; kind: SyncKind; collection: Collection;
  scope: 'personal' | 'workspace'; workspaceId?: string; workspaceName?: string;
  direction: 'both' | 'pull'; enabled: boolean; uploadNew: boolean;
  bindings: Binding[]; conflicts: SyncConflict[];
  pending?: { localId: string; operationId: string; value?: ItemValue; uncertain?: boolean };
  lastSync?: string; lastAttempt?: string; error?: string;
}
export interface SyncState { version: 1; connections: Connection[] }
export interface LocalSyncPort {
  list(): Promise<ObjectRecord[]>;
  create(value: ItemValue, remoteId: string, readOnly: boolean): Promise<ObjectRecord>;
  update(record: ObjectRecord, value: ItemValue): Promise<ObjectRecord>;
  link?(record: ObjectRecord, remoteId: string): Promise<void>;
}
export const providers: { id: ProviderId; name: string; kinds: SyncKind[]; server: string; hint: string }[] = [
  { id: 'google', name: 'Google 日历', kinds: ['calendar'], server: 'https://www.googleapis.com/calendar/v3/', hint: '在系统浏览器中授权访问日历。' },
  { id: 'icloud', name: 'iCloud 日历', kinds: ['calendar'], server: 'https://caldav.icloud.com/', hint: '使用 Apple 账号与 App 专用密码。' },
  { id: 'feishu', name: '飞书日历', kinds: ['calendar'], server: '', hint: '从飞书的日历设置 → CalDAV 同步配置中获取服务器、用户名和密码。' },
  { id: 'caldav', name: 'CalDAV', kinds: ['calendar', 'todo'], server: '', hint: '日历使用 VEVENT；Todo 需要服务器支持 VTODO。' },
  { id: 'todoist', name: 'Todoist', kinds: ['todo'], server: 'https://api.todoist.com/api/v1/', hint: '在 Todoist 设置 → 集成 → 开发者中获取 API Token。' },
  { id: 'microsoft', name: 'Microsoft To Do', kinds: ['todo'], server: 'https://graph.microsoft.com/v1.0/me/todo/', hint: '在系统浏览器中授权访问任务清单。' },
];
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function localValue(record: ObjectRecord, kind: SyncKind): ItemValue {
  const p = record.object.properties;
  if (kind === 'todo') return { name: record.object.name, description: record.object.description, archived: record.object.archived,
    completed: p.completed === true || p.status === 'done' || p.status === 'completed', ...(typeof p.due === 'string' && p.due ? { date: p.due } : {}) };
  if (typeof p.date === 'string' && p.date && !p.start) {
    const start = new Date(`${p.date}T00:00:00`), end = new Date(start); end.setDate(end.getDate() + 1);
    return { name: record.object.name, description: record.object.description, archived: record.object.archived, start: start.toISOString(), end: end.toISOString(), allDay: true };
  }
  return {
    name: record.object.name, description: record.object.description, archived: record.object.archived,
    ...(typeof p.start === 'string' && p.start ? { start: new Date(p.start).toISOString() } : {}),
    ...(typeof p.end === 'string' && p.end ? { end: new Date(p.end).toISOString() } : {}),
    ...(typeof p.date === 'string' && p.date ? { date: p.date } : {}),
    ...(p.allDay === true ? { allDay: true } : {}),
  };
}
export function itemProperties(value: ItemValue, kind: SyncKind) {
  if (kind === 'todo') return { due: value.date, checkable: true, completed: !!value.completed };
  return { start: value.start, end: value.end, date: value.date, allDay: value.allDay, checkable: false, completed: false };
}
