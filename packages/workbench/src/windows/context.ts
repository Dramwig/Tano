import { inject, provide, type InjectionKey } from 'vue';
import { provideEditorWindow } from '@tano/editor/dom-context';
import { Window as NativeWindow, getCurrentWindow } from '@tauri-apps/api/window';

export interface WindowContext {
  id: string;
  label: string;
  window: Window;
  document: Document;
  overlays: HTMLElement;
  native: NativeWindow | undefined;
}

export const windowContextKey: InjectionKey<WindowContext> = Symbol('tano-window');

export async function createWindowContext(id: string, label: string, target: Window): Promise<WindowContext> {
  const native = '__TAURI_INTERNALS__' in window ? await NativeWindow.getByLabel(label) : undefined;
  if (native === null) throw new Error(`Auxiliary window ${label} is unavailable`);
  return {
    id, label, window: target, document: target.document,
    overlays: target.document.body,
    native,
  };
}

export function useWindowContext(): WindowContext {
  const inherited = inject(windowContextKey, undefined);
  if (inherited) {
    provideEditorWindow(inherited.window);
    return inherited;
  }
  const native = '__TAURI_INTERNALS__' in window ? getCurrentWindow() : undefined;
  const label = native?.label ?? 'main';
  const context = { id: label, label, window, document, overlays: document.body, native };
  provide(windowContextKey, context);
  provideEditorWindow(context.window);
  return context;
}
