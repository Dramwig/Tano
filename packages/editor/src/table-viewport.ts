import type { Node } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { columnResizingPluginKey, TableMap, TableView } from '@milkdown/kit/prose/tables';
import type { EditorView, ViewMutationRecord } from '@milkdown/kit/prose/view';
import { defaultTableColumnWidth } from '@tano/protocol';
import { animate } from 'motion/mini';

const viewports = new WeakMap<EditorView, Set<TableViewport>>();
let viewportId = 0;
type ViewportStyles = Partial<Record<'width' | 'marginLeft' | 'marginRight', number>>;

/** Keep the content width independent of the visible, horizontally scrollable viewport. */
export class TableViewport extends TableView {
  private wrapper: HTMLDivElement;
  private frame: number | undefined;
  private observer: ResizeObserver | undefined;
  private observedParent: HTMLElement | undefined;
  private surface: HTMLElement;
  private scrollbar: HTMLDivElement;
  private thumb: HTMLDivElement;
  private drag: { id: number; x: number; scroll: number; scale: number } | undefined;
  private layoutState: { annotated: boolean; target: string } | undefined;
  private motions: ReturnType<typeof animate>[] | undefined;
  private motionFrame: number | undefined;

  constructor(node: Node, minimumWidth: number, private view: EditorView) {
    super(node, minimumWidth);
    this.wrapper = this.dom;
    this.wrapper.id = `tano-table-scroll-area-${++viewportId}`;
    this.dom = document.createElement('div');
    this.dom.className = 'tano-table-viewport';
    this.dom.append(this.wrapper);
    this.scrollbar = document.createElement('div');
    this.scrollbar.className = 'tano-table-scrollbar';
    this.scrollbar.contentEditable = 'false';
    this.scrollbar.tabIndex = 0;
    this.scrollbar.setAttribute('role', 'scrollbar');
    this.scrollbar.setAttribute('aria-label', '表格横向滚动');
    this.scrollbar.setAttribute('aria-orientation', 'horizontal');
    this.scrollbar.setAttribute('aria-controls', this.wrapper.id);
    this.scrollbar.setAttribute('aria-valuemin', '0');
    this.thumb = document.createElement('div');
    this.thumb.className = 'tano-table-scroll-thumb';
    this.scrollbar.append(this.thumb);
    this.dom.append(this.scrollbar);
    this.scrollbar.addEventListener('pointerdown', this.startScroll);
    this.scrollbar.addEventListener('pointermove', this.moveScroll);
    this.scrollbar.addEventListener('pointerup', this.endScroll);
    this.scrollbar.addEventListener('pointercancel', this.endScroll);
    this.scrollbar.addEventListener('lostpointercapture', this.endScroll);
    this.scrollbar.addEventListener('keydown', this.keyScroll);
    this.surface = view.dom.closest<HTMLElement>('.editor-scroll') ?? view.dom;
    const entries = viewports.get(view) ?? new Set<TableViewport>();
    entries.add(this);
    viewports.set(view, entries);
    this.wrapper.addEventListener('scroll', this.edges);
    window.addEventListener('resize', this.schedule);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.schedule);
      for (const element of [this.table, view.dom, this.surface]) this.observer.observe(element);
    }
    this.schedule();
  }

  schedule = () => {
    if (this.frame !== undefined) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = undefined;
      this.layout();
    });
  };

  private layout() {
    if (!this.dom.isConnected) return;
    const prose = this.view.dom.getBoundingClientRect();
    const surface = this.surface.getBoundingClientRect();
    const parent = this.dom.parentElement!;
    if (this.observer && this.observedParent !== parent) {
      if (this.observedParent) this.observer.unobserve(this.observedParent);
      this.observer.observe(parent);
      this.observedParent = parent;
    }
    const container = parent.getBoundingClientRect();
    const style = getComputedStyle(parent);
    const inset = (value: string) => Number.parseFloat(value) || 0;
    const insetLeft = inset(style.paddingLeft) + inset(style.borderLeftWidth);
    const insetRight = inset(style.paddingRight) + inset(style.borderRightWidth);
    const originLeft = parent === this.view.dom ? prose.left : container.left + insetLeft;
    const baseWidth = parent === this.view.dom ? prose.width : Math.max(0, container.width - insetLeft - insetRight);
    // Keep the frame on the same rail as top-level text and framed blocks.
    // Leave this space inside the scroll area so a selected table's outline fits too.
    const frameInset = parent === this.view.dom ? inset(style.getPropertyValue('--tano-block-frame-inset')) : 0;
    const frameWidth = Math.max(0, baseWidth - frameInset * 2);
    this.fitColumns(frameWidth);
    // Reserve the review gutter only for annotations belonging to this table.
    const annotated = !!this.table.querySelector('[data-comment-id], [data-suggestion-id]');
    const contentWidth = this.table.getBoundingClientRect().width;
    // A nested table scrolls inside its block container instead of escaping/clipping its children.
    const contained = !!parent.closest('.tano-enhanced');
    const availableLeft = contained ? originLeft : Math.min(originLeft, surface.left);
    const availableRight = contained ? originLeft + baseWidth : Math.max(originLeft + baseWidth, surface.left + this.surface.clientWidth);
    const width = annotated || contentWidth <= frameWidth ? baseWidth
      : Math.max(baseWidth, availableRight - availableLeft);
    const left = Math.max(availableLeft, Math.min(originLeft - (width - baseWidth) / 2, availableRight - width));
    this.applyLayout(annotated, [
      { element: this.dom, styles: { width, marginLeft: annotated ? 0 : left - originLeft } },
      { element: this.table, styles: { marginLeft: frameInset + (annotated ? 0 : originLeft - left), marginRight: frameInset + (annotated ? 0 : left + width - originLeft - baseWidth) } },
      { element: this.scrollbar, styles: { width: frameWidth, marginLeft: frameInset + (annotated ? 0 : originLeft - left) } },
    ]);
    this.dom.classList.toggle('has-comments', annotated);
    this.edges();
    this.dom.dispatchEvent(new Event('tano-table-layout', { bubbles: true }));
  }

  private fitColumns(containerWidth: number) {
    if (!this.node.attrs.autoWidth || containerWidth <= 0 || columnResizingPluginKey.getState(this.view.state)?.dragging ||
        this.view.dom.parentElement?.classList.contains('tano-table-dragging')) return;
    const map = TableMap.get(this.node);
    const style = getComputedStyle(this.table);
    const borders = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0);
    const total = Math.max(map.width * defaultTableColumnWidth, Math.floor(containerWidth - borders));
    const width = Math.floor(total / map.width);
    const remainder = total % map.width;
    const resolved = this.view.state.doc.resolve(this.view.posAtDOM(this.contentDOM, 0));
    let depth = resolved.depth;
    while (depth > 0 && resolved.node(depth).type.name !== 'table') depth--;
    if (!depth) return;
    const start = resolved.start(depth);
    const tr = this.view.state.tr;
    for (const offset of new Set(map.map)) {
      const cell = this.node.nodeAt(offset)!;
      const column = map.colCount(offset);
      const colwidth = Array.from({ length: cell.attrs.colspan }, (_, i) => width + (column + i < remainder ? 1 : 0));
      if (JSON.stringify(cell.attrs.colwidth) !== JSON.stringify(colwidth))
        tr.setNodeMarkup(start + offset, undefined, { ...cell.attrs, colwidth });
    }
    if (tr.docChanged) this.view.dispatch(tr.setMeta('addToHistory', false));
  }

  private applyLayout(annotated: boolean, targets: { element: HTMLElement; styles: ViewportStyles }[]) {
    const target = JSON.stringify(targets.map(entry => entry.styles));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.layoutState?.target === target && this.layoutState.annotated === annotated && !(reduceMotion && this.motions)) return;
    const transition = this.layoutState !== undefined && this.layoutState.annotated !== annotated && !reduceMotion;
    const frames = targets.map(({ element, styles }) => {
      const computed = getComputedStyle(element);
      return Object.fromEntries(Object.entries(styles).flatMap(([property, value]) => {
        const from = parseFloat(computed[property as keyof ViewportStyles]) || 0;
        return Math.abs(from - value) > 0.01 ? [[property, [`${from}px`, `${value}px`]]] : [];
      }));
    });
    this.stopMotion();
    for (const { element, styles } of targets) {
      for (const [property, value] of Object.entries(styles)) element.style[property as keyof ViewportStyles] = `${value}px`;
    }
    this.layoutState = { annotated, target };
    if (!transition || typeof this.dom.animate !== 'function') return;
    // Animate the viewport and its compensating margins together; cell text stays unscaled.
    const motions = targets.flatMap(({ element }, index) => Object.keys(frames[index]!).length
      ? [animate(element, frames[index]!, { duration: 0.24, ease: [0.22, 1, 0.36, 1] })] : []);
    if (!motions.length) return;
    this.motions = motions;
    this.trackMotion();
    void Promise.all(motions.map(motion => motion.finished)).then(() => {
      if (this.motions !== motions) return;
      this.stopMotion();
      this.edges();
      this.dom.dispatchEvent(new Event('tano-table-layout', { bubbles: true }));
    });
  }

  private trackMotion = () => {
    this.motionFrame = window.requestAnimationFrame(() => {
      this.motionFrame = undefined;
      if (!this.motions) return;
      this.edges();
      this.dom.dispatchEvent(new Event('tano-table-layout', { bubbles: true }));
      this.trackMotion();
    });
  };

  private stopMotion() {
    this.motions?.forEach(motion => motion.stop());
    this.motions = undefined;
    if (this.motionFrame !== undefined) window.cancelAnimationFrame(this.motionFrame);
    this.motionFrame = undefined;
  }

  private edges = () => {
    const maximum = Math.max(0, this.wrapper.scrollWidth - this.wrapper.clientWidth);
    this.scrollbar.hidden = maximum <= 1;
    const track = this.scrollbar.clientWidth;
    const size = Math.min(track, Math.max(32, track * this.wrapper.clientWidth / Math.max(1, this.wrapper.scrollWidth)));
    this.thumb.style.width = `${size}px`;
    this.thumb.style.transform = `translateX(${maximum ? (track - size) * this.wrapper.scrollLeft / maximum : 0}px)`;
    this.scrollbar.setAttribute('aria-valuemax', String(Math.round(maximum)));
    this.scrollbar.setAttribute('aria-valuenow', String(Math.round(this.wrapper.scrollLeft)));
    this.dom.classList.toggle('can-scroll-left', this.wrapper.scrollLeft > 1);
    this.dom.classList.toggle('can-scroll-right', this.wrapper.scrollLeft < maximum - 1);
  };

  private startScroll = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const track = this.scrollbar.getBoundingClientRect();
    const thumb = this.thumb.getBoundingClientRect();
    const maximum = this.wrapper.scrollWidth - this.wrapper.clientWidth;
    const scale = maximum / Math.max(1, track.width - thumb.width);
    if (event.target !== this.thumb) this.wrapper.scrollLeft = (event.clientX - track.left - thumb.width / 2) * scale;
    this.drag = { id: event.pointerId, x: event.clientX, scroll: this.wrapper.scrollLeft, scale };
    this.scrollbar.setPointerCapture(event.pointerId);
    this.scrollbar.classList.add('is-dragging');
    this.edges();
  };

  private moveScroll = (event: PointerEvent) => {
    if (this.drag?.id !== event.pointerId) return;
    this.wrapper.scrollLeft = this.drag.scroll + (event.clientX - this.drag.x) * this.drag.scale;
    this.edges();
  };

  private endScroll = () => {
    this.drag = undefined;
    this.scrollbar.classList.remove('is-dragging');
  };

  private keyScroll = (event: KeyboardEvent) => {
    const maximum = this.wrapper.scrollWidth - this.wrapper.clientWidth;
    const positions: Record<string, number> = {
      ArrowLeft: this.wrapper.scrollLeft - 48, ArrowRight: this.wrapper.scrollLeft + 48,
      PageUp: this.wrapper.scrollLeft - this.wrapper.clientWidth,
      PageDown: this.wrapper.scrollLeft + this.wrapper.clientWidth,
      Home: 0, End: maximum,
    };
    const next = positions[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.wrapper.scrollLeft = next;
    this.edges();
  };

  stopEvent(event: Event) { return this.scrollbar.contains(event.target as globalThis.Node); }

  override update(node: Node) {
    const updated = super.update(node);
    if (updated) this.schedule();
    return updated;
  }

  override ignoreMutation(record: ViewMutationRecord) {
    return (record.type === 'attributes' && (record.target === this.dom || record.target === this.wrapper))
      || this.scrollbar.contains(record.target)
      || super.ignoreMutation(record);
  }

  destroy() {
    this.stopMotion();
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.wrapper.removeEventListener('scroll', this.edges);
    window.removeEventListener('resize', this.schedule);
    viewports.get(this.view)?.delete(this);
  }
}

export function tableViewports() {
  return new Plugin({
    view(view) {
      const update = () => viewports.get(view)?.forEach(viewport => viewport.schedule());
      update();
      return { update };
    },
  });
}
