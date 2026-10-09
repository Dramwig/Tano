import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { helpContextTopic, helpTopics } from './help-content';
import type { HelpContext, HelpTopic, HelpTopicId } from './help-content';

export const helpPreferenceKey = 'tano.preference.helpGuidance.v1';
export const helpTiming = {
  warmup: 45_000, dwell: 20_000, quiet: 12_000, idle: 90_000,
  cooldown: 10 * 60_000, snooze: 60 * 60_000, duration: 18_000, dailyLimit: 2,
};
interface HelpPreferences {
  enabled: boolean;
  seen: HelpTopicId[];
  lastShown: number;
  snoozedUntil: number;
  day: string;
  count: number;
}
const defaults = (): HelpPreferences => ({ enabled: true, seen: [], lastShown: 0, snoozedUntil: 0, day: '', count: 0 });
export function readHelpPreferences(): HelpPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(helpPreferenceKey) ?? 'null');
    if (!value || typeof value !== 'object') return defaults();
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
    return {
      enabled: value.enabled !== false,
      seen: Array.isArray(value.seen) ? value.seen.filter((id: unknown): id is HelpTopicId =>
        typeof id === 'string' && Object.hasOwn(helpTopics, id)) : [],
      lastShown: number(value.lastShown), snoozedUntil: number(value.snoozedUntil),
      day: typeof value.day === 'string' ? value.day : '', count: number(value.count),
    };
  } catch { return defaults(); }
}
function localDay(now: number) {
  const date = new Date(now);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

const helpPreferencesChanged = 'tano:help-preferences-changed';

// The settings panel may live in this page or in a separate desktop webview.
// Share changes locally as well as through the browser's cross-window storage event.
export function useHelpPreferences() {
  const preferences = ref(readHelpPreferences());
  function save() {
    try { localStorage.setItem(helpPreferenceKey, JSON.stringify(preferences.value)); }
    catch { /* Keep guidance preferences in memory when device storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent<HelpPreferences>(helpPreferencesChanged, {
      detail: { ...preferences.value, seen: [...preferences.value.seen] },
    }));
  }
  function merge(saved: HelpPreferences) {
    // Merge read markers from other windows without losing this session's fallback state.
    preferences.value = { ...saved,
      seen: [...new Set([...saved.seen, ...preferences.value.seen])],
      lastShown: Math.max(saved.lastShown, preferences.value.lastShown),
      snoozedUntil: Math.max(saved.snoozedUntil, preferences.value.snoozedUntil),
      ...(saved.day === preferences.value.day ? { count: Math.max(saved.count, preferences.value.count) } : {}),
    };
  }
  function refresh() {
    try {
      if (localStorage.getItem(helpPreferenceKey) !== null) merge(readHelpPreferences());
    } catch { /* Retain the session's preferences if storage is unavailable. */ }
  }
  function storage(event: StorageEvent) {
    if (event.key === helpPreferenceKey || event.key === null) merge(readHelpPreferences());
  }
  function localChange(event: Event) { merge((event as CustomEvent<HelpPreferences>).detail); }
  function setEnabled(enabled: boolean) {
    refresh();
    preferences.value.enabled = enabled;
    save();
  }
  onMounted(() => {
    window.addEventListener('storage', storage);
    window.addEventListener(helpPreferencesChanged, localChange);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(helpPreferencesChanged, localChange);
  });
  return { preferences, save, refresh, setEnabled };
}

export function useHelpGuidance(options: {
  context: () => HelpContext;
  available: () => boolean;
  blocked: () => boolean;
  scope: () => string | undefined;
  interacting: () => boolean;
}) {
  const { preferences, save, refresh, setEnabled } = useHelpPreferences();
  const hint = ref<HelpTopic>();
  const started = Date.now();
  let contextSince = started;
  let lastActivity = started;
  let shownAt = 0;
  let sessionCount = 0;
  let pointerDown = false;
  let composing = false;
  let focused = document.hasFocus();
  let timer: ReturnType<typeof setInterval> | undefined;

  function dismiss(snooze = false) {
    hint.value = undefined;
    if (snooze) {
      preferences.value.snoozedUntil = Date.now() + helpTiming.snooze;
      save();
    }
  }
  watch(() => preferences.value.enabled, () => {
    dismiss();
    lastActivity = Date.now();
  }, { flush: 'sync' });
  function readTopic(id: HelpTopicId) {
    if (!preferences.value.seen.includes(id)) preferences.value.seen.push(id);
    dismiss();
    save();
  }
  function resetContext() {
    dismiss();
    contextSince = lastActivity = Date.now();
  }
  watch([options.context, options.scope, options.available, options.blocked], resetContext);

  function tick() {
    const now = Date.now();
    const obstructed = options.blocked() || !options.available() || document.hidden || !focused ||
      [...document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [role="menu"], [aria-modal="true"], .modal-backdrop, .tano-editor-panel',
      )].some(element => !element.closest('[hidden], [aria-hidden="true"], [inert]') &&
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    if (obstructed) { dismiss(); lastActivity = now; return; }
    if (hint.value) {
      if (options.interacting()) shownAt = now;
      else if (now - shownAt >= helpTiming.duration) dismiss();
      return;
    }
    if (!preferences.value.enabled || pointerDown || composing || options.interacting() ||
      now - started < helpTiming.warmup || now - contextSince < helpTiming.dwell ||
      now - lastActivity < helpTiming.quiet || sessionCount >= helpTiming.dailyLimit) return;
    refresh();
    const state = preferences.value;
    if (!state.enabled || now < state.snoozedUntil ||
      (state.lastShown && now - state.lastShown < helpTiming.cooldown) ||
      (state.day === localDay(now) && state.count >= helpTiming.dailyLimit)) return;
    const contextual = helpContextTopic(options.context());
    const topic = !state.seen.includes(contextual.id) ? contextual :
      now - lastActivity >= helpTiming.idle && !state.seen.includes('find') ? helpTopics.find : undefined;
    if (!topic) return;
    state.seen.push(topic.id);
    state.count = state.day === localDay(now) ? state.count + 1 : 1;
    state.day = localDay(now);
    state.lastShown = shownAt = now;
    sessionCount += 1;
    save();
    hint.value = topic;
  }
  function activity(event: Event) {
    lastActivity = Date.now();
    if (event.type === 'pointerdown') pointerDown = true;
    if (event.type === 'compositionstart') composing = true;
    if (event.type === 'compositionend') composing = false;
    const inside = (event.target instanceof Element) && event.target.closest('[data-help-surface]');
    if (!inside && ['keydown', 'input', 'pointerdown', 'wheel', 'compositionstart'].includes(event.type)) dismiss();
  }
  function releasePointer() { pointerDown = false; lastActivity = Date.now(); }
  function blur() { focused = false; pointerDown = composing = false; resetContext(); }
  function focus() { focused = true; resetContext(); }
  const events = ['keydown', 'input', 'pointerdown', 'pointermove', 'wheel', 'compositionstart', 'compositionend'];
  onMounted(() => {
    timer = setInterval(tick, 1000);
    for (const event of events) window.addEventListener(event, activity, { passive: true, capture: true });
    window.addEventListener('pointerup', releasePointer, true);
    window.addEventListener('pointercancel', releasePointer, true);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', resetContext);
  });
  onBeforeUnmount(() => {
    clearInterval(timer);
    for (const event of events) window.removeEventListener(event, activity, true);
    window.removeEventListener('pointerup', releasePointer, true);
    window.removeEventListener('pointercancel', releasePointer, true);
    window.removeEventListener('blur', blur);
    window.removeEventListener('focus', focus);
    document.removeEventListener('visibilitychange', resetContext);
  });
  return { hint, preferences, dismiss, setEnabled, readTopic };
}
