import { ownerWindow } from '@tano/editor/dom-realm';
import type { ModeSelection } from '@tano/editor/mode-selection';

export interface ModeEditor {
  captureModeSelection(): ModeSelection | null;
  restoreModeSelection(selection: ModeSelection, focus?: boolean): void;
  modeCursorTop(): number | null;
}

export interface ModeViewport {
  selection: ModeSelection;
  top: number | null;
  scrollTop: number;
  height?: number;
}

export function captureModeViewport(editor: ModeEditor, scroll: HTMLElement): ModeViewport | null {
  const selection = editor.captureModeSelection();
  if (!selection) return null;
  const top = editor.modeCursorTop();
  return { selection, top: top === null ? null : top - scroll.getBoundingClientRect().top, scrollTop: scroll.scrollTop, height: scroll.clientHeight };
}

export async function restoreModeViewport(
  editor: ModeEditor, scroll: HTMLElement, bookmark: ModeViewport, focus: boolean, current: () => boolean,
) {
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  for (const event of events) scroll.ownerDocument.addEventListener(event, interrupt, { capture: true, passive: true });
  try {
    if (!current()) return;
    editor.restoreModeSelection(bookmark.selection, focus);
    // CodeMirror first renders the selected offscreen line in its measure pass.
    // A following frame accounts for that pass and ProseMirror's source reveal.
    for (let frame = 0; frame < 4; frame++) {
      await new Promise<void>(resolve => ownerWindow(scroll).requestAnimationFrame(() => resolve()));
      if (interrupted || !current()) return;
      if (frame === 0) continue;
      const top = editor.modeCursorTop();
      if (bookmark.top !== null && top !== null) {
        // Keep a previously visible caret inside a shorter destination pane.
        const wasVisible = bookmark.top >= 0 && bookmark.top < (bookmark.height ?? 0);
        const desiredTop = wasVisible && scroll.clientHeight > 0
          ? Math.min(bookmark.top, Math.max(0, scroll.clientHeight - 24)) : bookmark.top;
        scroll.scrollTop += top - scroll.getBoundingClientRect().top - desiredTop;
      } else scroll.scrollTop = bookmark.scrollTop;
    }
  } finally {
    for (const event of events) scroll.ownerDocument.removeEventListener(event, interrupt, true);
  }
}
