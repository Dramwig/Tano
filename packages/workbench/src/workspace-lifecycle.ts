export interface WorkspaceLifecycleHost {
  watch(changed: () => void): Promise<() => void>;
  refresh(): Promise<void>;
  available(): boolean;
  report(error: unknown): void;
}

/** Owns watcher, fallback polling and refresh coalescing for one workspace generation. */
export class WorkspaceLifecycle {
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private unwatch?: () => void;
  private running = false;
  private pending = false;
  private generation = 0;
  private paused = false;

  constructor(private readonly host: WorkspaceLifecycleHost, private readonly browserFallback: boolean) {}

  readonly schedule = () => {
    if (!this.host.available()) return;
    this.pending = true;
    if (this.paused || this.timer || this.running) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pending = false;
      this.running = true;
      void this.host.refresh().catch(this.host.report).finally(() => {
        if (generation !== this.generation) return;
        this.running = false;
        if (this.pending) this.schedule();
      });
    }, 150);
  };
  private readonly visible = () => {
    if (document.visibilityState === 'visible') this.schedule();
  };

  enablePolling(): void {
    if (this.browserFallback && !this.poll && this.host.available())
      this.poll = setInterval(this.visible, 5_000);
  }

  pause(): void {
    this.paused = true;
    clearTimeout(this.timer); this.timer = undefined;
  }

  resume(): void {
    this.paused = false;
    if (this.pending) this.schedule();
  }

  async start(): Promise<void> {
    this.stop();
    const generation = this.generation;
    let watching = false;
    try {
      const unwatch = await this.host.watch(() => {
        if (generation === this.generation) this.schedule();
      });
      if (generation !== this.generation) { unwatch(); return; }
      this.unwatch = unwatch;
      watching = true;
    } catch (error) {
      if (generation !== this.generation) return;
      this.host.report(`文件监听未能启动：${String(error)}。目录将继续自动检查。`);
    }
    if (this.browserFallback) {
      // Native watches already cover external edits. Poll only after registration
      // fails; a healthy watcher must not trigger full scans every five seconds.
      if (!watching) this.enablePolling();
      window.addEventListener('focus', this.schedule);
      document.addEventListener('visibilitychange', this.visible);
    }
  }

  stop(): void {
    this.generation++;
    this.unwatch?.();
    this.unwatch = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    clearInterval(this.poll); this.poll = undefined;
    this.pending = false;
    this.running = false;
    this.paused = false;
    if (this.browserFallback) {
      window.removeEventListener('focus', this.schedule);
      document.removeEventListener('visibilitychange', this.visible);
    }
  }
}
