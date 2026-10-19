import { Fragment } from '@milkdown/kit/prose/model';
import type { Node } from '@milkdown/kit/prose/model';
import { NodeSelection, Plugin, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';
import { isCalloutHeader } from './callout';

function emptyBlock(node: Node): boolean {
  if (node.isTextblock) return node.content.size === 0;
  if (node.type.name === 'math_block') return !String(node.attrs.value ?? '').length;
  // Leaf resources (images, files, embeds, raw HTML) have no textContent but are
  // content, not empty blocks. Only known containers can be collapsed here.
  if (
    ![
      'blockquote',
      'bullet_list',
      'ordered_list',
      'list_item',
      'table',
      'table_row',
      'table_cell',
      'table_header',
      'tano_toggle',
      'tano_tabs',
      'tano_columns',
      'tano_panel',
    ].includes(node.type.name)
  )
    return false;
  let empty = true;
  node.forEach((child, _offset, index) => {
    if (
      node.type.name === 'blockquote' &&
      index === 0 &&
      child.type.name === 'paragraph' &&
      child.childCount === 1 &&
      child.firstChild?.isText &&
      isCalloutHeader(child.textContent)
    )
      return;
    if (!emptyBlock(child)) empty = false;
  });
  return empty;
}

/** Remove the empty editing block, including its empty container, atomically. */
export function deleteEmptyBlock(state: EditorState): Transaction | null {
  const { selection } = state;
  const { $from } = selection;
  let from: number;
  let node: Node;
  let parentDepth: number;
  if (
    selection instanceof TextSelection &&
    selection.empty &&
    $from.depth > 0 &&
    $from.parent.isTextblock &&
    emptyBlock($from.parent)
  ) {
    from = $from.before();
    node = $from.parent;
    parentDepth = $from.depth - 1;
  } else if (
    selection instanceof NodeSelection &&
    selection.node.isBlock &&
    emptyBlock(selection.node)
  ) {
    from = selection.from;
    node = selection.node;
    parentDepth = $from.depth;
  } else return null;

  // An empty list or quote should disappear as a block. If siblings contain
  // content, remove only the current empty item/paragraph and keep those siblings.
  while (parentDepth > 0 && emptyBlock($from.node(parentDepth))) {
    node = $from.node(parentDepth);
    from = $from.before(parentDepth);
    parentDepth--;
  }
  // Cells/rows and tab panels are structure, not independently removable text
  // blocks. Never damage a populated table or remove a tab as a side effect.
  if (['table_row', 'table_cell', 'table_header', 'tano_panel'].includes(node.type.name))
    return null;
  const $start = state.doc.resolve(from);
  const index = $start.index();
  if (!$start.parent.canReplace(index, index + 1, Fragment.empty)) {
    if ($start.depth !== 0 || state.doc.childCount !== 1 || node.type.name === 'paragraph')
      return null;
    // ProseMirror requires one block even when the user deletes the last one.
    const tr = state.tr.replaceWith(
      from,
      from + node.nodeSize,
      state.schema.nodes.paragraph!.create(),
    );
    tr.setSelection(TextSelection.create(tr.doc, from + 1));
    return closeHistory(tr).scrollIntoView();
  }
  const tr = state.tr.delete(from, from + node.nodeSize);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), -1));
  return closeHistory(tr).scrollIntoView();
}

export function emptyBlockDeletion(readonly: () => boolean) {
  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown(view, event) {
          if (
            !['Backspace', 'Delete'].includes(event.key) ||
            readonly() ||
            !view.editable ||
            event.isComposing ||
            view.composing ||
            event.keyCode === 229 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey ||
            event.target !== view.dom
          )
            return false;
          const tr = deleteEmptyBlock(view.state);
          if (!tr) return false;
          event.preventDefault();
          view.dispatch(tr);
          return true;
        },
      },
    },
  });
}
