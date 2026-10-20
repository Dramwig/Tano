import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSession } from '@tano/protocol';
import { SessionJournal } from './session-journal';

const snapshot = (activeId: string): WorkspaceSession => ({ version: 1, activeId, documents: [] });

describe('SessionJournal', () => {
  it('starts immediately, coalesces busy writes and flushes every workspace', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const save = vi.fn().mockImplementationOnce(() => held).mockResolvedValue(undefined);
    const journal = new SessionJournal(save, vi.fn());
    journal.enqueue('first', snapshot('a'));
    expect(save).toHaveBeenCalledTimes(1);
    journal.enqueue('first', snapshot('b'));
    journal.enqueue('first', snapshot('c'));
    journal.enqueue('second', snapshot('d'));
    const flushed = journal.flush();
    release();
    await flushed;
    expect(save.mock.calls.map(([id, session]) => [id, session.activeId])).toEqual([
      ['first', 'a'], ['first', 'c'], ['second', 'd'],
    ]);
  });

  it('reports failure and continues with the next durable snapshot', async () => {
    const error = new Error('full');
    const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const report = vi.fn();
    const journal = new SessionJournal(save, report);
    journal.enqueue('space', snapshot('a'));
    await journal.flush();
    expect(report).toHaveBeenLastCalledWith(error);
    journal.enqueue('space', snapshot('b'));
    await journal.flush();
    expect(report).toHaveBeenLastCalledWith();
    expect(save).toHaveBeenCalledTimes(2);
  });
});
