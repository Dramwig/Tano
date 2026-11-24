import {
  NodeSelection,
  Selection,
  TextSelection,
  type PluginKey,
} from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { isElement, ownerWindow } from '../primitives/dom-realm';
import { blockType, blockTypes, featureLevel } from '../core/document-model';
import { blockTree, indentBlock, moveBlockSibling, outdentBlock } from './block-tree';
import { BlockRangeSelection } from './block-selection';
import { BlockViewport } from '../views/block-viewport';
import { blockMotionKey, FOLD_MOTION } from './block-motion';
import { foldButtonLeft, foldEntryKey, foldingTree, type FoldEntry } from './blocks-folding';

const blockLabel: Record<string, string> = {
  paragraph: '正文',
  heading: '标题',
  table: '表格',
  bullet_list: '列表',
  ordered_list: '列表',
  blockquote: '引用',
  code_block: '代码',
  math_block: '公式',
  hr: '分隔线',
};

/** Measure the visible first text line, including content inset in tables and code blocks. */
export function firstLineCenter(element: Element, block: DOMRect): number {
  const header = element.querySelector(
    ':scope > .tano-enhanced-header, :scope > .tano-callout-title',
  );
  if (header) {
    const rect = header.getBoundingClientRect();
    if (rect.height > 0) return rect.top + rect.height / 2;
  }
  const standaloneImage = element.matches('p')
    ? element.querySelector<HTMLImageElement>(':scope > .tano-image-block > img:not([hidden])')
    : null;
  if (standaloneImage) {
    const rect = standaloneImage.getBoundingClientRect();
    if (rect.height > 0) return rect.top + rect.height / 2;
  }
  const firstRow = element.matches('table, .tano-table-viewport, .tableWrapper')
    ? element.querySelector('tr')
    : null;
  const firstItem = element.matches('ul, ol') ? element.querySelector('li') : null;
  const firstParagraph = element.matches('blockquote') ? element.querySelector(':scope > p') : null;
  const firstContent = firstRow ?? firstItem ?? firstParagraph ?? element;
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(firstContent, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    const start = text.data.search(/\S/);
    if (
      start < 0 ||
      !text.parentElement ||
      text.parentElement.closest(
        'button, textarea, [hidden], [aria-hidden="true"], .katex-mathml',
      )
    ) {
      continue;
    }
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const line = range.getClientRects()[0];
    if (line && line.height > 0 && line.top >= block.top - 1 && line.bottom <= block.bottom + 1) {
      return line.top + line.height / 2;
    }
  }

  // An empty header still belongs to the table's first row, even when later rows have text.
  if (firstRow) {
    const rect = firstRow.getBoundingClientRect();
    if (rect.height > 0) return rect.top + rect.height / 2;
  }
  // Image-only blocks have no visible text range.
  const visual = firstContent.querySelector('img');
  if (visual) {
    const rect = visual.getBoundingClientRect();
    if (rect.height > 0) return rect.top + rect.height / 2;
  }
  if (element.tagName === 'HR') return block.top + block.height / 2;

  const first = firstContent.querySelector('p, li, th, td, pre, code') ?? firstContent;
  const rect = first.getBoundingClientRect();
  const style = ownerWindow(first).getComputedStyle(first);
  const lineHeight =
    Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 24;
  const inset =
    first === element
      ? (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.paddingTop) || 0)
      : 0;
  return rect.top + inset + lineHeight / 2;
}

export interface BlockHandlesContext {
  getView: () => EditorView;
  window: Window & typeof globalThis;
  document: Document;
  host: HTMLElement;
  hoverSurface: HTMLElement;
  controls: HTMLElement;
  foldingKey: PluginKey<Set<string>>;
  readonly: () => boolean;
  folding: () => boolean;
  openMenu?: (event: MouseEvent, handle: HTMLButtonElement) => void;
  isDragging: () => boolean;
  getSourceIndex: () => number | null;
  clearDrag: () => void;
  consumeSuppressClick: () => boolean;
  isDestroyed: () => boolean;
}

export function createBlockHandlesController(ctx: BlockHandlesContext) {
  const {
    window,
    document,
    host,
    hoverSurface,
    controls,
    foldingKey,
    readonly,
    folding,
    openMenu,
    isDragging,
    getSourceIndex,
    clearDrag,
    consumeSuppressClick,
    isDestroyed,
  } = ctx;
  const requestAnimationFrame = (callback: FrameRequestCallback) =>
    window.requestAnimationFrame(callback);
  const cancelAnimationFrame = (id: number) => window.cancelAnimationFrame(id);
  const getComputedStyle = (element: Element, pseudo?: string | null) =>
    window.getComputedStyle(element, pseudo);

  let hoveredIndex: number | null = null;
  let hoveredFoldIndex: number | null = null;
  let hoverSuppressed = false;
  const handles = new Map<number, HTMLButtonElement>();
  const foldButtons = new Map<number, HTMLButtonElement>();
  const positioned = new WeakSet<HTMLButtonElement>();
  let blockIndices = new Map<number, number>();
  let foldIndices = new Map<number, number>();
  const viewport = new BlockViewport(ctx.getView(), () => queueLayout(true));
  let entries = blockTree(ctx.getView().state.doc);
  let foldEntries: FoldEntry[] = foldingTree(ctx.getView().state.doc, entries);
  let positions: number[] = [];
  let indexedDoc: ProseMirrorNode | undefined;
  let layoutFrame: number | undefined;
  let visibilityOnly = false;

  function blockKey(index: number) {
    return foldEntryKey(foldEntries[index]!);
  }

  function showHoveredHandle() {
    const view = ctx.getView();
    const dragging = isDragging();
    const sourceIndex = getSourceIndex();
    const hovered = hoveredIndex == null ? null : entries[hoveredIndex];
    handles.forEach((handle, index) => {
      const entry = entries[index]!;
      handle.classList.toggle(
        'is-visible',
        index === hoveredIndex ||
          (dragging && index === sourceIndex) ||
          (!dragging &&
            !!hovered &&
            entry.node.type.name === 'tano_columns' &&
            entry.pos < hovered.pos &&
            hovered.pos < entry.pos + entry.node.nodeSize),
      );
    });
    foldButtons.forEach((button, index) => {
      button.classList.toggle(
        'is-visible',
        folding() &&
          (index === hoveredFoldIndex ||
            (foldingKey.getState(view.state) ?? new Set()).has(blockKey(index))),
      );
    });
  }

  function setHovered(index: number | null, foldIndex: number | null = null) {
    if (hoveredIndex === index && hoveredFoldIndex === foldIndex) return;
    hoveredIndex = index;
    hoveredFoldIndex = foldIndex;
    showHoveredHandle();
  }

  function resetHover() {
    hoveredIndex = null;
    hoveredFoldIndex = null;
  }

  function blockIndexAt(target: EventTarget | null): number | null {
    const view = ctx.getView();
    if (!isElement(target)) return null;
    const handle = target.closest<HTMLButtonElement>('.tano-block-handle');
    if (handle && controls.contains(handle)) return Number(handle.dataset.blockIndex);
    if (!view.dom.contains(target)) return null;
    for (const pos of viewport.containing(target)) {
      const index = blockIndices.get(pos);
      if (index !== undefined) return index;
    }
    return null;
  }

  function blockElement(index: number) {
    const pos = positions[index];
    if (pos == null) return null;
    return viewport.element(pos);
  }

  function blockRect(index: number) {
    const element = blockElement(index);
    if (
      !element ||
      element.closest('[hidden], .tano-folded-heading-content, .tano-folded-list-content')
    ) {
      return null;
    }
    return element.getBoundingClientRect();
  }

  function foldElement(index: number) {
    return viewport.element(foldEntries[index]!.pos);
  }

  function foldRect(index: number) {
    const element = foldElement(index);
    if (
      !element ||
      element.closest('[hidden], .tano-folded-heading-content, .tano-folded-list-content')
    ) {
      return null;
    }
    return element.getBoundingClientRect();
  }

  function foldIndexAt(target: EventTarget | null, x: number, y: number) {
    const view = ctx.getView();
    if (isElement(target)) {
      const button = target.closest<HTMLButtonElement>('.tano-fold-toggle');
      if (button && controls.contains(button)) return Number(button.dataset.foldIndex);
      // Text content identifies its own item even when jsdom or a browser
      // reports the surrounding list item's box for the pointer target.
      const text = target.closest('p, h1, h2, h3, h4, h5, h6');
      if (text && view.dom.contains(text)) {
        for (const pos of viewport.containing(text)) {
          const index = foldIndices.get(pos);
          if (
            index !== undefined &&
            (foldElement(index) === text || foldElement(index) === text.parentElement)
          ) {
            return index;
          }
        }
      }
      // jsdom and detached/offscreen DOM can report empty rectangles. In
      // that case there is no reliable coordinate hit to resolve.
      if (
        view.dom.contains(target) &&
        ![...foldButtons.keys()].some((index) => {
          const rect = foldRect(index);
          return !!rect && rect.width > 0 && rect.height > 0;
        })
      ) {
        return null;
      }
    }
    for (const index of [...foldButtons.keys()].sort((a, b) => b - a)) {
      const rect = foldRect(index);
      const element = foldElement(index);
      if (
        rect &&
        element &&
        x >= foldButtonLeft(foldEntries[index]!, element, rect) - 24 &&
        x <= rect.right + 24 &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return index;
      }
    }
    return null;
  }

  function blockIndexAtCoords(x: number, y: number) {
    let closest: number | null = null;
    let closestDistance = Infinity;
    for (const index of [...handles.keys()].sort((a, b) => b - a)) {
      const rect = blockRect(index);
      if (
        !rect ||
        x < rect.left - 60 ||
        x > rect.right + 24 ||
        y < rect.top - 12 ||
        y > rect.bottom + 12
      ) {
        continue;
      }
      const distance = Math.hypot(
        Math.max(rect.top - y, 0, y - rect.bottom),
        Math.max(rect.left - x, 0, x - rect.right),
      );
      if (distance < closestDistance) {
        closest = index;
        closestDistance = distance;
      }
    }
    return closest;
  }

  function configureHandle(handle: HTMLButtonElement, index: number) {
    const element = blockElement(index);
    handle.classList.toggle('is-column-child', !!element?.parentElement?.closest('.tano-columns'));
    handle.classList.toggle('is-columns', entries[index]!.node.type.name === 'tano_columns');
    const type = blockType(entries[index]!.node);
    const kind =
      blockTypes.find((item) => item.type === type)?.label ??
      blockLabel[entries[index]!.node.type.name] ??
      '内容';
    handle.dataset.featureLevel = String(featureLevel(type));
    handle.dataset.blockIndex = String(index);
    handle.dataset.blockPos = String(entries[index]!.pos);
    handle.dataset.blockDepth = String(entries[index]!.depth);
    handle.setAttribute(
      'aria-label',
      `点击选中第 ${index + 1} 个${kind.endsWith('块') ? kind : `${kind}块`}${openMenu ? '并打开菜单' : ''}，拖动调整顺序`,
    );
    handle.title = `${kind}；点击选中${openMenu ? '并打开菜单' : ''}；Shift+点击连续多选；Ctrl/Cmd+点击增减选择；拖动换位；Alt+↑/↓ 同级排序；Alt+←/→ 移出/移入容器`;
    if (openMenu) handle.setAttribute('aria-haspopup', 'menu');
  }

  function syncVisibleControls() {
    const blocks = new Set<number>();
    const folds = new Set<number>();
    for (const pos of viewport.visible) {
      const block = blockIndices.get(pos);
      const fold = foldIndices.get(pos);
      if (block !== undefined) blocks.add(block);
      if (fold !== undefined) folds.add(fold);
    }
    const sourceIndex = getSourceIndex();
    if (sourceIndex !== null && entries[sourceIndex]) blocks.add(sourceIndex);
    handles.forEach((button, index) => {
      if (!blocks.has(index)) {
        button.remove();
        handles.delete(index);
      }
    });
    foldButtons.forEach((button, index) => {
      if (!folds.has(index)) {
        button.remove();
        foldButtons.delete(index);
      }
    });
    for (const index of blocks) {
      if (handles.has(index)) continue;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'tano-block-handle';
      handle.draggable = false;
      handle.contentEditable = 'false';
      const icon = document.createElement('span');
      icon.className = 'tano-block-handle-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⠿';
      handle.append(icon);
      controls.append(handle);
      handles.set(index, handle);
      configureHandle(handle, index);
    }
    for (const index of folds) {
      if (foldButtons.has(index)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tano-fold-toggle';
      button.contentEditable = 'false';
      button.setAttribute('aria-hidden', 'true');
      button.tabIndex = -1;
      button.textContent = '▾';
      controls.append(button);
      button.dataset.foldIndex = String(index);
      foldButtons.set(index, button);
    }
  }

  // Keep interaction targets current even while their geometry waits for a frame.
  function syncControls() {
    const view = ctx.getView();
    if (indexedDoc === view.state.doc) {
      if (viewport.detached()) {
        viewport.update([...positions, ...foldIndices.keys()]);
        syncVisibleControls();
      }
      return;
    }
    indexedDoc = view.state.doc;
    entries = blockTree(view.state.doc);
    foldEntries = foldingTree(view.state.doc, entries);
    const count = entries.length;
    positions = entries.map(({ pos }) => pos);
    blockIndices = new Map(positions.map((pos, index) => [pos, index]));
    foldIndices = new Map(foldEntries.map(({ pos }, index) => [pos, index]));
    viewport.update([...positions, ...foldIndices.keys()]);
    syncVisibleControls();
    handles.forEach((handle, index) => configureHandle(handle, index));
    if (hoveredIndex != null && hoveredIndex >= count) hoveredIndex = null;
    if (hoveredFoldIndex != null && hoveredFoldIndex >= foldEntries.length) hoveredFoldIndex = null;
  }

  function scheduleLayout() {
    queueLayout(false);
  }

  function queueLayout(onlyVisibility: boolean) {
    if (isDestroyed()) return;
    if (layoutFrame !== undefined) {
      visibilityOnly = visibilityOnly && onlyVisibility;
      return;
    }
    visibilityOnly = onlyVisibility;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = undefined;
      layout(visibilityOnly);
    });
  }

  function flushLayout() {
    if (layoutFrame === undefined) return;
    cancelAnimationFrame(layoutFrame);
    layoutFrame = undefined;
    layout();
  }

  function layout(onlyVisibility = false) {
    if (isDestroyed()) return;
    const view = ctx.getView();
    syncControls();
    syncVisibleControls();
    const readOnly = readonly();
    const canFold = folding();
    if (readOnly && !canFold) {
      clearDrag();
      controls.hidden = true;
      return;
    }
    controls.hidden = false;
    // Previously positioned top-level controls keep their content-relative
    // coordinates when the observer changes the visible range. Containers
    // retain the full pass because their gutters can depend on children.
    const partial =
      onlyVisibility &&
      [...handles.keys()].every(
        (index) => entries[index]!.depth === 0 && entries[index]!.node.type.name !== 'tano_columns',
      );
    const pendingHandles = [...handles].filter(([, button]) => !partial || !positioned.has(button));
    const pendingFolds = [...foldButtons].filter(
      ([, button]) => !partial || !positioned.has(button),
    );
    if (partial && !pendingHandles.length && !pendingFolds.length) {
      showHoveredHandle();
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const top = hostRect.top;
    const hostLeft = hostRect.left;
    const pane = hoverSurface.getBoundingClientRect();
    const gutterLeft = pane.width > 0 ? pane.left + 4 : -Infinity;
    const visibleTop = Math.max(0, pane.top) - 160;
    const visibleBottom = Math.min(window.innerHeight, pane.bottom) + 160;
    const visible = (rect: DOMRect | null) =>
      !!rect &&
      // Observed controls include the viewport's buffer. Position them now,
      // so they scroll into view with their blocks without another layout.
      (viewport.observing ||
        pane.height <= 0 ||
        (rect.bottom >= visibleTop && rect.top <= visibleBottom));
    // Read geometry once, before touching any control's styles. Headings share
    // their first-line measurement between the drag handle and fold button.
    const rects = new Map<Element, DOMRect | null>();
    const centers = new Map<Element, number>();
    const measure = (element: Element | null) => {
      if (!element) return null;
      if (!rects.has(element)) {
        rects.set(
          element,
          element.closest('[hidden], .tano-folded-heading-content, .tano-folded-list-content')
            ? null
            : element.getBoundingClientRect(),
        );
      }
      return rects.get(element)!;
    };
    const center = (element: Element, rect: DOMRect) => {
      if (!centers.has(element)) centers.set(element, firstLineCenter(element, rect));
      return centers.get(element)!;
    };
    type BlockGeometry = {
      rect: DOMRect | null;
      left: number | null;
      x: number;
      y: number;
      width: number;
      hidden: boolean;
      transform: string;
      clipPath: string;
    };
    const blocks = new Map(
      pendingHandles.map<[number, BlockGeometry]>(([index, handle]) => {
        const entry = entries[index]!;
        const element = blockElement(index);
        const rect = measure(element);
        if (readOnly || !visible(rect)) {
          return [
            index,
            { rect, left: null, x: 0, y: top, width: 0, hidden: true, transform: '', clipPath: '' },
          ];
        }
        const columnChild = handle.classList.contains('is-column-child');
        const isColumns = entry.node.type.name === 'tano_columns';
        const style = getComputedStyle(handle);
        const bounds = handle.getBoundingClientRect();
        const width =
          bounds.width || Number.parseFloat(style.width) || (columnChild || isColumns ? 18 : 28);
        const height = bounds.height || Number.parseFloat(style.height) || 24;
        const left = rect && columnChild ? Math.max(-28, gutterLeft - rect.left) : null;
        const table = element?.matches('.tano-table-viewport:not(.has-comments)')
          ? element.querySelector('table')
          : null;
        const translation =
          table && rect
            ? (measure(table)?.left ?? hostLeft) - hostLeft
            : rect && entry.depth > 0
              ? rect.left - hostLeft
              : 0;
        const y = element && rect ? center(element, rect) - height / 2 : top;
        const x =
          hostLeft +
          translation +
          (left ?? (isColumns ? -52 : Number.parseFloat(style.left) || -28));
        return [
          index,
          {
            rect,
            left,
            x,
            y,
            width,
            hidden: readOnly || !rect,
            transform: table || (rect && entry.depth > 0) ? `translateX(${translation}px)` : '',
            clipPath:
              table && pane.width > 0
                ? `inset(0 ${Math.max(0, x + width - pane.right)}px 0 ${Math.max(0, pane.left - x)}px)`
                : '',
          },
        ];
      }),
    );
    // Place outer column controls beyond the first column's controls. If the
    // viewport has no spare gutter, stack them above the row instead. Use the
    // proposed bounds, so nested columns need no write/read layout round trips.
    for (const index of [...blocks.keys()].sort((a, b) => b - a)) {
      const entry = entries[index]!;
      if (entry.node.type.name !== 'tano_columns') continue;
      const block = blocks.get(index)!;
      const rect = block.rect;
      if (!rect || block.hidden) continue;
      let left = rect.left - 52;
      let above = rect.top - 28;
      for (const [child, childBlock] of blocks) {
        if (child <= index || entries[child]!.pos >= entry.pos + entry.node.nodeSize) continue;
        if (!childBlock.rect || childBlock.rect.left > rect.left + 1 || childBlock.hidden) continue;
        left = Math.min(left, childBlock.x - 24);
        above = Math.min(above, childBlock.y - 28);
      }
      const stacked = left < gutterLeft;
      const anchor = entry.depth > 0 ? rect.left : hostLeft;
      block.x = stacked ? Math.max(gutterLeft, rect.left - 28) : left;
      block.left = block.x - anchor;
      if (stacked) block.y = above;
    }
    const folded = foldingKey.getState(view.state) ?? new Set<string>();
    const folds = new Map(
      pendingFolds.map(([index, button]) => {
        const element = foldElement(index);
        const measured = measure(element);
        const rect = canFold && visible(measured) ? measured : null;
        return [
          index,
          {
            hidden: !rect || !canFold,
            isFolded: folded.has(blockKey(index)),
            top:
              element && rect ? center(element, rect) - top - (button.offsetHeight || 24) / 2 : null,
            left:
              element && rect
                ? foldButtonLeft(foldEntries[index]!, element, rect) -
                  hostLeft -
                  (button.offsetWidth || 18)
                : null,
          },
        ] as const;
      }),
    );
    // Apply all writes together; no geometry reads belong below this point.
    blocks.forEach((block, index) => {
      const handle = handles.get(index)!;
      positioned.add(handle);
      if (block.hidden) {
        handle.hidden = true;
        return;
      }
      handle.style.left = block.left === null ? '' : `${block.left}px`;
      handle.style.top = `${block.y - top}px`;
      handle.hidden = block.hidden;
      handle.style.transform = block.transform;
      handle.style.clipPath = block.clipPath;
    });
    folds.forEach(({ hidden, isFolded, top: foldTop, left }, index) => {
      const foldButton = foldButtons.get(index)!;
      positioned.add(foldButton);
      const glyph = isFolded ? '▸' : '▾';
      if (foldButton.textContent !== glyph) foldButton.textContent = glyph;
      foldButton.hidden = hidden;
      foldButton.classList.toggle('is-folded', isFolded);
      foldButton.classList.toggle('is-visible', index === hoveredFoldIndex || isFolded);
      foldButton.dataset.blockPos = String(foldEntries[index]!.pos);
      foldButton.setAttribute('aria-hidden', String(!canFold));
      foldButton.setAttribute('aria-label', isFolded ? '展开内容' : '折叠内容');
      foldButton.title = isFolded ? '展开内容' : '折叠内容';
      if (foldTop !== null) foldButton.style.top = `${foldTop}px`;
      if (left !== null) foldButton.style.left = `${left}px`;
    });
    showHoveredHandle();
  }

  function hoveredHandleBridge(event: MouseEvent) {
    if (hoveredIndex == null) return null;
    const handle = handles.get(hoveredIndex);
    if (
      !handle ||
      handle.hidden ||
      (!handle.classList.contains('is-column-child') && !handle.classList.contains('is-columns'))
    ) {
      return null;
    }
    if (isElement(event.target) && event.target.closest('.tano-block-handle')) return null;
    const hovered = entries[hoveredIndex]!;
    const targetIndex = blockIndexAt(event.target);
    const target = targetIndex == null ? null : entries[targetIndex];
    if (
      target &&
      targetIndex !== hoveredIndex &&
      !(
        target.node.type.name === 'tano_columns' &&
        target.pos < hovered.pos &&
        hovered.pos < target.pos + target.node.nodeSize
      )
    ) {
      return null;
    }
    const block = blockRect(hoveredIndex);
    const bounds = handle.getBoundingClientRect();
    if (!block || bounds.width === 0) return null;
    let left = bounds.left;
    let top = Math.min(bounds.top, block.top);
    handles.forEach((ancestor, index) => {
      const entry = entries[index]!;
      if (
        entry.node.type.name !== 'tano_columns' ||
        entry.pos >= hovered.pos ||
        hovered.pos >= entry.pos + entry.node.nodeSize
      ) {
        return;
      }
      const rect = ancestor.getBoundingClientRect();
      if (ancestor.hidden || rect.width === 0) return;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
    });
    // The column gap (including its separator) belongs to the parent DOM node.
    // Keep the child's handle reachable while crossing that gap from its content.
    return event.clientX >= left &&
      event.clientX <= Math.max(bounds.right, block.left) &&
      event.clientY >= top - 4 &&
      event.clientY <= Math.max(bounds.bottom, block.bottom) + 4
      ? hoveredIndex
      : null;
  }

  function onHover(event: MouseEvent) {
    if (isDragging() || (readonly() && !folding())) return;
    if (event.type === 'mousemove') hoverSuppressed = false;
    if (hoverSuppressed) return;
    setHovered(
      hoveredHandleBridge(event) ??
        blockIndexAt(event.target) ??
        blockIndexAtCoords(event.clientX, event.clientY),
      foldIndexAt(event.target, event.clientX, event.clientY),
    );
  }

  function onEditorInput() {
    hoverSuppressed = true;
    setHovered(null);
  }

  function onEditorKeyDown(event: KeyboardEvent) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(event.key)) return;
    onEditorInput();
  }

  function onHoverLeave() {
    if (isDragging()) return;
    setHovered(null);
  }

  function onHandleClick(event: MouseEvent) {
    const view = ctx.getView();
    flushLayout();
    if (consumeSuppressClick()) {
      event.preventDefault();
      return;
    }
    const handle = (event.target as Element).closest<HTMLButtonElement>('.tano-block-handle');
    if (!handle || readonly()) return;
    const index = Number(handle.dataset.blockIndex);
    const pos = positions[index];
    if (pos == null) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const { selection: current, doc } = view.state;
      const currentPositions =
        current instanceof BlockRangeSelection
          ? current.blocks.map((block) => block.pos)
          : current instanceof NodeSelection && current.node.isBlock
            ? [current.from]
            : [];
      const selection = BlockRangeSelection.toggleBlock(
        doc,
        currentPositions,
        pos,
        current instanceof BlockRangeSelection ? current.anchorBlock : currentPositions[0],
      );
      const caret =
        TextSelection.findFrom(doc.resolve(pos), 1, true) ??
        TextSelection.findFrom(doc.resolve(pos), -1, true);
      view.dispatch(
        view.state.tr
          .setSelection(selection ?? caret ?? Selection.near(doc.resolve(pos)))
          .setMeta('addToHistory', false)
          .setMeta('tanoKeepNodeView', true),
      );
      view.focus();
      return;
    }
    if (event.shiftKey) {
      const current = view.state.selection;
      const anchor =
        current instanceof BlockRangeSelection
          ? current.anchorBlock
          : current instanceof NodeSelection
            ? current.from
            : entries.find(
                (entry) => entry.pos <= current.from && current.from < entry.pos + entry.node.nodeSize,
              )?.pos;
      const selection = BlockRangeSelection.betweenBlocks(view.state.doc, anchor ?? pos, pos);
      if (selection) {
        view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false));
      }
      view.focus();
      return;
    }
    if (
      view.state.selection instanceof BlockRangeSelection &&
      view.state.selection.blocks.some((block) => block.pos === pos)
    ) {
      view.focus();
      openMenu?.(event, handle);
      return;
    }
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
    openMenu?.(event, handle);
  }

  function onFoldClick(event: MouseEvent) {
    const view = ctx.getView();
    flushLayout();
    const button = (event.target as Element).closest<HTMLButtonElement>('.tano-fold-toggle');
    if (!button || !folding()) return;
    const index = Number(button.dataset.foldIndex);
    if (index < 0 || button.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const key = blockKey(index);
    view.dispatch(
      view.state.tr
        .setMeta(foldingKey, key)
        .setMeta(blockMotionKey, FOLD_MOTION)
        .setMeta('addToHistory', false),
    );
  }

  function onKeyDown(event: KeyboardEvent) {
    const view = ctx.getView();
    const handle = (event.target as Element).closest<HTMLButtonElement>('.tano-block-handle');
    if (!handle || !event.altKey || readonly()) return;
    const index = Number(handle.dataset.blockIndex);
    const pos = positions[index];
    if (pos == null) return;
    const transaction =
      event.key === 'ArrowLeft'
        ? outdentBlock(view.state, pos)
        : event.key === 'ArrowRight'
          ? indentBlock(view.state, pos)
          : event.key === 'ArrowUp' || event.key === 'ArrowDown'
            ? moveBlockSibling(view.state, pos, event.key === 'ArrowUp' ? -1 : 1)
            : null;
    if (!transaction) return;
    event.preventDefault();
    view.dispatch(transaction.scrollIntoView());
    flushLayout();
    handles.get(positions.indexOf(view.state.selection.from))?.focus();
  }

  function onTableScroll(event: Event) {
    // Nested scroll areas move their children relative to the editor host;
    // unlike the document's own scroll, these still need fresh positions.
    if (isElement(event.target)) scheduleLayout();
  }

  function onFallbackScroll(event: Event) {
    // Absolute controls already move with their content. IntersectionObserver
    // maintains their mounted range; only older hosts need scroll-time work.
    const target = event.target;
    if (target === document || (isElement(target) && target.contains(host))) scheduleLayout();
  }

  function destroy() {
    viewport.destroy();
    if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
  }

  return {
    observing: viewport.observing,
    getEntries: () => entries,
    getPositions: () => positions,
    blockElement,
    blockRect,
    syncControls,
    showHoveredHandle,
    resetHover,
    scheduleLayout,
    flushLayout,
    layout,
    onHover,
    onEditorInput,
    onEditorKeyDown,
    onHoverLeave,
    onHandleClick,
    onFoldClick,
    onKeyDown,
    onTableScroll,
    onFallbackScroll,
    destroy,
  };
}
