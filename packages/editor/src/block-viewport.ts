import type { EditorView } from '@milkdown/kit/prose/view';

/** Browser-maintained visibility, shared by drag and fold controls. No scroll-time
 * document walk or offscreen geometry reads. The model always retains all blocks. */
export class BlockViewport {
  readonly visible = new Set<number>();
  private elements = new Map<number, Element>();
  private positions = new Map<Element, number>();
  private observer?: IntersectionObserver;
  private indexedDoc?: EditorView['state']['doc'];

  constructor(private view: EditorView, changed: () => void) {
    if (typeof IntersectionObserver !== 'undefined') this.observer = new IntersectionObserver(records => {
      for (const record of records) {
        const pos = this.positions.get(record.target);
        if (pos === undefined) continue;
        if (record.isIntersecting) this.visible.add(pos);
        else this.visible.delete(pos);
      }
      changed();
    }, { root: view.dom.closest('.document-layout'), rootMargin: '200px' });
  }

  update(positions: Iterable<number>) {
    const sameDoc = this.indexedDoc === this.view.state.doc;
    const elements = new Map<number, Element>();
    const reverse = new Map<Element, number>();
    const visible = new Set<number>();
    for (const pos of positions) {
      if (elements.has(pos)) continue;
      const cached = this.elements.get(pos);
      const dom = sameDoc && cached?.isConnected ? cached : this.view.nodeDOM(pos);
      if (!(dom instanceof Element)) continue;
      elements.set(pos, dom); reverse.set(dom, pos);
      const previous = this.positions.get(dom);
      if (!this.observer || (previous !== undefined && this.visible.has(previous))) visible.add(pos);
      if (previous === undefined) this.observer?.observe(dom);
    }
    for (const dom of this.positions.keys()) if (!reverse.has(dom)) this.observer?.unobserve(dom);
    this.elements = elements; this.positions = reverse;
    this.indexedDoc = this.view.state.doc;
    this.visible.clear(); visible.forEach(pos => this.visible.add(pos));
  }

  element(pos: number) { return this.elements.get(pos) ?? null; }

  detached() { return [...this.elements.values()].some(element => !element.isConnected); }

  containing(target: Element) {
    const positions: number[] = [];
    for (let element: Element | null = target; element && element !== this.view.dom; element = element.parentElement) {
      const pos = this.positions.get(element);
      if (pos !== undefined) positions.push(pos);
    }
    return positions;
  }

  destroy() { this.observer?.disconnect(); this.elements.clear(); this.positions.clear(); this.visible.clear(); }
}
