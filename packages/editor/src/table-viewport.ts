import type { Node } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { TableView } from '@milkdown/kit/prose/tables';
import type { EditorView, ViewMutationRecord } from '@milkdown/kit/prose/view';

const viewports = new WeakMap<EditorView, Set<TableViewport>>();
let viewportId = 0;

/** Keep the content width independent of the visible, horizontally scrollable viewport. */
export class TableViewport extends TableView {
  private wrapper: HTMLDivElement;
  private frame: number | undefined;
  private observer: ResizeObserver | undefined;
  private surface: HTMLElement;
  private scrollbar: HTMLDivElement;
  private thumb: HTMLDivElement;
  private drag: { id: number; x: number; scroll: number; scale: number } | undefined;

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
    const container = parent.getBoundingClientRect();
    const style = getComputedStyle(parent);
    const inset = (value: string) => Number.parseFloat(value) || 0;
    const insetLeft = inset(style.paddingLeft) + inset(style.borderLeftWidth);
    const insetRight = inset(style.paddingRight) + inset(style.borderRightWidth);
    const originLeft = parent === this.view.dom ? prose.left : container.left + insetLeft;
    const baseWidth = parent === this.view.dom ? prose.width : Math.max(0, container.width - insetLeft - insetRight);
    const annotated = !!this.table.querySelector('[data-comment-id]');
    const contentWidth = this.table.getBoundingClientRect().width;
    // A nested table scrolls inside its block container instead of escaping/clipping its children.
    const contained = !!parent.closest('.tano-enhanced');
    const availableLeft = contained ? originLeft : Math.min(originLeft, surface.left);
    const availableRight = contained ? originLeft + baseWidth : Math.max(originLeft + baseWidth, surface.left + this.surface.clientWidth);
    const width = annotated || contentWidth <= baseWidth ? baseWidth
      : Math.max(baseWidth, availableRight - availableLeft);
    const left = Math.max(availableLeft, Math.min(originLeft - (width - baseWidth) / 2, availableRight - width));
    this.dom.style.width = `${width}px`;
    this.dom.style.marginLeft = `${annotated ? 0 : left - originLeft}px`;
    this.table.style.marginLeft = `${annotated ? 0 : originLeft - left}px`;
    this.table.style.marginRight = `${annotated ? 0 : left + width - originLeft - baseWidth}px`;
    this.scrollbar.style.width = `${baseWidth}px`;
    this.scrollbar.style.marginLeft = `${annotated ? 0 : originLeft - left}px`;
    this.dom.classList.toggle('has-comments', annotated);
    this.edges();
    this.dom.dispatchEvent(new Event('tano-table-layout', { bubbles: true }));
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
