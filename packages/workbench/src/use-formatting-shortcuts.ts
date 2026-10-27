import { computed, inject } from 'vue';
import type { Ref } from 'vue';
import { defaultShortcutBindings, shortcutKeys } from './shortcuts';
import type { ShortcutBindings, ShortcutId } from './shortcuts';

export function useFormattingShortcuts() {
  const bindings = inject<Ref<ShortcutBindings> | null>('tano-shortcut-bindings', null);
  return computed(() => Object.fromEntries(['bold', 'italic', 'code', 'strikethrough'].map(id =>
    [id, shortcutKeys((bindings?.value ?? defaultShortcutBindings)[id as ShortcutId]).join(',')])));
}
