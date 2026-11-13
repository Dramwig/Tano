import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, type Transaction } from '@milkdown/kit/prose/state';
import { columnResizingPluginKey, TableMap, TableView } from '@milkdown/kit/prose/tables';
import type { EditorView, ViewMutationRecord } from '@milkdown/kit/prose/view';
import { defaultTableColumnWidth } from '@tano/protocol';
import { animate } from 'motion/mini';
import { springEasing } from './motion';

const viewports = new WeakMap<EditorView, Set<TableViewport>>();
const queues = new WeakMap<EditorView, { pending: Set<TableViewport>; frame?: number }>();
let viewportId = 0;
type ViewportStyles = Partial<Record<'width' | 'marginLeft' | 'marginRight', number>>;
interface ViewportLayout {
  annotated: boolean;
  target: string;
  targets: { element: HTMLElement; styles: ViewportStyles }[];
  frames: Record<string, string[]>[];
}
interface ScrollbarGeometry {
  maximum: number;
  position: number;
  size: number;
  offset: number;
}

/** Keep the content width independent of the visible, horizontally scrollable viewport. */
export class TableViewport extends TableView {
  private wrapper: HTMLDivElement;
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
    let queue = queues.get(this.view);
    if (!queue) { queue = { pending: new Set() }; queues.set(this.view, queue); }
    queue.pending.add(this);
    if (queue.frame !== undefined) return;
    const batch = queue;
    batch.frame = window.requestAnimationFrame(() => {
      batch.frame = undefined;
      if (this.view.isDestroyed) { batch.pending.clear(); return; }
      const pending = [...batch.pending].filter(item => item.dom.isConnected);
      batch.pending.clear();
      // All automatic widths belong to one presentation transaction. Dispatching
      // once per table repeatedly rebuilt document decorations and block controls.
      const tr = this.view.state.tr;
      for (const item of pending) item.fitColumns(item.frameWidth(), tr);
      if (tr.docChanged) {
        this.view.dispatch(tr.setMeta('addToHistory', false));
        for (const item of pending) item.schedule();
      } else {
        // Read every table before writing any styles. A write/read pair per
        // table forces the browser to lay out the entire document repeatedly.
        const layouts = pending.map(item => ({ item, layout: item.measureLayout() }));
        for (const { item, layout } of layouts) if (layout) item.applyLayout(layout);
        const scrollbars = pending.map(item => ({ item, geometry: item.measureEdges() }));
        for (const { item, geometry } of scrollbars) item.applyEdges(geometry);
        for (const item of pending) item.dom.dispatchEvent(new Event('tano-table-layout', { bubbles: true }));
      }
    });
  };

  private frameWidth() {
    const parent = this.dom.parentElement!;
    const style = getComputedStyle(parent);
    const inset = (value: string) => Number.parseFloat(value) || 0;
    const width = parent.getBoundingClientRect().width;
    return parent === this.view.dom
      ? width - inset(style.getPropertyValue('--tano-block-frame-inset')) * 2
      : Math.max(0, width - inset(style.paddingLeft) - inset(style.paddingRight)
        - inset(style.borderLeftWidth) - inset(style.borderRightWidth));
  }

  private measureLayout(): ViewportLayout | undefined {
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
    const targets = [
      { element: this.dom, styles: { width, marginLeft: annotated ? 0 : left - originLeft } },
      { element: this.table, styles: { marginLeft: frameInset + (annotated ? 0 : originLeft - left), marginRight: frameInset + (annotated ? 0 : left + width - originLeft - baseWidth) } },
      { element: this.scrollbar, styles: { width: frameWidth, marginLeft: frameInset + (annotated ? 0 : originLeft - left) } },
    ];
    const target = JSON.stringify(targets.map(entry => entry.styles));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.layoutState?.target === target && this.layoutState.annotated === annotated && !(reduceMotion && this.motions)) return;
    const transition = this.layoutState !== undefined && this.layoutState.annotated !== annotated && !reduceMotion;
    const frames = transition ? targets.map(({ element, styles }) => {
      const computed = getComputedStyle(element);
      return Object.fromEntries(Object.entries(styles).flatMap(([property, value]) => {
        const from = parseFloat(computed[property as keyof ViewportStyles]) || 0;
        return Math.abs(from - value) > 0.01 ? [[property, [`${from}px`, `${value}px`]]] : [];
      }));
    }) : [];
    return { annotated, target, targets, frames };
  }

  private fitColumns(containerWidth: number, tr: Transaction) {
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
    for (const offset of new Set(map.map)) {
      const cell = this.node.nodeAt(offset)!;
      const column = map.colCount(offset);
      const colwidth = Array.from({ length: cell.attrs.colspan }, (_, i) => width + (column + i < remainder ? 1 : 0));
      if (JSON.stringify(cell.attrs.colwidth) !== JSON.stringify(colwidth))
        tr.setNodeMarkup(start + offset, undefined, { ...cell.attrs, colwidth });
    }
  }

  private applyLayout({ annotated, target, targets, frames }: ViewportLayout) {
    this.stopMotion();
    for (const { element, styles } of targets) {
      for (const [property, value] of Object.entries(styles)) element.style[property as keyof ViewportStyles] = `${value}px`;
    }
    this.dom.classList.toggle('has-comments', annotated);
    this.layoutState = { annotated, target };
    if (!frames.length || typeof this.dom.animate !== 'function') return;
    // Animate the viewport and its compensating margins together; cell text stays unscaled.
    const motions = targets.flatMap(({ element }, index) => Object.keys(frames[index]!).length
      ? [animate(element, frames[index]!, { duration: 0.24, ease: springEasing('smooth') })] : []);
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
    this.applyEdges(this.measureEdges());
  };

  private measureEdges(): ScrollbarGeometry {
    const content = this.wrapper.scrollWidth;
    const viewport = this.wrapper.clientWidth;
    const position = this.wrapper.scrollLeft;
    const maximum = Math.max(0, content - viewport);
    // Layout sets an explicit track width, including while the bar is hidden.
    // Reading that width avoids revealing the bar just to measure it again.
    const track = Number.parseFloat(this.scrollbar.style.width) || this.scrollbar.clientWidth;
    const size = Math.min(track, Math.max(32, track * viewport / Math.max(1, content)));
    return { maximum, position, size, offset: maximum ? (track - size) * position / maximum : 0 };
  }

  private applyEdges({ maximum, position, size, offset }: ScrollbarGeometry) {
    this.scrollbar.hidden = maximum <= 1;
    this.thumb.style.width = `${size}px`;
    this.thumb.style.transform = `translateX(${offset}px)`;
    this.scrollbar.setAttribute('aria-valuemax', String(Math.round(maximum)));
    this.scrollbar.setAttribute('aria-valuenow', String(Math.round(position)));
    this.dom.classList.toggle('can-scroll-left', position > 1);
    this.dom.classList.toggle('can-scroll-right', position < maximum - 1);
  }

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
    const queue = queues.get(this.view);
    queue?.pending.delete(this);
    if (queue && !queue.pending.size && queue.frame !== undefined) {
      window.cancelAnimationFrame(queue.frame);
      queue.frame = undefined;
    }
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
      return { update(next, previous) { if (next.state.doc !== previous.doc) update(); } };
    },
  });
}
