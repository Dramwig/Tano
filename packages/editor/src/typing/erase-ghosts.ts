
/* Erased text, drawn as an inert copy in the overlay layer: the letters
 * shrink toward the caret and fade. A new deletion interrupts the previous
 * ghost (it hurries out) instead of stacking; a held key shows none at all
 * (see typing-motion.ts). */

export type GhostCapture = { rect: DOMRect; content: DocumentFragment; style: CSSStyleDeclaration; collapse: 'start' | 'center' };

/** Read what a DOM range looks like now, before the browser removes it. */
export function captureGhost(root: HTMLElement, range: Range, collapse: GhostCapture['collapse'], maxText: number): GhostCapture | null {
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
  const text = range.toString();
  if (!text.trim() || text.length > maxText || text.includes('\n')) return null;
  const rect = lineRect(range);
  if (!rect) return null;
  const anchor = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer as Element;
  if (!anchor || anchor.closest('[contenteditable="false"]')) return null;
  const content = range.cloneContents();
  for (const node of content.querySelectorAll('.tano-typed')) node.classList.remove('tano-typed', 'tano-typed-ime');
  return { rect, content, style: getComputedStyle(anchor), collapse };
}

function lineRect(range: Range): DOMRect | null {
  const rects = [...range.getClientRects()].filter(rect => rect.width > 0.5 && rect.height > 0);
  if (!rects.length) return null;
  const first = rects[0]!;
  let left = first.left, right = first.right, top = first.top, bottom = first.bottom;
  for (const rect of rects.slice(1)) {
    // Text that wraps over two lines would be redrawn on one; skip it.
    if (Math.abs(rect.top - first.top) > first.height / 2) return null;
    left = Math.min(left, rect.left); right = Math.max(right, rect.right);
    top = Math.min(top, rect.top); bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

export class EraseGhosts {
  private fades = new Set<Animation>();

  /** Draw a ghost for text that was just deleted. */
  play(layer: HTMLElement, ghost: GhostCapture) {
    this.hurry();
    const element = this.place(layer, ghost);
    element.style.transformOrigin = ghost.collapse === 'start' ? '0% 60%' : '50% 60%';
    const animation = element.animate([
      { opacity: 1, scale: '1', translate: '0 0', filter: 'blur(0px)' },
      { opacity: 0, scale: ghost.collapse === 'start' ? '0.55' : '0.85', translate: '0 -0.12em', filter: 'blur(2px)' },
    ], { duration: 240, easing: 'cubic-bezier(0.32, 0, 0.24, 1)', fill: 'forwards' });
    this.fades.add(animation);
    const remove = () => { element.remove(); this.fades.delete(animation); };
    animation.onfinish = remove;
    animation.oncancel = remove;
    window.setTimeout(remove, 600);
  }

  /** Earlier ghosts belong to a finished gesture: let them go quickly. */
  hurry() {
    for (const fade of this.fades) fade.playbackRate = 2.5;
  }

  /** Remove every ghost now (a key started repeating). */
  finish() {
    for (const fade of [...this.fades]) fade.finish();
  }

  clear() {
    for (const fade of [...this.fades]) fade.cancel();
  }

  private place(layer: HTMLElement, ghost: GhostCapture) {
    const { rect, style } = ghost;
    const element = document.createElement('span');
    element.className = 'tano-type-ghost';
    element.append(ghost.content);
    Object.assign(element.style, {
      left: '0px', top: '0px', height: `${rect.height}px`, lineHeight: `${rect.height}px`,
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
      fontFeatureSettings: style.fontFeatureSettings, letterSpacing: style.letterSpacing, color: style.color,
    });
    layer.append(element);
    const placed = element.getBoundingClientRect();
    element.style.left = `${rect.left - placed.left}px`;
    element.style.top = `${rect.top - placed.top}px`;
    return element;
  }
}
