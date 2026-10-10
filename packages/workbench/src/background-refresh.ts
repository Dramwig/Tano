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

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function tick() {
  if (document.visibilityState === 'hidden') return;
  for (const run of subscribers) run();
}
function visibility() {
  clearInterval(timer);
  timer = undefined;
  if (document.visibilityState === 'hidden') return;
  tick();
  timer = setInterval(tick, 5000);
}

/** One visible-page clock for review panes; no overlapping work per subscriber. */
export function subscribeBackgroundRefresh(refresh: () => void | Promise<unknown>) {
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
  if (subscribers.size === 1) {
    if (document.visibilityState !== 'hidden') timer = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', tick);
  }
  return () => {
    active = false;
    subscribers.delete(run);
    if (!subscribers.size) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', tick);
    }
  };
}
