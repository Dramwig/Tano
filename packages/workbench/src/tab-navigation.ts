import { computed, ref } from 'vue';

interface History { entries: string[]; index: number }
export interface TabNavigationHost {
  activeId(): string;
  busy(): boolean;
  available(id: string): boolean;
  focusPane(id: string): boolean;
  open(id: string, historyIndex: number): Promise<void>;
}

/** Owns slot history and navigation lifecycle without depending on the workspace store. */
export function useTabNavigation(host: TabNavigationHost) {
  const slots = new Map<string, string>();
  const histories = new Map<string, History>();
  const revision = ref(0), navigating = ref(false);
  const touch = () => { revision.value++; };
  function ensure(tabId: string, initialId = tabId): History {
    let slot = slots.get(tabId);
    if (!slot) { slot = crypto.randomUUID(); slots.set(tabId, slot); }
    if (!histories.has(slot)) histories.set(slot, { entries: [initialId], index: 0 });
    return histories.get(slot)!;
  }
  function reset() { slots.clear(); histories.clear(); touch(); }
  function record(fromId: string | undefined, toId: string, historyIndex?: number) {
    const history = ensure(fromId ?? toId, fromId ?? toId);
    const slot = slots.get(fromId ?? toId)!;
    if (fromId && fromId !== toId) { slots.delete(fromId); slots.set(toId, slot); }
    if (historyIndex === undefined) {
      if (history.entries[history.index] !== toId)
        history.entries = [...history.entries.slice(0, history.index + 1), toId].slice(-100);
      history.index = history.entries.length - 1;
    } else history.index = historyIndex;
    touch();
  }
  function remove(tabId: string) {
    const slot = slots.get(tabId);
    if (!slot) return;
    slots.delete(tabId); histories.delete(slot); touch();
  }
  function active(tabId = host.activeId()) {
    void revision.value;
    return tabId ? ensure(tabId) : undefined;
  }
  function destination(direction: -1 | 1, tabId = host.activeId()) {
    const history = active(tabId);
    if (!history) return -1;
    for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction)
      if (host.available(history.entries[index])) return index;
    return -1;
  }
  function canNavigate(direction: -1 | 1, tabId = host.activeId()) {
    return !host.busy() && !navigating.value && destination(direction, tabId) >= 0;
  }
  async function navigate(direction: -1 | 1, paneId?: string) {
    if (host.busy() || navigating.value) return;
    if (paneId && !host.focusPane(paneId)) return;
    const index = destination(direction), history = active();
    if (index < 0 || !history) return;
    navigating.value = true;
    try { await host.open(history.entries[index], index); }
    finally { navigating.value = false; }
  }
  return { ensure, reset, record, remove, touch, canNavigate, navigate,
    canGoBack: computed(() => canNavigate(-1)), canGoForward: computed(() => canNavigate(1)) };
}
