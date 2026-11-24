import type { Workspace, WorkspaceAdapter } from '@tano/protocol';

const refreshes = new WeakMap<WorkspaceAdapter, Promise<Workspace>>();
/** Share only an in-flight read. A later read (especially after a write) is fresh. */
export function refreshWorkspace(adapter: WorkspaceAdapter) {
  let pending = refreshes.get(adapter);
  if (!pending) {
    pending = adapter.refresh().finally(() => {
      if (refreshes.get(adapter) === pending) refreshes.delete(adapter);
    });
    refreshes.set(adapter, pending);
  }
  return pending;
}

const clocks = new WeakMap<Window, ReturnType<typeof createRefreshClock>>();
function createRefreshClock(window: Window) {
  const document = window.document;
  const subscribers = new Set<() => void>();
  let timer: number | undefined;
  function tick() {
    if (document.visibilityState === 'hidden') return;
    for (const run of subscribers) run();
  }
  function visibility() {
    window.clearInterval(timer);
    timer = undefined;
    if (document.visibilityState === 'hidden') return;
    tick();
    timer = window.setInterval(tick, 5000);
  }

  return { subscribers, tick, visibility,
    start() {
      if (document.visibilityState !== 'hidden') timer = window.setInterval(tick, 5000);
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('focus', tick);
    },
    stop() {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', tick);
    },
  };
}

/** Review panes share one clock in their own window, with no overlapping reads. */
export function subscribeBackgroundRefresh(refresh: () => void | Promise<unknown>, targetWindow: Window = window) {
  let clock = clocks.get(targetWindow);
  if (!clock) { clock = createRefreshClock(targetWindow); clocks.set(targetWindow, clock); }
  const { subscribers } = clock;
  let pending = false;
  let active = true;
  const run = () => {
    if (pending) return;
    pending = true;
    void Promise.resolve().then(() => active ? refresh() : undefined).catch(() => {
      // Each caller owns its error UI. A failure must not stop later polls.
    }).finally(() => { pending = false; });
  };
  subscribers.add(run);
  if (subscribers.size === 1) clock.start();
  return () => {
    active = false;
    subscribers.delete(run);
    if (!subscribers.size) { clock.stop(); clocks.delete(targetWindow); }
  };
}
