import { NodeSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { blockType, blockTypes, featureLevel } from './document-model';

/** Move one top-level Markdown block in a single, undoable editor transaction. */
export function moveBlock(
  state: EditorState,
  sourceIndex: number,
  insertionIndex: number,
): Transaction | null {
  const { doc } = state;
  if (
    sourceIndex < 0 ||
    sourceIndex >= doc.childCount ||
    insertionIndex < 0 ||
    insertionIndex > doc.childCount ||
    insertionIndex === sourceIndex ||
    insertionIndex === sourceIndex + 1
  )
    return null;

  let sourcePos = 0;
  let insertionPos = 0;
  doc.forEach((node, offset, index) => {
    if (index === sourceIndex) sourcePos = offset;
    if (index === insertionIndex) insertionPos = offset;
  });
  if (insertionIndex === doc.childCount) insertionPos = doc.content.size;

  const block = doc.child(sourceIndex);
  const targetPos = insertionPos > sourcePos ? insertionPos - block.nodeSize : insertionPos;
  return state.tr.delete(sourcePos, sourcePos + block.nodeSize).insert(targetPos, block);
}

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
function firstLineCenter(element: Element, block: DOMRect): number {
  const standaloneImage = element.matches('p')
    ? element.querySelector<HTMLImageElement>(':scope > .tano-image-block > img:not([hidden])')
    : null;
  if (standaloneImage) {
    const rect = standaloneImage.getBoundingClientRect();
    if (rect.height > 0) return rect.top + rect.height / 2;
  }
  const firstRow = element.querySelector('tr');
  const firstItem = element.matches('ul, ol') ? element.querySelector('li') : null;
  const firstParagraph = element.matches('blockquote') ? element.querySelector('p') : null;
  const firstContent = firstRow ?? firstItem ?? firstParagraph ?? element;
  const walker = document.createTreeWalker(firstContent, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    const start = text.data.search(/\S/);
    if (
      start < 0 ||
      !text.parentElement ||
      text.parentElement.closest('button, textarea, [hidden], [aria-hidden="true"], .katex-mathml')
    )
      continue;
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const line = range.getClientRects()[0];
    if (line && line.height > 0 && line.top >= block.top - 1 && line.bottom <= block.bottom + 1)
      return line.top + line.height / 2;
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
  const style = getComputedStyle(first);
  const lineHeight =
    Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 24;
  const inset =
    first === element
      ? (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.paddingTop) || 0)
      : 0;
  return rect.top + inset + lineHeight / 2;
}

/** A gutter beside the document, outside contenteditable and Markdown serialization. */
export function blockControls(readonly: () => boolean, folding: () => boolean = () => true) {
  const foldingKey = new PluginKey<Set<string>>('tano-folding');
  return new Plugin({
    key: foldingKey,
    state: {
      init: () => new Set<string>(),
      apply(transaction, current) {
        const toggle = transaction.getMeta(foldingKey) as string | undefined;
        if (!toggle) return current;
        const next = new Set(current);
        if (next.has(toggle)) next.delete(toggle);
        else next.add(toggle);
        return next;
      },
    },
    props: {
      handleClickOn(_view, _pos, node, _nodePos, event, direct) {
        // Leaf blocks have no text caret, so ProseMirror selects the whole node on click.
        // Whole-block selection is reserved for the gutter handle and context menu.
        return event.button === 0 && direct && node.isBlock &&
          (node.isAtom || (event.target instanceof Element && !!event.target.closest('.tano-mermaid')));
      },
      decorations(state) {
        if (!folding()) return DecorationSet.empty;
        const folded = foldingKey.getState(state) ?? new Set<string>();
        const hidden = new Set<number>();
        state.doc.forEach((node, _offset, index) => {
          if (!folded.has(`${index}:${node.type.name}:${node.textContent.slice(0, 80)}`)) return;
          if (node.type.name === 'heading') {
            const level = Number(node.attrs.level ?? 1);
            for (let next = index + 1; next < state.doc.childCount; next++) {
              const nextNode = state.doc.child(next);
              if (nextNode.type.name === 'heading' && Number(nextNode.attrs.level ?? 1) <= level)
                break;
              hidden.add(next);
            }
          }
        });
        const decorations: Decoration[] = [];
        state.doc.forEach((node, offset, index) => {
          if (hidden.has(index))
            decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'tano-folded-heading-content' }));
          if (
            folded.has(`${index}:${node.type.name}:${node.textContent.slice(0, 80)}`) &&
            (node.type.name === 'bullet_list' || node.type.name === 'ordered_list')
          )
            decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'tano-folded-list' }));
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
    view(initialView) {
      let view = initialView;
      const host = view.dom.parentElement!;
      const hoverSurface =
        host.closest<HTMLElement>('.editor-scroll') ?? host.parentElement ?? host;
      const controls = document.createElement('div');
      controls.className = 'tano-block-controls';
      controls.setAttribute('aria-label', '文章块排序');
      const marker = document.createElement('div');
      marker.className = 'tano-block-drop-line';
      marker.hidden = true;
      controls.append(marker);
      host.append(controls);

      let sourceIndex: number | null = null;
      let startingDoc: EditorState['doc'] | null = null;
      let dragging = false;
      let draggedElement: Element | null = null;
      let dragPreview: HTMLElement | null = null;
      let pendingPointer: {
        id: number;
        index: number;
        x: number;
        y: number;
        doc: EditorState['doc'];
      } | null = null;
      let suppressClick = false;
      let clickResetTimer: number | null = null;
      let hoveredIndex: number | null = null;
      let hoverSuppressed = false;
      const handles: HTMLButtonElement[] = [];
      const foldButtons: HTMLButtonElement[] = [];
      let positions: number[] = [];

      function blockKey(index: number) {
        const node = view.state.doc.child(index);
        return `${index}:${node.type.name}:${node.textContent.slice(0, 80)}`;
      }

      function foldable(node: ProseMirrorNode) {
        return node.type.name === 'heading' || node.type.name === 'bullet_list' || node.type.name === 'ordered_list';
      }

      function showHoveredHandle() {
        handles.forEach((handle, index) => {
          handle.classList.toggle(
            'is-visible',
            index === hoveredIndex || (dragging && index === sourceIndex),
          );
        });
        foldButtons.forEach((button, index) => {
          button.classList.toggle(
            'is-visible',
            folding() &&
              (index === hoveredIndex || (foldingKey.getState(view.state) ?? new Set()).has(blockKey(index))),
          );
        });
      }

      function setHovered(index: number | null) {
        if (hoveredIndex === index) return;
        hoveredIndex = index;
        showHoveredHandle();
      }

      function blockIndexAt(target: EventTarget | null): number | null {
        if (!(target instanceof Element) || !view.dom.contains(target)) return null;
        let element = target;
        while (element.parentElement && element.parentElement !== view.dom)
          element = element.parentElement;
        if (element.parentElement !== view.dom) return null;
        try {
          const index = view.state.doc.resolve(view.posAtDOM(element, 0)).index(0);
          return index < view.state.doc.childCount ? index : null;
        } catch {
          return null;
        }
      }

      function blockElement(index: number) {
        const pos = positions[index];
        if (pos == null) return null;
        const element = view.nodeDOM(pos);
        return element instanceof Element ? element : null;
      }

      function blockRect(index: number) {
        return blockElement(index)?.getBoundingClientRect() ?? null;
      }

      function blockIndexAtCoords(x: number, y: number) {
        let closest: number | null = null;
        let closestDistance = Infinity;
        for (let index = 0; index < view.state.doc.childCount; index++) {
          const rect = blockRect(index);
          if (
            !rect ||
            x < rect.left - 60 ||
            x > rect.right + 24 ||
            y < rect.top - 12 ||
            y > rect.bottom + 12
          )
            continue;
          const distance = Math.max(rect.top - y, 0, y - rect.bottom);
          if (distance < closestDistance) {
            closest = index;
            closestDistance = distance;
          }
        }
        return closest;
      }

      function layout() {
        if (readonly() && !folding()) {
          clearDrag();
          controls.hidden = true;
          return;
        }
        controls.hidden = false;
        const count = view.state.doc.childCount;
        positions = [];
        view.state.doc.forEach((_node, offset) => positions.push(offset));
        while (handles.length > count) handles.pop()!.remove();
        while (handles.length < count) {
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
          handles.push(handle);
        }
        while (foldButtons.length > count) foldButtons.pop()!.remove();
        while (foldButtons.length < count) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'tano-fold-toggle';
          button.contentEditable = 'false';
          button.setAttribute('aria-hidden', 'true');
          button.tabIndex = -1;
          button.textContent = '▾';
          controls.append(button);
          foldButtons.push(button);
        }
        const top = host.getBoundingClientRect().top;
        const hostLeft = host.getBoundingClientRect().left;
        for (let index = 0; index < count; index++) {
          const handle = handles[index];
          const element = blockElement(index);
          const rect = element?.getBoundingClientRect();
          const type = blockType(view.state.doc.child(index));
          const kind =
            blockTypes.find((item) => item.type === type)?.label ??
            blockLabel[view.state.doc.child(index).type.name] ??
            '内容';
          handle.dataset.featureLevel = String(featureLevel(type));
          handle.dataset.blockIndex = String(index);
          handle.setAttribute(
            'aria-label',
            `点击选中第 ${index + 1} 个${kind.endsWith('块') ? kind : `${kind}块`}，拖动调整顺序`,
          );
          handle.title = `${kind} · Level ${featureLevel(type)}；点击选中；拖动换位；Alt+↑/↓ 调整顺序`;
          if (element && rect)
            handle.style.top = `${firstLineCenter(element, rect) - top - (handle.offsetHeight || 24) / 2}px`;
          handle.hidden = readonly() || !rect;
          const table = element?.matches('.tano-table-viewport:not(.has-comments)') ? element.querySelector('table') : null;
          handle.style.transform = table ? `translateX(${table.getBoundingClientRect().left - hostLeft}px)` : '';
          handle.style.clipPath = '';
          if (table) {
            const pane = hoverSurface.getBoundingClientRect();
            const bounds = handle.getBoundingClientRect();
            if (pane.width > 0 && bounds.width > 0)
              handle.style.clipPath = `inset(0 ${Math.max(0, bounds.right - pane.right)}px 0 ${Math.max(0, pane.left - bounds.left)}px)`;
          }
          const foldButton = foldButtons[index];
          const canFold = folding() && foldable(view.state.doc.child(index));
          const isFolded = (foldingKey.getState(view.state) ?? new Set()).has(blockKey(index));
          foldButton.textContent = isFolded ? '▸' : '▾';
          foldButton.hidden = !rect || !canFold;
          foldButton.classList.toggle('is-folded', isFolded);
          foldButton.classList.toggle('is-visible', index === hoveredIndex || isFolded);
          foldButton.setAttribute('aria-hidden', String(!canFold));
          foldButton.setAttribute('aria-label', isFolded ? '展开内容' : '折叠内容');
          foldButton.title = isFolded ? '展开内容' : '折叠内容';
          if (element && rect)
            foldButton.style.top = `${firstLineCenter(element, rect) - top - (foldButton.offsetHeight || 24) / 2}px`;
          if (element && rect)
            foldButton.style.left = `${rect.left - hostLeft - 18}px`;
        }
        if (hoveredIndex != null && hoveredIndex >= count) hoveredIndex = null;
        showHoveredHandle();
      }

      function removeDragPreview() {
        dragPreview?.remove();
        dragPreview = null;
      }

      function onTableScroll(event: Event) {
        if (event.target instanceof Element && event.target.matches('.tableWrapper')) layout();
      }

      function clearDragVisuals() {
        removeDragPreview();
        draggedElement?.classList.remove('tano-block-drag-source');
        draggedElement = null;
        marker.hidden = true;
        host.classList.remove('tano-block-dragging');
      }

      function clearDrag() {
        clearDragVisuals();
        dragging = false;
        pendingPointer = null;
        sourceIndex = null;
        startingDoc = null;
        hoveredIndex = null;
        showHoveredHandle();
      }

      function onHover(event: MouseEvent) {
        if (dragging || (readonly() && !folding())) return;
        if (event.type === 'mousemove') hoverSuppressed = false;
        if (hoverSuppressed) return;
        setHovered(blockIndexAt(event.target) ?? blockIndexAtCoords(event.clientX, event.clientY));
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
        if (dragging) return;
        setHovered(null);
      }

      function onHandleClick(event: MouseEvent) {
        if (suppressClick) {
          suppressClick = false;
          event.preventDefault();
          return;
        }
        const handle = (event.target as Element).closest<HTMLButtonElement>('.tano-block-handle');
        if (!handle || readonly()) return;
        const index = Number(handle.dataset.blockIndex);
        const pos = positions[index];
        if (pos == null) return;
        event.preventDefault();
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        view.focus();
      }

      function onFoldClick(event: MouseEvent) {
        const button = (event.target as Element).closest<HTMLButtonElement>('.tano-fold-toggle');
        if (!button || !folding()) return;
        const index = foldButtons.indexOf(button);
        if (index < 0 || !foldable(view.state.doc.child(index))) return;
        event.preventDefault();
        event.stopPropagation();
        const key = blockKey(index);
        view.dispatch(view.state.tr.setMeta(foldingKey, key).setMeta('addToHistory', false));
      }

      function findInsertion(y: number) {
        for (let index = 0; index < view.state.doc.childCount; index++) {
          const rect = blockRect(index);
          if (rect && y < (rect.top + rect.bottom) / 2) return index;
        }
        return view.state.doc.childCount;
      }

      function showInsertion(index: number) {
        if (sourceIndex === index || (sourceIndex != null && sourceIndex + 1 === index)) {
          marker.hidden = true;
          return;
        }
        const previous = index > 0 ? blockRect(index - 1) : null;
        const next = index < view.state.doc.childCount ? blockRect(index) : null;
        const y =
          previous && next ? (previous.bottom + next.top) / 2 : (next?.top ?? previous?.bottom);
        if (y == null) return;
        marker.style.top = `${y - host.getBoundingClientRect().top}px`;
        marker.hidden = false;
      }

      function beginPointerDrag(index: number, x: number, y: number) {
        const element = blockElement(index);
        if (!element) return;
        dragging = true;
        sourceIndex = index;
        startingDoc = view.state.doc;
        // Keep the preview outside contenteditable so it cannot enter Markdown.
        const preview = document.createElement('div');
        preview.className = 'tano-prose tano-block-drag-preview';
        preview.setAttribute('aria-hidden', 'true');
        preview.inert = true;
        preview.style.width = `${element.getBoundingClientRect().width}px`;
        preview.style.fontSize = getComputedStyle(view.dom).fontSize;
        const copy = element.cloneNode(true) as HTMLElement;
        for (const item of [copy, ...copy.querySelectorAll('*')]) {
          item.removeAttribute('id');
          item.removeAttribute('contenteditable');
          item.classList.remove('ProseMirror-selectednode', 'tano-block-drag-source');
        }
        preview.append(copy);
        host.append(preview);
        dragPreview = preview;
        movePreview(x, y);
        draggedElement = element;
        element.classList.add('tano-block-drag-source');
        host.classList.add('tano-block-dragging');
        showHoveredHandle();
      }

      function movePreview(x: number, y: number) {
        if (dragPreview) dragPreview.style.transform = `translate3d(${x + 16}px, ${y + 16}px, 0)`;
      }

      function onPointerDown(event: PointerEvent) {
        const handle = (event.target as Element).closest<HTMLButtonElement>('.tano-block-handle');
        if (!handle || readonly() || event.button !== 0) return;
        pendingPointer = {
          id: event.pointerId,
          index: Number(handle.dataset.blockIndex),
          x: event.clientX,
          y: event.clientY,
          doc: view.state.doc,
        };
        handle.setPointerCapture?.(event.pointerId);
      }

      function onPointerMove(event: PointerEvent) {
        const pending = pendingPointer;
        if (!pending || event.pointerId !== pending.id) return;
        if (readonly() || !pending.doc.eq(view.state.doc)) {
          clearDrag();
          return;
        }
        if (!dragging) {
          const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
          if (distance < 5) return;
          beginPointerDrag(pending.index, event.clientX, event.clientY);
        }
        if (!dragging) return;
        event.preventDefault();
        movePreview(event.clientX, event.clientY);
        showInsertion(findInsertion(event.clientY));
      }

      function onPointerUp(event: PointerEvent) {
        const pending = pendingPointer;
        if (!pending || event.pointerId !== pending.id) return;
        const wasDragging = dragging;
        const rect = hoverSurface.getBoundingClientRect();
        const inside =
          rect.width > 0 && rect.height > 0
            ? event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom
            : event.target instanceof window.Node && hoverSurface.contains(event.target);
        // A remote collaborator or a local edit may have changed positions mid-drag.
        if (
          dragging &&
          inside &&
          sourceIndex != null &&
          !readonly() &&
          startingDoc?.eq(view.state.doc)
        ) {
          const target = findInsertion(event.clientY);
          const transaction = moveBlock(view.state, sourceIndex, target);
          if (transaction) view.dispatch(transaction.scrollIntoView());
        }
        if (wasDragging) {
          event.preventDefault();
          suppressClick = true;
          if (clickResetTimer != null) clearTimeout(clickResetTimer);
          clickResetTimer = window.setTimeout(() => {
            suppressClick = false;
            clickResetTimer = null;
          }, 0);
        }
        clearDrag();
      }

      function onPointerCancel(event: PointerEvent) {
        if (pendingPointer?.id === event.pointerId) clearDrag();
      }

      function onKeyDown(event: KeyboardEvent) {
        const handle = (event.target as Element).closest<HTMLButtonElement>('.tano-block-handle');
        if (!handle || !event.altKey || readonly()) return;
        const index = Number(handle.dataset.blockIndex);
        const target =
          event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 2 : -1;
        const transaction = moveBlock(view.state, index, target);
        if (!transaction) return;
        event.preventDefault();
        view.dispatch(transaction.scrollIntoView());
        handles[event.key === 'ArrowUp' ? index - 1 : index + 1]?.focus();
      }

      controls.addEventListener('pointerdown', onPointerDown);
      controls.addEventListener('keydown', onKeyDown);
      controls.addEventListener('click', onHandleClick);
      controls.addEventListener('click', onFoldClick);
      view.dom.addEventListener('keydown', onEditorKeyDown, true);
      view.dom.addEventListener('beforeinput', onEditorInput, true);
      view.dom.addEventListener('compositionstart', onEditorInput, true);
      view.dom.addEventListener('scroll', onTableScroll, true);
      view.dom.addEventListener('tano-table-layout', layout);
      hoverSurface.addEventListener('mouseover', onHover);
      hoverSurface.addEventListener('mousemove', onHover);
      hoverSurface.addEventListener('mouseleave', onHoverLeave);
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerCancel, true);
      window.addEventListener('blur', clearDrag);
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(layout);
      observer?.observe(view.dom);
      window.addEventListener('resize', layout);
      layout();

      return {
        update(nextView) {
          view = nextView;
          if (startingDoc && !startingDoc.eq(view.state.doc)) {
            clearDrag();
          }
          layout();
        },
        destroy() {
          clearDrag();
          if (clickResetTimer != null) clearTimeout(clickResetTimer);
          observer?.disconnect();
          window.removeEventListener('resize', layout);
          window.removeEventListener('pointermove', onPointerMove, true);
          window.removeEventListener('pointerup', onPointerUp, true);
          window.removeEventListener('pointercancel', onPointerCancel, true);
          window.removeEventListener('blur', clearDrag);
          controls.removeEventListener('pointerdown', onPointerDown);
          controls.removeEventListener('keydown', onKeyDown);
          controls.removeEventListener('click', onHandleClick);
          controls.removeEventListener('click', onFoldClick);
          view.dom.removeEventListener('keydown', onEditorKeyDown, true);
          view.dom.removeEventListener('beforeinput', onEditorInput, true);
          view.dom.removeEventListener('compositionstart', onEditorInput, true);
          view.dom.removeEventListener('scroll', onTableScroll, true);
          view.dom.removeEventListener('tano-table-layout', layout);
          hoverSurface.removeEventListener('mouseover', onHover);
          hoverSurface.removeEventListener('mousemove', onHover);
          hoverSurface.removeEventListener('mouseleave', onHoverLeave);
          controls.remove();
        },
      };
    },
  });
}
