import { inject, provide, type InjectionKey } from 'vue';

const editorWindowKey: InjectionKey<Window> = Symbol('tano-editor-window');

export function provideEditorWindow(target: Window) {
  provide(editorWindowKey, target);
}

export function useEditorWindow(): Window {
  return inject(editorWindowKey, window);
}
