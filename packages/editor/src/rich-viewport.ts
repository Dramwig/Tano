import { DOMSerializer, type Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from '@milkdown/kit/prose/view';

const viewportKey = new PluginKey<Set<number>>('tano-rich-viewport');
const controllers = new WeakMap<EditorView, RichViewport>();
const virtualTypes = ['paragraph', 'bullet_list', 'ordered_list', 'blockquote', 'code_block', 'math_block', 'table', 'tano_toggle', 'tano_tabs', 'tano_columns'];
const candidates = new WeakMap<Node, boolean>();
interface Size { height: number; marginTop: string; marginBottom: string; width: number }
interface Entry { node: Node; dom: HTMLElement; pos: number | undefined; placeholder: boolean }

function eligible(node: Node) {
  const cached = candidates.get(node);
  if (cached !== undefined) return cached;
  let result = virtualTypes.includes(node.type.name);
  // Keep heading DOM available to outline navigation, including headings inside
  // containers. Large text-only lists and quotes can still be virtualized.
  if (result) node.descendants(child => {
    if (child.type.name === 'heading') result = false;
    return result;
  });
  candidates.set(node, result);
  return result;
}

function largeDocument(doc: Node) {
  return doc.childCount >= 200 && doc.content.size >= 60000 && typeof IntersectionObserver !== 'undefined';
}

class RichViewport {
  entries = new Map<Element, Entry>();
  sizes = new WeakMap<Node, Size>();
  observer?: IntersectionObserver;
  resize?: ResizeObserver;
  scroll: HTMLElement | null;
  visible = new Set<number>();
  private intersecting = new Set<number>();
  private indexedDoc?: Node;
  private positions: number[] = [];
  private indices = new Map<number, number>();
  frame?: number;
  dragging = false;
  width = 700;
  lineHeight = 28;
  fontSize = 16;

  constructor(readonly view: EditorView) {
    this.scroll = view.dom.closest<HTMLElement>('.document-layout');
    this.activate();
  }

  activate() {
    const view = this.view;
    if (this.observer || !this.scroll || !largeDocument(view.state.doc)) return;
    const style = getComputedStyle(view.dom);
    this.width = view.dom.clientWidth || 700;
    this.fontSize = Number.parseFloat(style.fontSize) || 16;
    this.lineHeight = Number.parseFloat(style.lineHeight) || this.fontSize * 1.75;
    this.observer = new IntersectionObserver(records => {
      let extend = false;
      for (const record of records) {
        const entry = this.entries.get(record.target), pos = entry?.pos;
        if (pos === undefined) continue;
        if (record.isIntersecting) {
          this.intersecting.add(pos);
          if (!this.visible.has(pos)) extend = true;
        } else this.intersecting.delete(pos);
      }
      // Keep a buffer of whole blocks. Ordinary scrolling within that buffer
      // needs no ProseMirror transaction or decoration traversal.
      if (extend || (!this.dragging && this.visible.size > 100)) {
        this.extendWindow();
        this.schedule();
      }
    }, { root: this.scroll, rootMargin: '600px' });
    if (typeof ResizeObserver !== 'undefined') this.resize = new ResizeObserver(records => {
      if (view.dom.clientWidth !== this.width) this.resized();
      for (const record of records) {
        const entry = this.entries.get(record.target);
        if (entry && !entry.placeholder) this.measure(entry);
      }
    });
    this.resize?.observe(view.dom);
    view.dom.addEventListener('pointerdown', this.pointerDown, true);
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerUp);
    view.dom.addEventListener('compositionend', this.schedule);
    window.addEventListener('resize', this.resized);
    for (const entry of this.entries.values()) {
      this.observer.observe(entry.dom);
      if (!entry.placeholder) this.resize?.observe(entry.dom);
    }
  }

  map(tr: Transaction) {
    for (const entry of this.entries.values()) {
      if (entry.pos === undefined) continue;
      const mapped = tr.mapping.mapResult(entry.pos, 1);
      entry.pos = mapped.deleted ? undefined : mapped.pos;
    }
    this.intersecting = new Set([...this.intersecting].flatMap(pos => {
      const mapped = tr.mapping.mapResult(pos, 1);
      return mapped.deleted ? [] : [mapped.pos];
    }));
  }

  private extendWindow() {
    const doc = this.view.state.doc;
    if (doc !== this.indexedDoc) {
      this.indexedDoc = doc; this.positions = []; this.indices.clear();
      doc.forEach((_node, pos, index) => { this.positions.push(pos); this.indices.set(pos, index); });
    }
    const window = new Set<number>();
    for (const pos of this.intersecting) {
      const index = this.indices.get(pos);
      if (index === undefined) continue;
      for (let i = Math.max(0, index - 12); i < Math.min(this.positions.length, index + 13); i++)
        window.add(this.positions[i]!);
    }
    // Hysteresis prevents mount/unmount churn at a viewport boundary.
    this.visible = !this.dragging && this.visible.size > Math.max(100, window.size * 2)
      ? window : new Set([...this.visible, ...window]);
  }

  measure(entry: Entry) {
    if (!entry.dom.isConnected || entry.placeholder) return;
    const rect = entry.dom.getBoundingClientRect();
    if (!rect.height) return;
    const style = getComputedStyle(entry.dom);
    this.sizes.set(entry.node, { height: rect.height, marginTop: style.marginTop, marginBottom: style.marginBottom, width: this.width });
  }

  size(node: Node): Size {
    const known = this.sizes.get(node);
    if (known && known.width === this.width) return known;
    const lines = Math.max(1, Math.ceil(node.textContent.length * this.fontSize * 0.75 / this.width), node.isTextblock ? 1 : node.childCount);
    return { height: lines * this.lineHeight, marginTop: '0px', marginBottom: '16px', width: this.width };
  }

  register(entry: Entry) {
    this.entries.set(entry.dom, entry);
    this.observer?.observe(entry.dom);
    if (!entry.placeholder) this.resize?.observe(entry.dom);
  }

  remove(entry: Entry) {
    this.observer?.unobserve(entry.dom);
    this.resize?.unobserve(entry.dom);
    this.entries.delete(entry.dom);
  }

  schedule = () => {
    if (this.frame !== undefined || !this.observer) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      if (this.view.isDestroyed || this.view.composing) return;
      const current = viewportKey.getState(this.view.state) ?? new Set<number>();
      if (current.size === this.visible.size && [...current].every(pos => this.visible.has(pos))) return;
      let anchor: { pos: number; top: number } | undefined;
      const scrollTop = this.scroll!.getBoundingClientRect().top;
      for (const entry of this.entries.values()) {
        if (!entry.placeholder) this.measure(entry);
        const pos = entry.pos;
        if (pos === undefined || !this.visible.has(pos)) continue;
        const top = entry.dom.getBoundingClientRect().top;
        if (top >= scrollTop && (!anchor || top < anchor.top)) anchor = { pos, top };
      }
      this.view.dispatch(this.view.state.tr.setMeta(viewportKey, new Set(this.visible))
        .setMeta('addToHistory', false).setMeta('tanoKeepNodeView', true));
      if (anchor) {
        const dom = this.view.nodeDOM(anchor.pos);
        if (dom instanceof HTMLElement) this.scroll!.scrollTop += dom.getBoundingClientRect().top - anchor.top;
      }
    });
  };

  pointerDown = (event: PointerEvent) => {
    this.dragging = true;
    const target = event.target instanceof Element ? event.target.closest('[data-tano-virtual-placeholder]') : null;
    const pos = target && this.entries.get(target)?.pos;
    if (typeof pos !== 'number') return;
    event.preventDefault();
    this.visible.add(pos);
    const tr = this.view.state.tr.setMeta(viewportKey, new Set(this.visible));
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
    this.view.dispatch(tr.setMeta('addToHistory', false));
    this.view.focus();
  };
  pointerUp = () => {
    this.dragging = false;
    // IntersectionObserver need not report an unchanged intersection again.
    // Reobserve after a drag to release blocks retained during native selection.
    for (const entry of this.entries.values()) {
      this.observer?.unobserve(entry.dom);
      this.observer?.observe(entry.dom);
    }
  };
  resized = () => {
    const width = this.view.dom.clientWidth;
    if (!width || width === this.width || this.view.isDestroyed) return;
    this.width = width;
    for (const entry of this.entries.values()) {
      if (entry.placeholder) entry.dom.style.height = `${this.size(entry.node).height}px`;
    }
    this.view.dispatch(this.view.state.tr.setMeta('addToHistory', false).setMeta('tanoKeepNodeView', true));
  };
  destroy() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.observer?.disconnect(); this.resize?.disconnect();
    this.view.dom.removeEventListener('pointerdown', this.pointerDown, true);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('pointercancel', this.pointerUp);
    this.view.dom.removeEventListener('compositionend', this.schedule);
    window.removeEventListener('resize', this.resized);
    this.entries.clear();
  }
}

function controller(view: EditorView) {
  let current = controllers.get(view);
  if (!current) { current = new RichViewport(view); controllers.set(view, current); }
  return current;
}

/** Node views leave the complete ProseMirror document and transaction history in
 * place. Only descendants of offscreen top-level blocks are omitted from DOM. */
export function virtualBlockViews(originals: Record<string, NodeViewConstructor>): Record<string, NodeViewConstructor> {
  const result = { ...originals };
  for (const name of virtualTypes) result[name] = (node, view, getPos, decorations, inner) => {
    const original = originals[name];
    const viewport = controller(view);
    const position = getPos();
    const tracked = position !== undefined && view.state.doc.resolve(position).depth === 0;
    const hidden = (marks: readonly Decoration[], current = node) => {
      viewport.activate();
      return tracked && eligible(current) && !!viewport.observer && largeDocument(view.state.doc) &&
        !marks.some(mark => mark.spec.virtualVisible);
    };
    const placeholder = hidden(decorations);
    let rendered: NodeView;
    if (placeholder) {
      const dom = document.createElement('div');
      dom.dataset.tanoVirtualPlaceholder = name;
      dom.contentEditable = 'false';
      dom.setAttribute('aria-hidden', 'true');
      rendered = { dom, ignoreMutation: () => true };
    } else rendered = original?.(node, view, getPos, decorations, inner) ?? DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
    const entry: Entry = { node, dom: rendered.dom as HTMLElement, pos: position, placeholder };
    const resizePlaceholder = (next: Node) => {
      const size = viewport.size(next);
      entry.dom.style.height = `${size.height}px`;
      entry.dom.style.marginTop = size.marginTop;
      entry.dom.style.marginBottom = size.marginBottom;
    };
    if (placeholder) resizePlaceholder(node);
    // Only top-level blocks participate in viewport observation.
    if (tracked) viewport.register(entry);
    const update = rendered.update?.bind(rendered), destroy = rendered.destroy?.bind(rendered);
    return {
      ...rendered,
      ignoreMutation: rendered.ignoreMutation?.bind(rendered),
      stopEvent: rendered.stopEvent?.bind(rendered),
      selectNode: rendered.selectNode?.bind(rendered),
      deselectNode: rendered.deselectNode?.bind(rendered),
      setSelection: rendered.setSelection?.bind(rendered),
      update(next, nextDecorations, nextInner) {
        if (next.type !== entry.node.type || hidden(nextDecorations, next) !== placeholder) return false;
        const accepted = placeholder || (update ? update(next, nextDecorations, nextInner) : next.sameMarkup(entry.node));
        if (accepted) { entry.node = next; if (placeholder) resizePlaceholder(next); }
        return accepted;
      },
      destroy() { if (tracked) viewport.remove(entry); destroy?.(); },
    };
  };
  return result;
}

export function richViewport() {
  let active: RichViewport | undefined;
  return new Plugin<Set<number>>({
    key: viewportKey,
    state: {
      init: () => new Set(),
      apply(tr, previous) {
        let next = previous;
        if (tr.docChanged) {
          active?.map(tr);
          next = new Set<number>();
          for (const pos of previous) {
            const mapped = tr.mapping.mapResult(pos, 1);
            if (!mapped.deleted) next.add(mapped.pos);
          }
        }
        const visible = tr.getMeta(viewportKey) as Set<number> | undefined;
        if (visible) next = visible;
        const reveal = tr.getMeta('tanoRevealPosition') as number | undefined;
        if (reveal !== undefined) {
          const position = tr.doc.resolve(Math.max(0, Math.min(reveal, tr.doc.content.size)));
          const top = position.depth ? position.before(1) : position.pos;
          active?.visible.add(top);
          return new Set([...next, top]);
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        if (!largeDocument(state.doc)) return DecorationSet.empty;
        const visible = viewportKey.getState(state) ?? new Set();
        const result: Decoration[] = [];
        state.doc.forEach((node, pos, index) => {
          const selected = state.selection.from <= pos + node.nodeSize && state.selection.to >= pos;
          if (!eligible(node) || !(index < 12 || visible.has(pos) || selected)) return;
          result.push(Decoration.node(pos, pos + node.nodeSize, {}, { virtualVisible: true }));
        });
        return DecorationSet.create(state.doc, result);
      },
    },
    view(view) {
      const viewport = controller(view);
      active = viewport;
      view.dom.dataset.tanoDocumentSize = String(view.state.doc.content.size);
      return {
        update(current, previous) {
          if (current.state.doc !== previous.doc) {
            viewport.visible = new Set(viewportKey.getState(current.state));
            current.dom.dataset.tanoDocumentSize = String(current.state.doc.content.size);
          }
        },
        destroy() { viewport.destroy(); controllers.delete(view); },
      };
    },
  });
}
