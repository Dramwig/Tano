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
}

export function captureModeViewport(editor: ModeEditor, scroll: HTMLElement): ModeViewport | null {
  const selection = editor.captureModeSelection();
  if (!selection) return null;
  const top = editor.modeCursorTop();
  return { selection, top: top === null ? null : top - scroll.getBoundingClientRect().top, scrollTop: scroll.scrollTop };
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
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (interrupted || !current()) return;
      if (frame === 0) continue;
      const top = editor.modeCursorTop();
      if (bookmark.top !== null && top !== null)
        scroll.scrollTop += top - scroll.getBoundingClientRect().top - bookmark.top;
      else scroll.scrollTop = bookmark.scrollTop;
    }
  } finally {
    for (const event of events) scroll.ownerDocument.removeEventListener(event, interrupt, true);
  }
}
