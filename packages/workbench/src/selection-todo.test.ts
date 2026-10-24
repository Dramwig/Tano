import { expect, it, vi } from 'vitest';
import { documentLinks } from '@tano/editor/document-links';
import { selectionTodoDraft, selectionTodoSession } from './selection-todo';
import type { ObjectRecord } from './workspace-objects';

const source = { workspace: 'ws', type: 'document', id: 'a00001', name: 'Source [draft]', path: 'note.md' };
it('keeps selected content as a quote with a stable source and no required schedule', () => {
  const value = selectionTodoDraft('A task\n[example](object://event/c00001)', source, ' Follow up ');
  expect(value.name).toBe('Follow up');
  expect(value.properties).toEqual({ checkable: true, completed: false });
  expect(documentLinks(value.description)).toEqual([{ kind: 'markdown', target: 'object://document/a00001' }]);
  expect(() => selectionTodoDraft('x'.repeat(20000), source, 'Task')).toThrow('过长');
});
it('retains the same created task when original-document insertion fails or is retried', async () => {
  const create = vi.fn(async value => ({ object: { ...value, id: 'b00001', version: 1 }, path: '.tano/objects/b00001.tano.json', snapshot: { content: '', hash: 'h', modified: 0 } } as ObjectRecord));
  const insert = vi.fn().mockRejectedValueOnce(new Error('Original changed')).mockResolvedValue(undefined);
  const session = selectionTodoSession('Selected task', source, { create, insert });
  await expect(session.save('Task')).rejects.toThrow('changed');
  expect(session.created?.object.id).toBe('b00001');
  await session.save('Task', true);
  await session.save('Task');
  expect(create).toHaveBeenCalledTimes(1);
  expect(insert).toHaveBeenCalledTimes(2);
  expect(insert).toHaveBeenLastCalledWith(session.created, true);
});

it('creates scheduled events without completion controls and requires their date', () => {
  expect(() => selectionTodoDraft('Meeting', source, 'Meeting', { kind: 'event' })).toThrow('日期');
  const draft = selectionTodoDraft('Meeting', source, 'Meeting', { kind: 'event', date: { date: '2026-10-23', time: '10:00', end: '2026-10-23T11:00' } });
  expect(draft.properties.checkable).toBe(false);
  expect(draft.properties.start).toBeTruthy();
  expect(draft.properties.end).toBeTruthy();
});
it('preserves source location and does not recreate an event after reference insertion fails', async () => {
  const create = vi.fn(async value => ({ object: { ...value, id: 'b00001', version: 1 } } as ObjectRecord));
  const insert = vi.fn().mockRejectedValueOnce(new Error('Conflict')).mockResolvedValue(undefined);
  const location = { workspaceId: 'ws', fileId: 'a00001', selection: { text: 'Meeting', from: 10, to: 17 } };
  const session = selectionTodoSession('Meeting', source, { create, insert }, { workspaceName: 'Project', source: location });
  const options = { kind: 'event' as const, date: { date: '2026-10-23', time: '', end: '' } };
  await expect(session.save('Meeting', false, options)).rejects.toThrow('Conflict');
  await session.save('Changed', true);
  expect(create).toHaveBeenCalledTimes(1);
  expect(session.created?.object.properties.documentSource).toEqual(location);
  expect(session.created?.object.properties.checkable).toBe(false);
});
