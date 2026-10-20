import { expect, it } from 'vitest';
import { StandaloneSession, type Snapshot } from './standalone-session';
const snapshot = (content: string, hash = content): Snapshot => ({ content, hash, modified: 0 });

it('merges independent external edits and saves against the new disk hash', async () => {
  const session = new StandaloneSession(snapshot('one\ntwo\nthree\n'));
  session.content = 'ONE\ntwo\nthree\n';
  const writes: string[] = [];
  const saved = await session.save(async (content, expected) => {
    writes.push(expected);
    return writes.length === 1
      ? { status: 'conflict', snapshot: snapshot('one\ntwo\nTHREE\n', 'external') }
      : { status: 'saved', snapshot: snapshot(content, 'saved') };
  });
  expect(saved).toBe(true);
  expect(writes).toEqual(['one\ntwo\nthree\n', 'external']);
  expect(session.content).toBe('ONE\ntwo\nTHREE\n');
});
it('retains both versions on an overlapping edit without attempting an overwrite', async () => {
  const session = new StandaloneSession(snapshot('base'));
  session.content = 'local';
  let calls = 0;
  expect(await session.save(async () => { calls++; return { status: 'conflict', snapshot: snapshot('external') }; })).toBe(false);
  expect(calls).toBe(1);
  expect(session.content).toBe('local');
  expect(session.base.content).toBe('base');
  expect(session.conflict?.content).toBe('external');
});
it('retains edits typed during a save and refuses to recreate a missing original', async () => {
  const session = new StandaloneSession(snapshot('base'));
  session.content = 'submitted';
  expect(await session.save(async content => {
    session.content = 'typed during save';
    return { status: 'saved', snapshot: snapshot(content) };
  })).toBe(false);
  expect(session.dirty).toBe(true);
  expect(session.content).toBe('typed during save');
  await expect(session.save(async () => ({ status: 'missing' }))).rejects.toThrow('移动或删除');
  expect(session.content).toBe('typed during save');
});
