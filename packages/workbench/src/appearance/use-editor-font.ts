import { computed, onScopeDispose, watch } from 'vue';
import { resolveEditorFont, type SplitFontSettings, type VisualFontChoice } from './editor-font';

/** Each renderer (including the separate settings window) owns its local faces. */
export function useEditorFontFamily(choice: () => VisualFontChoice, customName: () => string, split: () => SplitFontSettings | undefined) {
  const resolved = computed(() => resolveEditorFont(choice(), customName(), split()));
  let style: HTMLStyleElement | undefined;
  watch(() => resolved.value.fontFaces, css => {
    if (!css) { style?.remove(); style = undefined; return; }
    if (!style) {
      style = document.createElement('style');
      style.dataset.tanoEditorFonts = '';
      document.head.append(style);
    }
    style.textContent = css;
  }, { immediate: true, flush: 'sync' });
  onScopeDispose(() => style?.remove());
  return computed(() => resolved.value.family);
}
