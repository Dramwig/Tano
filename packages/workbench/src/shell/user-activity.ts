interface ActivitySubscriber {
  onDeadline(): void;
  onActivity?(event: Event): void;
  onSuspend?(): void;
  onResume?(): void;
}

interface ScheduledSubscriber extends ActivitySubscriber { deadline?: number }

function createActivityClock() {
  const subscribers = new Set<ScheduledSubscriber>();
  const listeners: (() => void)[] = [];
  const pointers = new Set<number>();
  const keys = new Set<string>();
  let lastActivity = Date.now();
  let focused = document.hasFocus();
  let visible = !document.hidden;
  let composing = false;
  let dispatching = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerAt = Infinity;
  const canRun = () => focused && visible && !composing && !pointers.size && !keys.size;

  function clear() { clearTimeout(timer); timer = undefined; timerAt = Infinity; }
  function schedule() {
    if (dispatching) return;
    const next = canRun() ? Math.min(...[...subscribers].map(item => item.deadline ?? Infinity)) : Infinity;
    if (next === Infinity) { clear(); return; }
    // Keep an earlier wake-up; input must not churn timers on every pointer event.
    if (timer !== undefined && timerAt <= next) return;
    clear(); timerAt = next;
    timer = setTimeout(wake, Math.max(0, next - Date.now()));
  }
  function wake() {
    timer = undefined; timerAt = Infinity;
    if (!canRun()) return;
    const now = Date.now();
    dispatching = true;
    try {
      for (const item of subscribers) {
        if (item.deadline === undefined || item.deadline > now) continue;
        item.deadline = undefined;
        item.onDeadline();
      }
    } finally { dispatching = false; schedule(); }
  }
  function activity(event: Event) {
    lastActivity = Date.now();
    // The hot path only writes a timestamp: no subscriber calls, DOM reads or timers.
    if (event.type === 'pointermove' || event.type === 'scroll' || event.type === 'resize') return;
    if (event.type === 'pointerdown') pointers.add((event as PointerEvent).pointerId);
    if (event.type === 'pointerup' || event.type === 'pointercancel') pointers.delete((event as PointerEvent).pointerId);
    if (event.type === 'keydown') keys.add((event as KeyboardEvent).code);
    if (event.type === 'keyup') keys.delete((event as KeyboardEvent).code);
    if (event.type === 'compositionstart') composing = true;
    if (event.type === 'compositionend') composing = false;
    for (const item of subscribers) item.onActivity?.(event);
    schedule();
  }
  function presence() {
    lastActivity = Date.now(); pointers.clear(); keys.clear(); composing = false;
    for (const item of subscribers) {
      if (focused && visible) item.onResume?.();
      else item.onSuspend?.();
    }
    schedule();
  }
  function listen(target: EventTarget, name: string, handler: EventListener, capture = true) {
    target.addEventListener(name, handler, { capture, passive: true });
    listeners.push(() => target.removeEventListener(name, handler, capture));
  }
  for (const name of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup', 'input',
    'wheel', 'scroll', 'resize', 'selectionchange', 'focusin', 'focusout', 'compositionstart', 'compositionend'])
    listen(window, name, activity);
  listen(window, 'blur', () => { focused = false; presence(); }, false);
  listen(window, 'focus', () => { focused = true; presence(); }, false);
  listen(document, 'visibilitychange', () => { visible = !document.hidden; presence(); });

  return {
    subscribe(options: ActivitySubscriber) {
      const item: ScheduledSubscriber = { ...options };
      subscribers.add(item);
      return {
        get lastActivity() { return lastActivity; },
        get canRun() { return canRun(); },
        schedule(delay: number) {
          if (!subscribers.has(item)) return;
          item.deadline = Date.now() + Math.max(0, delay); schedule();
        },
        cancel() { item.deadline = undefined; schedule(); },
        dispose() {
          if (!subscribers.delete(item)) return;
          if (subscribers.size) schedule();
          else {
            clear(); listeners.splice(0).forEach(remove => remove());
            clock = undefined;
          }
        },
      };
    },
  };
}

let clock: ReturnType<typeof createActivityClock> | undefined;
/** One listener set and one deadline timer per window, released with the last subscriber. */
export function subscribeUserActivity(options: ActivitySubscriber) {
  clock ??= createActivityClock();
  return clock.subscribe(options);
}
