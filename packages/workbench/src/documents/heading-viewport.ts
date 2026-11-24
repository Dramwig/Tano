/** Cache headings in scroll-content coordinates; scrolling reads only scrollTop
 * and searches the index. Invalidation is owned by the document layout. */
export class HeadingViewport {
  private dirty = true;
  private root?: HTMLElement;
  private scroll?: HTMLElement;
  private positions: { top: number; index: number }[] = [];

  invalidate() { this.dirty = true; }

  active(root: HTMLElement, scroll: HTMLElement, inset = 100, position = scroll.scrollTop) {
    if (this.dirty || this.root !== root || this.scroll !== scroll) {
      this.root = root; this.scroll = scroll; this.dirty = false;
      // Cache positions in the scroll container's content coordinates. Reading
      // root/viewport rectangles on every scroll flushed pending control styles.
      const origin = scroll.getBoundingClientRect().top - position;
      this.positions = [...root.querySelectorAll<HTMLElement>('.tano-prose :is(h1,h2,h3,h4,h5,h6)')]
        .flatMap((heading, index) => heading.getClientRects().length
          ? [{ top: heading.getBoundingClientRect().top - origin, index }] : [])
        .sort((a, b) => a.top - b.top);
      // Columns may place headings out of vertical order. Preserve document order
      // when several headings precede the reading line, including folded content.
      let greatest = 0;
      for (const item of this.positions) item.index = greatest = Math.max(greatest, item.index);
    }
    const threshold = position + inset;
    let low = 0, high = this.positions.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.positions[mid]!.top <= threshold) low = mid + 1;
      else high = mid;
    }
    return low ? this.positions[low - 1]!.index : 0;
  }
}
