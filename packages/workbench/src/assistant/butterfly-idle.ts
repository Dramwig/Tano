import { subscribeUserActivity } from '../user-activity';

export const BUTTERFLY_IDLE_MS = 30_000;

export interface ButterflyIdleSelection {
  scope: string;
  from: number;
  to: number;
  /** Immutable editor document identity, so edits also restart the wait. */
  document: unknown;
}

interface ButterflyIdleOptions {
  selection(): ButterflyIdleSelection | null;
  enabled(): boolean;
  onIdle(selection: ButterflyIdleSelection): void;
}

function sameSelection(a: ButterflyIdleSelection | null, b: ButterflyIdleSelection | null) {
  return a === b || !!a && !!b && a.scope === b.scope && a.from === b.from && a.to === b.to && a.document === b.document;
}

/** Selection changes arm the surprise; mouse movement only updates the shared clock. */
export function createButterflyIdleTrigger(options: ButterflyIdleOptions) {
  let current: ButterflyIdleSelection | null = null;
  let fired = false;
  let disposed = false;
  let waitingSince = Date.now();
  const activity = subscribeUserActivity({
    onDeadline: check,
    onActivity: event => { if (['selectionchange', 'focusin', 'focusout'].includes(event.type)) refresh(); },
    onSuspend: () => activity.cancel(),
    onResume: refresh,
  });
  function refresh() {
    if (disposed) return;
    const selection = options.selection();
    if (!sameSelection(selection, current)) { current = selection; fired = false; }
    waitingSince = Date.now();
    if (current && !fired && options.enabled()) activity.schedule(BUTTERFLY_IDLE_MS);
    else activity.cancel();
  }
  function check() {
    if (disposed || !activity.canRun || !options.enabled()) return;
    const remaining = BUTTERFLY_IDLE_MS - (Date.now() - Math.max(waitingSince, activity.lastActivity));
    if (remaining > 0) { activity.schedule(remaining); return; }
    // Only read the live selection when its full quiet period has elapsed.
    const latest = options.selection();
    if (!sameSelection(latest, current)) { refresh(); return; }
    if (!latest || fired) return;
    fired = true;
    options.onIdle(latest);
  }
  refresh();
  return {
    refresh,
    dispose() { if (disposed) return; disposed = true; activity.dispose(); current = null; },
  };
}
