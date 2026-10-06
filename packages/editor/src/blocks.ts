import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { blockType, blockTypes, featureLevel } from './document-model';
import { blockTree, moveBlockTo, moveBlockBeside, moveBlockSibling, indentBlock, outdentBlock } from './block-tree';
import { closeHistory } from '@milkdown/kit/prose/history';

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
  doc.forEach((node, offset, index) => {
    if (index === sourceIndex) sourcePos = offset;
  });
  return moveBlockTo(state, sourcePos, -1, insertionIndex);
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

/** List items fold their own continuation; list containers never fold sibling items. */
function foldingTree(doc: ProseMirrorNode) {
  const entries: Pick<ReturnType<typeof blockTree>[number], 'node' | 'pos' | 'parent' | 'index'>[] =
    blockTree(doc).filter(({ node }) => node.type.name === 'heading');
  doc.descendants((node, pos, parent, index) => {
    if (node.type.name === 'list_item' && node.childCount > 1 && parent)
      entries.push({ node, pos, parent, index });
  });
  return entries.sort((a, b) => a.pos - b.pos);
}

/** Measure the visible first text line, including content inset in tables and code blocks. */
function firstLineCenter(element: Element, block: DOMRect): number {
  const header = element.querySelector(':scope > .tano-enhanced-header, :scope > .tano-callout-title');
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
    ? element.querySelector('tr') : null;
  const firstItem = element.matches('ul, ol') ? element.querySelector('li') : null;
  const firstParagraph = element.matches('blockquote') ? element.querySelector(':scope > p') : null;
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
export function blockControls(readonly: () => boolean, folding: () => boolean = () => true, columns: () => boolean = () => true) {
  const foldingKey = new PluginKey<Set<string>>('tano-folding');
  return new Plugin({
    key: foldingKey,
    state: {
      init: () => new Set<string>(),
      apply(transaction, current) {
        const reveal = transaction.getMeta('tanoRevealPosition') as number | undefined;
        if (reveal !== undefined && current.size) {
          const next = new Set(current);
          foldingTree(transaction.doc).forEach(({ node, pos, parent, index }) => {
            const key = `${pos}:${node.type.name}:${node.textContent.slice(0, 80)}`;
            if (!next.has(key)) return;
            if (node.type.name === 'heading') {
              let end = pos + node.nodeSize;
              for (let i = index + 1; i < parent.childCount; i++) {
                const sibling = parent.child(i);
                if (sibling.type.name === 'heading' && Number(sibling.attrs.level) <= Number(node.attrs.level)) break;
                end += sibling.nodeSize;
              }
              if (reveal >= pos + node.nodeSize && reveal < end) next.delete(key);
            } else if (reveal > pos && reveal < pos + node.nodeSize) next.delete(key);
          });
          return next;
        }
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
        const tree = blockTree(state.doc);
        const foldTargets = foldingTree(state.doc);
        foldTargets.forEach(({ node, pos, parent, index }) => {
          if (!folded.has(`${pos}:${node.type.name}:${node.textContent.slice(0, 80)}`)) return;
          if (node.type.name === 'heading') {
            const level = Number(node.attrs.level ?? 1);
            let nextPos = pos + node.nodeSize;
            for (let next = index + 1; next < parent.childCount; next++) {
              const nextNode = parent.child(next);
              if (nextNode.type.name === 'heading' && Number(nextNode.attrs.level ?? 1) <= level)
                break;
              hidden.add(nextPos);
              nextPos += nextNode.nodeSize;
            }
          }
        });
        const decorations: Decoration[] = [];
        tree.forEach(({ node, pos: offset }) => {
          if (hidden.has(offset))
            decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'tano-folded-heading-content' }));
        });
        foldTargets.forEach(({ node, pos }) => {
          if (node.type.name !== 'list_item' ||
            !folded.has(`${pos}:${node.type.name}:${node.textContent.slice(0, 80)}`)) return;
          node.forEach((child, offset, index) => {
            if (index > 0) decorations.push(Decoration.node(pos + 1 + offset,
              pos + 1 + offset + child.nodeSize, { class: 'tano-folded-list-content' }));
          });
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
      let hoveredFoldIndex: number | null = null;
      let hoverSuppressed = false;
      const handles: HTMLButtonElement[] = [];
      const foldButtons: HTMLButtonElement[] = [];
      let entries = blockTree(view.state.doc);
      let foldEntries = foldingTree(view.state.doc);
      let positions: number[] = [];

      function blockKey(index: number) {
        const { node, pos } = foldEntries[index]!;
        return `${pos}:${node.type.name}:${node.textContent.slice(0, 80)}`;
      }

      function showHoveredHandle() {
        const hovered = hoveredIndex == null ? null : entries[hoveredIndex];
        handles.forEach((handle, index) => {
          const entry = entries[index]!;
          handle.classList.toggle(
            'is-visible',
            index === hoveredIndex || (dragging && index === sourceIndex) ||
              (!dragging && !!hovered && entry.node.type.name === 'tano_columns' &&
                entry.pos < hovered.pos && hovered.pos < entry.pos + entry.node.nodeSize),
          );
        });
        foldButtons.forEach((button, index) => {
          button.classList.toggle(
            'is-visible',
            folding() &&
              (index === hoveredFoldIndex || (foldingKey.getState(view.state) ?? new Set()).has(blockKey(index))),
          );
        });
      }

      function setHovered(index: number | null, foldIndex: number | null = null) {
        if (hoveredIndex === index && hoveredFoldIndex === foldIndex) return;
        hoveredIndex = index;
        hoveredFoldIndex = foldIndex;
        showHoveredHandle();
      }

      function blockIndexAt(target: EventTarget | null): number | null {
        if (!(target instanceof Element)) return null;
        const handle = target.closest<HTMLButtonElement>('.tano-block-handle');
        if (handle && controls.contains(handle)) return Number(handle.dataset.blockIndex);
        if (!view.dom.contains(target)) return null;
        for (let index = entries.length - 1; index >= 0; index--)
          if (blockElement(index)?.contains(target)) return index;
        return null;
      }

      function blockElement(index: number) {
        const pos = positions[index];
        if (pos == null) return null;
        const element = view.nodeDOM(pos);
        return element instanceof Element ? element : null;
      }

      function blockRect(index: number) {
        const element = blockElement(index);
        if (!element || element.closest('[hidden], .tano-folded-heading-content, .tano-folded-list-content')) return null;
        return element.getBoundingClientRect();
      }

      function foldElement(index: number) {
        const element = view.nodeDOM(foldEntries[index]!.pos);
        return element instanceof Element ? element : null;
      }

      function foldRect(index: number) {
        const element = foldElement(index);
        if (!element || element.closest('[hidden], .tano-folded-heading-content, .tano-folded-list-content')) return null;
        return element.getBoundingClientRect();
      }

      function foldLeft(index: number, element: Element, rect: DOMRect) {
        return foldEntries[index]!.node.type.name === 'list_item'
          ? element.parentElement!.getBoundingClientRect().left : rect.left;
      }

      function foldIndexAt(target: EventTarget | null, x: number, y: number) {
        if (target instanceof Element) {
          const button = target.closest<HTMLButtonElement>('.tano-fold-toggle');
          if (button && controls.contains(button)) return foldButtons.indexOf(button);
          if (view.dom.contains(target)) {
            for (let index = foldEntries.length - 1; index >= 0; index--)
              if (foldRect(index) && foldElement(index)?.contains(target)) return index;
            return null;
          }
        }
        for (let index = foldEntries.length - 1; index >= 0; index--) {
          const rect = foldRect(index);
          const element = foldElement(index);
          if (rect && element && x >= foldLeft(index, element, rect) - 24 &&
            x <= rect.right + 24 && y >= rect.top && y <= rect.bottom)
            return index;
        }
        return null;
      }

      function blockIndexAtCoords(x: number, y: number) {
        let closest: number | null = null;
        let closestDistance = Infinity;
        for (let index = entries.length - 1; index >= 0; index--) {
          const rect = blockRect(index);
          if (
            !rect ||
            x < rect.left - 60 ||
            x > rect.right + 24 ||
            y < rect.top - 12 ||
            y > rect.bottom + 12
          )
            continue;
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

      function layout() {
        if (readonly() && !folding()) {
          clearDrag();
          controls.hidden = true;
          return;
        }
        controls.hidden = false;
        entries = blockTree(view.state.doc);
        foldEntries = foldingTree(view.state.doc);
        const count = entries.length;
        positions = entries.map(({ pos }) => pos);
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
        while (foldButtons.length > foldEntries.length) foldButtons.pop()!.remove();
        while (foldButtons.length < foldEntries.length) {
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
        const pane = hoverSurface.getBoundingClientRect();
        const gutterLeft = pane.width > 0 ? pane.left + 4 : -Infinity;
        for (let index = 0; index < count; index++) {
          const handle = handles[index];
          const element = blockElement(index);
          const rect = blockRect(index);
          handle.classList.toggle('is-column-child', !!element?.parentElement?.closest('.tano-columns'));
          handle.classList.toggle('is-columns', entries[index]!.node.type.name === 'tano_columns');
          handle.style.left = rect && handle.classList.contains('is-column-child')
            ? `${Math.max(-36, gutterLeft - rect.left)}px` : '';
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
            `点击选中第 ${index + 1} 个${kind.endsWith('块') ? kind : `${kind}块`}，拖动调整顺序`,
          );
          handle.title = `${kind}；点击选中；拖动换位；Alt+↑/↓ 同级排序；Alt+←/→ 移出/移入容器`;
          if (element && rect)
            handle.style.top = `${firstLineCenter(element, rect) - top - (handle.offsetHeight || 24) / 2}px`;
          handle.hidden = readonly() || !rect;
          const table = element?.matches('.tano-table-viewport:not(.has-comments)') ? element.querySelector('table') : null;
          handle.style.transform = table ? `translateX(${table.getBoundingClientRect().left - hostLeft}px)`
            : rect && entries[index]!.depth > 0 ? `translateX(${rect.left - hostLeft}px)` : '';
          handle.style.clipPath = '';
          if (table) {
            const pane = hoverSurface.getBoundingClientRect();
            const bounds = handle.getBoundingClientRect();
            if (pane.width > 0 && bounds.width > 0)
              handle.style.clipPath = `inset(0 ${Math.max(0, bounds.right - pane.right)}px 0 ${Math.max(0, pane.left - bounds.left)}px)`;
          }
        }
        // Place outer column controls beyond the first column's controls. If the
        // viewport has no spare gutter, stack them above the row instead.
        for (let index = count - 1; index >= 0; index--) {
          const entry = entries[index]!;
          if (entry.node.type.name !== 'tano_columns') continue;
          const rect = blockRect(index);
          if (!rect) continue;
          let left = rect.left - 60;
          let above = rect.top - 28;
          for (let child = index + 1; child < count && entries[child]!.pos < entry.pos + entry.node.nodeSize; child++) {
            const childRect = blockRect(child);
            if (!childRect || childRect.left > rect.left + 1) continue;
            const bounds = handles[child]!.getBoundingClientRect();
            if (bounds.width === 0) continue;
            left = Math.min(left, bounds.left - 24);
            above = Math.min(above, bounds.top - 28);
          }
          const stacked = left < gutterLeft;
          const anchor = entry.depth > 0 ? rect.left : hostLeft;
          handles[index]!.style.left = `${(stacked ? Math.max(gutterLeft, rect.left - 36) : left) - anchor}px`;
          if (stacked) handles[index]!.style.top = `${above - top}px`;
        }
        for (let index = 0; index < foldEntries.length; index++) {
          const element = foldElement(index);
          const rect = foldRect(index);
          const foldButton = foldButtons[index];
          const canFold = folding();
          const isFolded = (foldingKey.getState(view.state) ?? new Set()).has(blockKey(index));
          foldButton.textContent = isFolded ? '▸' : '▾';
          foldButton.hidden = !rect || !canFold;
          foldButton.classList.toggle('is-folded', isFolded);
          foldButton.classList.toggle('is-visible', index === hoveredFoldIndex || isFolded);
          foldButton.dataset.blockPos = String(foldEntries[index]!.pos);
          foldButton.setAttribute('aria-hidden', String(!canFold));
          foldButton.setAttribute('aria-label', isFolded ? '展开内容' : '折叠内容');
          foldButton.title = isFolded ? '展开内容' : '折叠内容';
          if (element && rect)
            foldButton.style.top = `${firstLineCenter(element, rect) - top - (foldButton.offsetHeight || 24) / 2}px`;
          if (element && rect)
            foldButton.style.left = `${foldLeft(index, element, rect) - hostLeft - 18}px`;
        }
        if (hoveredIndex != null && hoveredIndex >= count) hoveredIndex = null;
        if (hoveredFoldIndex != null && hoveredFoldIndex >= foldEntries.length) hoveredFoldIndex = null;
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
        hoveredFoldIndex = null;
        showHoveredHandle();
      }

      function onHover(event: MouseEvent) {
        if (dragging || (readonly() && !folding())) return;
        if (event.type === 'mousemove') hoverSuppressed = false;
        if (hoverSuppressed) return;
        setHovered(hoveredHandleBridge(event) ?? blockIndexAt(event.target) ?? blockIndexAtCoords(event.clientX, event.clientY),
          foldIndexAt(event.target, event.clientX, event.clientY));
      }

      function hoveredHandleBridge(event: MouseEvent) {
        if (hoveredIndex == null) return null;
        const handle = handles[hoveredIndex];
        if (!handle || handle.hidden || (!handle.classList.contains('is-column-child') && !handle.classList.contains('is-columns'))) return null;
        if (event.target instanceof Element && event.target.closest('.tano-block-handle')) return null;
        const hovered = entries[hoveredIndex]!;
        const targetIndex = blockIndexAt(event.target);
        const target = targetIndex == null ? null : entries[targetIndex];
        if (target && targetIndex !== hoveredIndex && !(target.node.type.name === 'tano_columns' &&
          target.pos < hovered.pos && hovered.pos < target.pos + target.node.nodeSize)) return null;
        const block = blockRect(hoveredIndex);
        const bounds = handle.getBoundingClientRect();
        if (!block || bounds.width === 0) return null;
        let left = bounds.left;
        let top = Math.min(bounds.top, block.top);
        handles.forEach((ancestor, index) => {
          const entry = entries[index]!;
          if (entry.node.type.name !== 'tano_columns' || entry.pos >= hovered.pos ||
            hovered.pos >= entry.pos + entry.node.nodeSize) return;
          const rect = ancestor.getBoundingClientRect();
          if (ancestor.hidden || rect.width === 0) return;
          left = Math.min(left, rect.left);
          top = Math.min(top, rect.top);
        });
        // The column gap (including its separator) belongs to the parent DOM node.
        // Keep the child's handle reachable while crossing that gap from its content.
        return event.clientX >= left && event.clientX <= Math.max(bounds.right, block.left) &&
          event.clientY >= top - 4 &&
          event.clientY <= Math.max(bounds.bottom, block.bottom) + 4 ? hoveredIndex : null;
      }

      function onEditorInput() {
        hoverSuppressed = true;
        setHovered(null);
      }

      function dismissBlockSelection(event: PointerEvent) {
        const { selection, doc } = view.state;
        const target = event.target;
        if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey ||
          view.composing || view.dragging || pendingPointer ||
          !(selection instanceof NodeSelection) || !selection.node.isBlock ||
          !(target instanceof Element)) return;
        // Keep the selection available to block actions and floating editor controls.
        if (target.closest('.tano-block-controls, .tano-editor-panel, [role="menu"], button, input, textarea, select')) return;
        const selectedDOM = view.nodeDOM(selection.from);
        if (selectedDOM?.contains(target)) return;
        // Backgrounds and noneditable previews do not update ProseMirror's selection.
        // Let the subsequent native click still place the caret or start a new selection.
        const caret = TextSelection.findFrom(selection.$from, 1, true) ??
          TextSelection.findFrom(doc.resolve(selection.to), -1, true);
        if (caret) view.dispatch(view.state.tr.setSelection(caret)
          .setMeta('addToHistory', false).setMeta('tanoKeepNodeView', true));
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
        if (index < 0 || button.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        const key = blockKey(index);
        view.dispatch(view.state.tr.setMeta(foldingKey, key).setMeta('addToHistory', false));
      }

      function findInsertion(x: number, y: number) {
        let parentPos = -1;
        let depth = 0;
        const source = sourceIndex == null ? null : entries[sourceIndex];
        // The horizontal inset chooses the parent. A container header remains a sibling target.
        for (const entry of entries) {
          if (entry.parentPos < 0 || (source && entry.parentPos >= source.pos && entry.parentPos < source.pos + source.node.nodeSize)) continue;
          const dom = view.nodeDOM(entry.parentPos);
          const content = dom instanceof Element
            ? dom.matches('blockquote') ? dom : dom.querySelector(':scope > .tano-enhanced-content')
            : null;
          if (!content || content.closest('[hidden], .tano-folded-heading-content, .tano-folded-list-content')) continue;
          const rect = content.getBoundingClientRect();
          const firstBody = dom instanceof Element && dom.matches('blockquote')
            ? view.nodeDOM(entry.pos) : null;
          const bodyTop = firstBody instanceof Element ? firstBody.getBoundingClientRect().top : rect.top;
          if (entry.depth >= depth && x >= rect.left + 12 && x <= rect.right && y >= bodyTop && y <= rect.bottom) {
            parentPos = entry.parentPos;
            depth = entry.depth;
          }
        }
        const siblings = entries.map((entry, i) => ({ ...entry, rect: blockRect(i) })).filter((entry) => entry.parentPos === parentPos);
        const next = siblings.find(({ rect }) => rect && y < (rect.top + rect.bottom) / 2);
        const parent = parentPos === -1 ? view.state.doc : view.state.doc.nodeAt(parentPos)!;
        const index = next?.index ?? parent.childCount;
        const previous = siblings.find((entry) => entry.index === index - 1)?.rect;
        const rect = next?.rect ?? previous;
        return { parentPos, index, y: previous && next?.rect ? (previous.bottom + next.rect.top) / 2 : (next?.rect?.top ?? previous?.bottom), rect };
      }

      function findDropTarget(x: number, y: number) {
        const source = sourceIndex == null ? null : entries[sourceIndex];
        if (source && columns() && window.innerWidth > 640) {
          // Prefer the deepest visible block. Top/bottom edges keep ordinary vertical sorting.
          for (let index = entries.length - 1; index >= 0; index--) {
            const target = entries[index]!;
            const rect = blockRect(index);
            if (!rect || rect.width <= 0 || rect.height <= 0) continue;
            const inset = Math.min(8, rect.height * 0.2);
            if (y < rect.top + inset || y > rect.bottom - inset) continue;
            const edge = Math.min(48, rect.width * 0.18);
            const side: 'left' | 'right' | null = x >= rect.left - 20 && x <= rect.left + edge ? 'left'
              : x >= rect.right - edge && x <= rect.right + 20 ? 'right' : null;
            if (side && moveBlockBeside(view.state, source.pos, target.pos, side))
              return { kind: 'column' as const, pos: target.pos, side, rect };
          }
        }
        return { kind: 'vertical' as const, ...findInsertion(x, y) };
      }

      function showInsertion(target: ReturnType<typeof findDropTarget>) {
        const source = sourceIndex == null ? null : entries[sourceIndex];
        const hostRect = host.getBoundingClientRect();
        marker.classList.toggle('is-column', target.kind === 'column');
        if (target.kind === 'column') {
          marker.hidden = false;
          marker.style.top = `${target.rect.top - hostRect.top}px`;
          marker.style.left = `${(target.side === 'left' ? target.rect.left : target.rect.right) - hostRect.left}px`;
          marker.style.width = '3px';
          marker.style.height = `${target.rect.height}px`;
          return;
        }
        marker.hidden = !source || target.y == null || !moveBlockTo(view.state, source.pos, target.parentPos, target.index);
        if (marker.hidden) return;
        marker.style.height = '2px';
        marker.style.top = `${target.y! - hostRect.top}px`;
        marker.style.left = `${(target.rect?.left ?? hostRect.left) - hostRect.left}px`;
        marker.style.width = `${target.rect?.width ?? hostRect.width}px`;
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
        copy.querySelectorAll('.tano-column-controls').forEach(element => element.remove());
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
        showInsertion(findDropTarget(event.clientX, event.clientY));
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
          const target = findDropTarget(event.clientX, event.clientY);
          const transaction = target.kind === 'column'
            ? moveBlockBeside(view.state, entries[sourceIndex]!.pos, target.pos, target.side)
            : moveBlockTo(view.state, entries[sourceIndex]!.pos, target.parentPos, target.index, false);
          if (transaction) {
            view.dispatch(closeHistory(transaction.scrollIntoView()));
            view.dispatch(closeHistory(view.state.tr));
          }
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

      function onDragKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Escape' || !pendingPointer) return;
        event.preventDefault();
        event.stopPropagation();
        clearDrag();
      }

      function onKeyDown(event: KeyboardEvent) {
        const handle = (event.target as Element).closest<HTMLButtonElement>('.tano-block-handle');
        if (!handle || !event.altKey || readonly()) return;
        const index = Number(handle.dataset.blockIndex);
        const pos = positions[index];
        if (pos == null) return;
        const transaction = event.key === 'ArrowLeft' ? outdentBlock(view.state, pos)
          : event.key === 'ArrowRight' ? indentBlock(view.state, pos)
          : event.key === 'ArrowUp' || event.key === 'ArrowDown'
            ? moveBlockSibling(view.state, pos, event.key === 'ArrowUp' ? -1 : 1) : null;
        if (!transaction) return;
        event.preventDefault();
        view.dispatch(transaction.scrollIntoView());
        handles[positions.indexOf(view.state.selection.from)]?.focus();
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
      view.dom.addEventListener('tano-block-layout', layout);
      hoverSurface.addEventListener('mouseover', onHover);
      hoverSurface.addEventListener('mousemove', onHover);
      hoverSurface.addEventListener('mouseleave', onHoverLeave);
      hoverSurface.addEventListener('pointerdown', dismissBlockSelection, true);
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerCancel, true);
      window.addEventListener('keydown', onDragKeyDown, true);
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
          window.removeEventListener('keydown', onDragKeyDown, true);
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
          view.dom.removeEventListener('tano-block-layout', layout);
          hoverSurface.removeEventListener('mouseover', onHover);
          hoverSurface.removeEventListener('mousemove', onHover);
          hoverSurface.removeEventListener('mouseleave', onHoverLeave);
          hoverSurface.removeEventListener('pointerdown', dismissBlockSelection, true);
          controls.remove();
        },
      };
    },
  });
}
