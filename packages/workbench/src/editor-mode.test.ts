// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { captureModeViewport, restoreModeViewport } from './editor-mode';

afterEach(() => { vi.unstubAllGlobals(); });

function fixture() {
  const scroll = document.createElement('div');
  scroll.getBoundingClientRect = () => ({ top: 50 } as DOMRect);
  scroll.scrollTop = 200;
  const editor = {
    captureModeSelection: () => ({ anchor: 30, head: 10 }),
    restoreModeSelection: vi.fn(),
    modeCursorTop: () => 650 - scroll.scrollTop,
  };
  return { scroll, editor };
}

it('restores the caret height relative to its pane instead of copying the old scroll offset', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  const { scroll, editor } = fixture();
  const bookmark = captureModeViewport(editor, scroll)!;
  expect(bookmark).toEqual({ selection: { anchor: 30, head: 10 }, top: 400, scrollTop: 200 });
  editor.modeCursorTop = () => 950 - scroll.scrollTop;
  await restoreModeViewport(editor, scroll, bookmark, false, () => true);
  expect(scroll.scrollTop).toBe(500);
  expect(editor.restoreModeSelection).toHaveBeenCalledWith(bookmark.selection, false);
});

it.each(['stale', 'user input'])('stops aligning the viewport after %s', async reason => {
  const { scroll, editor } = fixture();
  const bookmark = captureModeViewport(editor, scroll)!;
  let current = true;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    if (reason === 'stale') current = false;
    else document.dispatchEvent(new Event('wheel'));
    callback(0);
    return 0;
  });
  editor.modeCursorTop = () => 950 - scroll.scrollTop;
  await restoreModeViewport(editor, scroll, bookmark, true, () => current);
  expect(scroll.scrollTop).toBe(200);
});

it('does not restore a selection after the target pane has changed', async () => {
  const { scroll, editor } = fixture();
  await restoreModeViewport(editor, scroll, captureModeViewport(editor, scroll)!, true, () => false);
  expect(editor.restoreModeSelection).not.toHaveBeenCalled();
});
