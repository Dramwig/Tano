import type { WorkspaceSession } from '@tano/protocol';

/**
 * Persist the first recovery snapshot immediately, then coalesce pending snapshots
 * per workspace while storage is busy. A flush includes writes queued during it.
 * Callers supply immutable snapshots; UI state and timers stay outside this service.
 */
export class SessionJournal {
  private pending = new Map<string, WorkspaceSession>();
  private task: Promise<void> = Promise.resolve();
  private writing = false;

  constructor(
    private readonly save: (id: string, session: WorkspaceSession) => Promise<void>,
    private readonly report: (error?: unknown) => void,
  ) {}

  enqueue(id: string, session: WorkspaceSession): void {
    this.pending.set(id, session);
    if (this.writing) return;
    this.writing = true;
    this.task = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending.size) {
        const [id, session] = this.pending.entries().next().value!;
        this.pending.delete(id);
        try {
          await this.save(id, session);
          this.report();
        } catch (error) {
          this.report(error);
        }
      }
    } finally {
      this.writing = false;
    }
  }

  async flush(): Promise<void> {
    do { await this.task; } while (this.writing);
  }
}
