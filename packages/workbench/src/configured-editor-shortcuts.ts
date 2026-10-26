import { defaultShortcutBindings, shortcutBindingFromEvent, shortcutDefinitions, shortcutKeys } from './shortcuts';
import type { ShortcutBindings } from './shortcuts';

/** Translate configured bindings before editor/native keymaps see the event. */
export function configuredEditorShortcuts(bindings: () => ShortcutBindings, enabled: () => boolean, activeEditor: () => HTMLElement | undefined, blockAction?: (id: string) => void) {
  const forwarded = new WeakSet<Event>();
  return (event: KeyboardEvent) => {
    if (forwarded.has(event) || !enabled() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('input, textarea, select, [role="dialog"], dialog')) return;
    const rich = target.closest('.ProseMirror');
    const source = target.closest('.cm-content');
    const menu = target.closest('.block-context-menu');
    const handle = target.closest('.tano-block-handle');
    const file = target.closest('.tree-scroll .tree-row[data-entry-id]');
    const editor = rich ?? ((menu || handle) ? activeEditor()?.querySelector('.ProseMirror') : null);
    const block = !!(menu || handle || editor?.querySelector('.ProseMirror-selectednode, .tano-block-selected'));
    const candidates = shortcutDefinitions.filter(item => 'context' in item && (
      item.context === 'file' ? !!file : item.context === 'block' ? block : item.context === 'rich' ? !!rich : !!(rich || source)
    ));
    const key = shortcutBindingFromEvent({ ...event, key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
      altKey: event.altKey, shiftKey: event.shiftKey, isComposing: event.isComposing, repeat: false });
    if (!key) return;
    const match = candidates.find(item => shortcutKeys(bindings()[item.id]).includes(key));
    const original = candidates.find(item => shortcutKeys(defaultShortcutBindings[item.id]).includes(key));
    if (!match && !original) return;
    if (match && 'context' in match && match.context === 'block' && blockAction) {
      event.preventDefault(); event.stopImmediatePropagation(); blockAction(match.id); return;
    }
    // Keep the original trusted event when its meaning has not changed.
    const sourceRedo = !!source && match?.id === 'redo';
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const sourceRedoKey = mac ? 'Mod+Shift+Z' : 'Mod+Y';
    if (match && shortcutKeys(defaultShortcutBindings[match.id]).includes(key) && (!sourceRedo || key === sourceRedoKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!match) return; // A removed or replaced default must not reach the old keymap.
    const binding = sourceRedo ? sourceRedoKey : shortcutKeys(defaultShortcutBindings[match.id])[0]!;
    const parts = binding.split('+'), name = parts.pop()!;
    const replacement = new KeyboardEvent('keydown', {
      key: name.length === 1 && !parts.includes('Shift') ? name.toLowerCase() : name,
      code: /^[A-Z]$/.test(name) ? `Key${name}` : /^\d$/.test(name) ? `Digit${name}` : name,
      ctrlKey: parts.includes('Mod') && !mac, metaKey: parts.includes('Mod') && mac,
      altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'), bubbles: true, cancelable: true,
    });
    forwarded.add(replacement);
    target.dispatchEvent(replacement);
  };
}
