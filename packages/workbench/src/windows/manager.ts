import {
  createNativePhysicalPosition,
  getNativeWindowByLabel,
  nativeMonitorFromPoint as monitorFromPoint,
} from '../platform/native-bridge';
import { SETTINGS_WIDTH, SETTINGS_HEIGHT, centeredSettingsPosition } from './position';
import { markRaw, nextTick, onBeforeUnmount, shallowReactive, watch } from 'vue';
import { createWindowContext, type WindowContext } from './context';
import { openAuxWindow, type AuxWindow } from './aux-window';
import type { useWorkspaceStore } from '../stores/workspace';
import { layoutPanes } from '../shell/pane-layout';

export interface AuxiliaryEntry {
  id: string;
  kind: 'tab' | 'settings';
  aux: AuxWindow;
  context: WindowContext;
  disposeListener?: () => void;
  closing?: Promise<boolean>;
  destroyed: boolean;
}

export function useAuxiliaryWindows(store: ReturnType<typeof useWorkspaceStore>, prepareClose: () => Promise<boolean>, showError: (context: WindowContext) => void = () => {}) {
  const entries = shallowReactive(new Map<string, AuxiliaryEntry>());

  async function destroy(entry: AuxiliaryEntry) {
    if (entry.destroyed) return;
    entry.destroyed = true;
    try {
      await entry.context.native?.destroy();
    } catch (error) {
      entry.destroyed = false;
      throw error;
    }
    entry.disposeListener?.();
    entry.aux.close();
    entries.delete(entry.id);
  }

  function close(id: string): Promise<boolean> {
    const entry = entries.get(id);
    if (!entry) return opening.get(id)?.then(() => close(id)) ?? Promise.resolve(true);
    if (entry.closing) return entry.closing;
    entry.closing = (async () => {
      try {
        if (!(await prepareClose())) { showError(entry.context); return false; }
        if (entry.kind === 'tab' && !(await store.closeAuxiliaryWindow(id))) { showError(entry.context); return false; }
        await destroy(entry);
        return true;
      } catch (error) {
        showError(entry.context);
        store.report(error);
        return false;
      } finally {
        entry.closing = undefined;
      }
    })();
    return entry.closing;
  }

  async function create(id: string, kind: AuxiliaryEntry['kind'], title: string, position?: { x: number; y: number }, prepareContent?: (entry: AuxiliaryEntry) => void) {
    const aux = openAuxWindow({ name: id, kind, title, width: kind === 'settings' ? SETTINGS_WIDTH : 1100, height: kind === 'settings' ? SETTINGS_HEIGHT : 760, left: position?.x, top: position?.y });
    const context = await createWindowContext(id, `aux-${id}`, aux.window).catch(error => { aux.close(); throw error; });
    const entry: AuxiliaryEntry = markRaw({ id, kind, aux, context, destroyed: false });
    entries.set(id, entry);
    try {
      entry.disposeListener = await context.native?.onCloseRequested(event => {
        event.preventDefault();
        void close(id);
      });
      void aux.closed.then(async () => {
        // A popup can disappear while initial styles are still loading. Let
        // creation finish its recovery before handling an external close.
        await opening.get(id)?.catch(() => {});
        if (entry.destroyed) return;
        entry.disposeListener?.();
        entries.delete(id);
        // An externally destroyed WebView cannot display a save error. Retain
        // the store contents and recreate its UI if saving/closing fails.
        if (kind === 'tab' && !(await store.closeAuxiliaryWindow(id))) {
          await open(id, kind, title, position).then(replacement => showError(replacement.context)).catch(store.report);
        }
      });
      if (kind === 'settings' && context.native) {
        const parent = await getNativeWindowByLabel('main');
        if (!parent) throw new Error('Main window is unavailable');
        const [position, size] = await Promise.all([parent.outerPosition(), parent.outerSize()]);
        const monitor = await monitorFromPoint(position.x + size.width / 2, position.y + size.height / 2);
        for (let pass = 0; pass < 2; pass++) {
          const childSize = await context.native.outerSize();
          await context.native.setPosition(createNativePhysicalPosition(centeredSettingsPosition({ position, size }, childSize, monitor?.workArea)));
        }
      }
      prepareContent?.(entry);
      await nextTick();
      await Promise.race([
        aux.stylesReady,
        aux.closed.then(() => { throw new Error('Auxiliary window closed before presentation'); }),
      ]);
      // Lay out the shared Vue tree before exposing the native window.
      aux.mount.getBoundingClientRect();
      await context.native?.setTitle(aux.document.title);
      await context.native?.show();
      await context.native?.setFocus();
      return entry;
    } catch (error) {
      // Keep moved documents reachable if native presentation fails partway.
      const layout = store.windowLayouts[id];
      if (layout) {
        for (const tab of layoutPanes(layout.layout).flatMap(pane => pane.tabs)) {
          store.moveTabToWindow(tab, 'main', { paneId: store.windowLayouts.main.activePaneId, side: 'center' });
        }
      }
      entry.disposeListener?.();
      entries.delete(id);
      if (!entry.destroyed) {
        entry.destroyed = true;
        aux.close();
        await context.native?.destroy().catch(() => {});
      }
      throw error;
    }
  }

  const opening = new Map<string, Promise<AuxiliaryEntry>>();
  async function open(id: string, kind: AuxiliaryEntry['kind'], title: string, position?: { x: number; y: number }, prepareContent?: (entry: AuxiliaryEntry) => void) {
    const pending = opening.get(id);
    if (pending) return pending;
    const existing = entries.get(id);
    if (existing) {
      await existing.context.native?.unminimize();
      await existing.context.native?.setFocus();
      return existing;
    }
    const task = create(id, kind, title, position, prepareContent).finally(() => opening.delete(id));
    opening.set(id, task);
    return task;
  }

  async function closeAll() {
    await Promise.allSettled([...opening.values()]);
    if (!(await prepareClose())) return false;
    for (const id of [...entries.keys()]) if (!(await close(id))) return false;
    return true;
  }

  watch(() => Object.keys(store.windowLayouts), (_, previous) => {
    for (const entry of entries.values()) {
      if (entry.kind === 'tab' && previous.includes(entry.id) && !store.windowLayouts[entry.id] && !entry.closing) void destroy(entry).catch(store.report);
    }
  }, { flush: 'post' });

  onBeforeUnmount(() => {
    for (const entry of entries.values()) {
      entry.destroyed = true;
      entry.disposeListener?.();
      entry.aux.close();
      void entry.context.native?.destroy().catch(store.report);
    }
    entries.clear();
  });
  return { entries, open, close, closeAll };
}
