import { expect, it, vi } from 'vitest';
import type { ObjectRecord } from '../objects/workspace-objects';
import { movePlanBetweenScopes, prepareMigratedObject } from './plan-migration';

const makeRecord = (
  scope: 'workspace' | 'personal',
  type: 'event' | 'task',
  properties: Record<string, unknown>,
): ObjectRecord => ({
  path: '.tano/objects/a00001.tano.json',
  snapshot: { hash: 'h1', content: '', modified: 1 },
  source: { scope, id: scope === 'personal' ? 'p1' : 'ws1', name: scope === 'personal' ? '个人' : '工作区' },
  object: { version: 1, id: 'a00001', type, name: '周报', description: '说明', archived: false, properties },
});

it('canonicalizes legacy tasks, strips sync/review metadata, and switches repeat mode when moving to personal', () => {
  const source = makeRecord('workspace', 'task', {
    status: 'todo',
    due: '2026-10-10',
    syncConnection: 'conn',
    syncRemoteId: 'rem',
    deliveryReview: { version: 1, state: 'pending' },
    repeat: { version: 1, frequency: 'weekly', interval: 1, anchor: '2026-10-10' },
  });
  const prepared = prepareMigratedObject(source.object, 'personal');
  expect(prepared.type).toBe('event');
  expect(prepared.properties).toMatchObject({
    checkable: true,
    completed: false,
    due: '2026-10-10',
    repeat: { version: 1, mode: 'schedule', frequency: 'weekly', interval: 1, anchor: '2026-10-10' },
  });
  expect(prepared.properties.syncConnection).toBeUndefined();
  expect(prepared.properties.deliveryReview).toBeUndefined();
});

it('creates destination copy before archiving source and warns without data loss if archive fails', async () => {
  const source = makeRecord('personal', 'event', { checkable: false, date: '2026-10-12', location: 'Room A' });
  const created = makeRecord('workspace', 'event', { checkable: false, date: '2026-10-12', location: 'Room A' });
  const create = vi.fn(async () => created);
  const archive = vi.fn(async () => { throw new Error('disk busy'); });

  const result = await movePlanBetweenScopes(source, 'workspace', { workspaceId: 'ws1', create, archive });
  expect(create).toHaveBeenCalledTimes(1);
  expect(archive).toHaveBeenCalledTimes(1);
  expect(result.created).toBe(created);
  expect(result.archivedSource).toBe(false);
  expect(result.warning).toContain('disk busy');
});
