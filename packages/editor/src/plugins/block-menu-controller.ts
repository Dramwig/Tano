import { computed, nextTick, ref, shallowRef, type ComputedRef, type Ref } from 'vue';
import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { Fragment, type Node } from '@milkdown/kit/prose/model';
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Selection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { isElement } from '../primitives/dom-realm';
import { BlockRangeSelection } from './block-selection';
import {
  blockTree,
  deleteBlock,
  deleteBlocks,
  indentBlock,
  isBlockContainer,
  moveBlockSibling,
  moveBlocksTo,
  outdentBlock,
} from './block-tree';
import { blockMenuStructure } from './block-menu-structure';
import { blockContentStart } from '../markdown/callout';
import { commandEnabled } from '../core/document-model';
import { normalizeCopyFormat, type CopyFormat, type WorkspaceCapabilities } from '../core/runtime';
import { tableLineAction } from './table-commands';

export interface BlockMenuState {
  index: number;
  x: number;
  y: number;
  doc: Node;
  selectionMenu?: boolean;
}

export type BlockSubmenuKind = 'convert' | 'wrap' | 'copy';

export interface BlockMenuControllerOptions {
  window: Window;
  document: Document;
  root: Ref<HTMLElement | undefined>;
  getEditor: () => Editor | undefined;
  getView: () => EditorView | undefined;
  isDisposed: () => boolean;
  readonly: () => boolean;
  policy: () => WorkspaceCapabilities;
  defaultCopyAction: ComputedRef<string>;
  clipboardContent: (
    ctx: Ctx,
    content: Fragment,
    format: CopyFormat | 'mathml' | 'tsv',
  ) => { text: string; html?: string };
  selectedBlocksSourceTransaction: (
    ctx: Ctx,
    state: EditorState,
    selection: BlockRangeSelection,
  ) => Transaction;
  blockNodeSourceTransaction: (
    ctx: Ctx,
    state: EditorState,
    selected: { node: Node; pos: number },
    tr: Transaction,
  ) => Transaction;
  setLocalSourceDismissOnOutside: () => void;
  setApplying: (value: boolean) => void;
  setTransitioningSource: (value: boolean) => void;
  onError: (message: string) => void;
}

export function createBlockMenuController(options: BlockMenuControllerOptions) {
  const {
    window,
    document,
    root,
    getEditor,
    getView,
    isDisposed,
    readonly,
    policy,
    defaultCopyAction,
    clipboardContent,
    selectedBlocksSourceTransaction,
    blockNodeSourceTransaction,
    setLocalSourceDismissOnOutside,
    setApplying,
    setTransitioningSource,
    onError,
  } = options;

  const blockMenuElement = ref<HTMLElement>();
  const blockMenu = shallowRef<BlockMenuState | null>(null);
  const blockConvertTrigger = ref<HTMLButtonElement>();
  const blockCopyTrigger = ref<HTMLButtonElement>();
  const blockWrapTrigger = ref<HTMLButtonElement>();
  const blockSubmenuKind = ref<BlockSubmenuKind>('convert');
  const blockConvertElement = ref<HTMLElement>();
  const blockConvertMenu = shallowRef<{ x: number; y: number } | null>(null);
  let blockConvertCloseTimer: ReturnType<typeof setTimeout> | undefined;
  let selectionBeforeMenu: { selection: Selection; doc: Node } | null = null;
  let rightClickSelection: { selection: Selection; doc: Node } | null = null;

  function blockSubmenuTrigger() {
    return blockSubmenuKind.value === 'copy'
      ? blockCopyTrigger
      : blockSubmenuKind.value === 'wrap'
        ? blockWrapTrigger
        : blockConvertTrigger;
  }

  function closeBlockConvertMenu(restoreFocus = false) {
    clearTimeout(blockConvertCloseTimer);
    blockConvertCloseTimer = undefined;
    blockConvertMenu.value = null;
    if (restoreFocus) blockSubmenuTrigger().value?.focus();
  }

  function scheduleCloseBlockConvertMenu() {
    clearTimeout(blockConvertCloseTimer);
    blockConvertCloseTimer = setTimeout(() => {
      closeBlockConvertMenu(!!blockConvertElement.value?.contains(document.activeElement));
    }, 150);
  }

  function closeBlockMenu(restoreSelection = true) {
    const saved = selectionBeforeMenu;
    closeBlockConvertMenu();
    blockMenu.value = null;
    selectionBeforeMenu = null;
    rightClickSelection = null;
    const editor = getEditor();
    if (!restoreSelection || !saved || !editor || isDisposed()) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view.state.doc.eq(saved.doc) && !view.state.selection.eq(saved.selection)) {
        view.dispatch(view.state.tr.setSelection(saved.selection).setMeta('addToHistory', false));
      }
    });
  }

  function blockIndexFromEvent(view: EditorView, target: EventTarget | null): number | null {
    if (!isElement(target)) return null;
    const handle = target.closest<HTMLElement>('.tano-block-handle');
    if (handle && root.value?.contains(handle)) {
      const index = blockTree(view.state.doc).findIndex(
        ({ pos }) => pos === Number(handle.dataset.blockPos),
      );
      return index < 0 ? null : index;
    }
    if (!view.dom.contains(target)) return null;
    const entries = blockTree(view.state.doc);
    for (let index = entries.length - 1; index >= 0; index--) {
      const dom = view.nodeDOM(entries[index]!.pos);
      if (isElement(dom) && dom.contains(target)) return index;
    }
    return null;
  }

  function rememberRightClickSelection(event: MouseEvent) {
    const editor = getEditor();
    if (event.button !== 2 || !editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (blockIndexFromEvent(view, event.target) == null) return;
      // ProseMirror otherwise moves the caret on right mousedown. For headings that
      // opens the live Markdown source before the contextmenu event can reach us.
      event.preventDefault();
      event.stopPropagation();
      const state = view.state;
      rightClickSelection = { selection: state.selection, doc: state.doc };
    });
  }

  function selectedContextTarget(event: MouseEvent) {
    const target = event.target;
    const bridgeView = getView();
    return (
      !readonly() &&
      !isDisposed() &&
      isElement(target) &&
      (root.value?.closest('.editor-scroll') ?? root.value)?.contains(target) &&
      !target.closest('button, input, textarea, select, [role="dialog"]') &&
      bridgeView &&
      !bridgeView.state.selection.empty
    );
  }

  function preserveSelectedContext(event: MouseEvent) {
    if (event.button !== 2 || !selectedContextTarget(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function openSelectedContext(event: MouseEvent) {
    if (!selectedContextTarget(event)) return;
    event.preventDefault();
    event.stopPropagation();
    openBlockMenu(event, undefined, true);
  }

  function openBlockMenu(event: MouseEvent, anchor?: HTMLElement, preserveSelection = false) {
    const editor = getEditor();
    if (!editor || readonly() || isDisposed()) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (anchor && view.state.selection instanceof BlockRangeSelection) preserveSelection = true;
      const index = preserveSelection
        ? blockTree(view.state.doc).findIndex(({ pos, node }) =>
            view.state.selection instanceof NodeSelection ||
            view.state.selection instanceof BlockRangeSelection
              ? pos === view.state.selection.from
              : pos <= view.state.selection.from && pos + node.nodeSize > view.state.selection.from,
          )
        : blockIndexFromEvent(view, event.target);
      if (index == null || index < 0) {
        if (blockMenu.value) closeBlockMenu();
        return;
      }
      event.preventDefault();
      if (blockMenu.value) closeBlockMenu();
      const previous = rightClickSelection?.doc.eq(view.state.doc)
        ? rightClickSelection
        : { selection: view.state.selection, doc: view.state.doc };
      rightClickSelection = null;
      const pos = blockTree(view.state.doc)[index]!.pos;
      if (!preserveSelection) {
        view.dispatch(
          view.state.tr
            .setSelection(NodeSelection.create(view.state.doc, pos))
            .setMeta('tanoBlockContextSelect', true)
            .setMeta('addToHistory', false),
        );
      }
      // Leaving a live heading source replaces its temporary node. The mapped
      // selection may become a caret, so select the restored block once more.
      if (
        !preserveSelection &&
        (!(view.state.selection instanceof NodeSelection) || view.state.selection.from !== pos)
      ) {
        view.dispatch(
          view.state.tr
            .setSelection(NodeSelection.create(view.state.doc, pos))
            .setMeta('tanoBlockContextSelect', true)
            .setMeta('addToHistory', false),
        );
      }
      selectionBeforeMenu = previous;
      blockMenu.value = {
        index,
        x: Math.max(8, event.clientX),
        y: Math.max(8, event.clientY),
        doc: view.state.doc,
        selectionMenu: preserveSelection && view.state.selection instanceof TextSelection,
      };
      const openedMenu = blockMenu.value;
      void nextTick(() => {
        const menu = blockMenuElement.value;
        if (!menu || blockMenu.value !== openedMenu) return;
        const bounds = anchor?.getBoundingClientRect();
        // Handle clicks open beside the block; right clicks stay at the pointer.
        const left = bounds ? bounds.left - menu.offsetWidth - 8 : openedMenu.x;
        const x = bounds && left < 8 ? bounds.right + 8 : left;
        const y = bounds?.top ?? openedMenu.y;
        blockMenu.value = {
          ...openedMenu,
          x: Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)),
          y: Math.max(
            8,
            preserveSelection && y + menu.offsetHeight > window.innerHeight - 8
              ? y - menu.offsetHeight
              : Math.min(y, window.innerHeight - menu.offsetHeight - 8),
          ),
        };
        menu.focus({ preventScroll: true });
      });
    });
  }

  function blockMenuCommandAvailable(name: string) {
    const current = blockMenu.value;
    const bridgeView = getView();
    return (
      !!current &&
      !!bridgeView &&
      (name === 'unwrap' ||
        commandEnabled(
          name.startsWith('wrap-') ? name.slice(5) : name,
          policy().features,
        )) &&
      !!blockMenuStructure(bridgeView.state, name)
    );
  }

  function blockMenuSelectionCount() {
    return selectionBeforeMenu?.selection instanceof BlockRangeSelection
      ? selectionBeforeMenu.selection.blocks.length
      : 1;
  }

  const blockMenuTable = computed(() => {
    const current = blockMenu.value;
    if (!current || current.selectionMenu || blockMenuSelectionCount() > 1) return null;
    const entry = blockTree(current.doc)[current.index];
    return entry?.node.type.name === 'table' ? entry.node : null;
  });

  function selectedBlocksMenuTransaction(state: EditorState, action: string): Transaction | null {
    const selection = state.selection;
    if (!(selection instanceof BlockRangeSelection)) return null;
    const blocks = selection.blocks;
    const first = blocks[0]!;
    const last = blocks.at(-1)!;
    const positions = blocks.map((block) => block.pos);
    if (action === 'delete') return deleteBlocks(state, positions);
    if (action === 'duplicate') {
      const at = last.pos + last.node.nodeSize;
      const tr = state.tr.insert(at, selection.content().content);
      let pos = at;
      const copied = blocks.map((block) => {
        const start = pos;
        pos += block.node.nodeSize;
        return start;
      });
      return tr.setSelection(BlockRangeSelection.fromBlocks(tr.doc, copied)!);
    }
    if (
      !blocks.every(
        (block, index) => block.parentPos === first.parentPos && block.index === first.index + index,
      )
    ) {
      return null;
    }
    let parentPos = first.parentPos;
    let index = first.index;
    if (action === 'move-up') index--;
    else if (action === 'move-down') index = last.index + 2;
    else if (action === 'indent') {
      if (first.index <= blockContentStart(first.parent)) return null;
      const previous = first.parent.child(first.index - 1);
      if (!isBlockContainer(previous)) return null;
      parentPos = first.pos - previous.nodeSize;
      index = previous.childCount;
    } else if (action === 'outdent') {
      const owner = blockTree(state.doc).find(
        (entry) =>
          entry.pos <= first.parentPos &&
          first.parentPos < entry.pos + entry.node.nodeSize &&
          entry.depth === first.depth - (first.parent.type.name === 'tano_panel' ? 2 : 1),
      );
      if (!owner) return null;
      parentPos = owner.parentPos;
      index = owner.index + 1;
    } else return null;
    const tr = moveBlocksTo(state, positions, parentPos, index, true);
    if (!tr) return null;
    let pos = tr.selection.from;
    const moved = blocks.map((block) => {
      const start = pos;
      pos += block.node.nodeSize;
      return start;
    });
    return tr.setSelection(BlockRangeSelection.fromBlocks(tr.doc, moved)!);
  }

  function blockShortcut(action: string) {
    const view = getView();
    if (!view || readonly() || isDisposed()) return;
    const state = view.state;
    const selection = state.selection;
    let tr: Transaction | null = null;
    if (selection instanceof BlockRangeSelection) tr = selectedBlocksMenuTransaction(state, action);
    else if (selection instanceof NodeSelection && selection.node.isBlock) {
      tr =
        action === 'delete'
          ? deleteBlocks(state, [selection.from])
          : action === 'indent'
            ? indentBlock(state, selection.from)
            : action === 'outdent'
              ? outdentBlock(state, selection.from)
              : moveBlockSibling(state, selection.from, action === 'move-up' ? -1 : 1);
    }
    if (tr) {
      closeBlockMenu(false);
      view.dispatch(tr.scrollIntoView());
      view.focus();
    }
  }

  function blockMenuMoveAvailable(action: string) {
    const current = blockMenu.value;
    const editor = getEditor();
    if (!current || !editor) return false;
    return editor.action((ctx) => {
      const state = ctx.get(editorViewCtx).state;
      if (!state.doc.eq(current.doc)) return false;
      if (state.selection instanceof BlockRangeSelection) {
        return !!selectedBlocksMenuTransaction(state, action);
      }
      const pos = blockTree(state.doc)[current.index]?.pos;
      if (pos == null) return false;
      return !!(action === 'indent'
        ? indentBlock(state, pos)
        : action === 'outdent'
          ? outdentBlock(state, pos)
          : moveBlockSibling(state, pos, action === 'move-up' ? -1 : 1));
    });
  }

  function menuCopyContent(ctx: Ctx, table = false): Fragment | null {
    const current = blockMenu.value;
    if (!current) return null;
    const view = ctx.get(editorViewCtx);
    if (!view.state.doc.eq(current.doc)) return null;
    if (table) {
      const { $from, $to } = view.state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if (
          $from.node(depth).type.name === 'table' &&
          $to.depth >= depth &&
          $to.node(depth) === $from.node(depth)
        ) {
          return Fragment.from($from.node(depth));
        }
      }
    }
    return current.selectionMenu || view.state.selection instanceof BlockRangeSelection
      ? view.state.selection.content().content
      : Fragment.from(blockTree(view.state.doc)[current.index]!.node);
  }

  const specialCopyFormats = computed(() => {
    const editor = getEditor();
    if (!blockMenu.value || !editor) return { mathml: false, tsv: false };
    return editor.action((ctx) => {
      let formulas = 0;
      let tables = 0;
      menuCopyContent(ctx)?.descendants((node) => {
        if (node.type.name === 'math_inline' || node.type.name === 'math_block') formulas++;
      });
      menuCopyContent(ctx, true)?.descendants((node) => {
        if (node.type.name === 'table') tables++;
      });
      return { mathml: formulas === 1, tsv: tables === 1 };
    });
  });

  async function blockMenuAction(action: string) {
    const current = blockMenu.value;
    const editor = getEditor();
    if (!current || !editor || readonly()) return;
    if (
      [
        'copy',
        'copy-html',
        'copy-text',
        'copy-rich',
        'copy-wechat',
        'copy-zhihu',
        'copy-mathml',
        'copy-tsv',
      ].includes(action)
    ) {
      let copied: { text: string; html?: string } | null;
      try {
        copied = editor.action((ctx) => {
          const content = menuCopyContent(ctx, action === 'copy-tsv');
          if (!content) return null;
          const format =
            action === 'copy-mathml'
              ? 'mathml'
              : action === 'copy-tsv'
                ? 'tsv'
                : normalizeCopyFormat(action.slice(5));
          return clipboardContent(ctx, content, format);
        });
      } catch (error) {
        onError(error instanceof Error ? error.message : '无法转换复制内容');
        closeBlockMenu(!current.selectionMenu);
        return;
      }
      closeBlockMenu(!current.selectionMenu);
      if (copied !== null) {
        try {
          if (copied.html !== undefined) {
            if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
              onError('当前环境不支持复制富文本，请使用复制 HTML 或复制 Markdown');
              return;
            }
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': new Blob([copied.html], { type: 'text/html' }),
                'text/plain': new Blob([copied.text], { type: 'text/plain' }),
              }),
            ]);
          } else {
            await navigator.clipboard.writeText(copied.text);
          }
        } catch {
          onError(
            current.selectionMenu
              ? '无法复制选区内容，请检查剪贴板权限'
              : '无法复制块内容，请检查剪贴板权限',
          );
        }
      }
      return;
    }
    if (current.selectionMenu) {
      closeBlockMenu(false);
      return;
    }
    if (
      ['paragraph', 'heading', 'list', 'quote', 'unwrap'].includes(action) ||
      action.startsWith('wrap-')
    ) {
      if (!blockMenuCommandAvailable(action)) return;
      closeBlockMenu(false);
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const tr = blockMenuStructure(view.state, action);
        if (tr) view.dispatch(tr.scrollIntoView());
        view.focus();
      });
      return;
    }
    closeBlockMenu(false);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view.state.doc.eq(current.doc)) return;
      if (
        view.state.selection instanceof BlockRangeSelection &&
        action !== 'source' &&
        action !== 'restoreAutoWidth'
      ) {
        const tr = selectedBlocksMenuTransaction(view.state, action);
        if (tr) view.dispatch(tr.scrollIntoView());
        view.focus();
        return;
      }
      const { doc } = view.state;
      const { node, pos } = blockTree(doc)[current.index]!;
      if (action === 'source') {
        const selection = view.state.selection;
        const tr =
          selection instanceof BlockRangeSelection && selection.blocks.length > 1
            ? selectedBlocksSourceTransaction(ctx, view.state, selection)
            : blockNodeSourceTransaction(ctx, view.state, { node, pos }, view.state.tr);
        setLocalSourceDismissOnOutside();
        // Revealing syntax is a view change, including when automatic reveal is off.
        setApplying(true);
        setTransitioningSource(true);
        try {
          view.dispatch(tr.scrollIntoView());
        } finally {
          setApplying(false);
          setTransitioningSource(false);
        }
      } else if (action === 'restoreAutoWidth') {
        const tr = tableLineAction(view.state, { pos, axis: 'column', index: 0 }, 'restoreAutoWidth');
        if (tr) view.dispatch(tr.scrollIntoView());
      } else if (action === 'duplicate') {
        const insertPos = pos + node.nodeSize;
        const tr = view.state.tr.insert(insertPos, node);
        tr.setSelection(NodeSelection.create(tr.doc, insertPos));
        view.dispatch(tr.scrollIntoView());
      } else if (['move-up', 'move-down', 'indent', 'outdent'].includes(action)) {
        const tr =
          action === 'indent'
            ? indentBlock(view.state, pos)
            : action === 'outdent'
              ? outdentBlock(view.state, pos)
              : moveBlockSibling(view.state, pos, action === 'move-up' ? -1 : 1);
        if (!tr) return;
        view.dispatch(tr.scrollIntoView());
      } else if (action === 'delete') {
        const tr = deleteBlock(view.state, pos);
        if (tr) view.dispatch(tr.scrollIntoView());
      }
      view.focus();
    });
  }

  function openBlockConvertMenu(focusMenu = false, kind: BlockSubmenuKind = 'convert') {
    clearTimeout(blockConvertCloseTimer);
    if (!blockMenu.value) return;
    blockSubmenuKind.value = kind;
    blockConvertMenu.value ??= { x: blockMenu.value.x, y: blockMenu.value.y };
    void nextTick(() => {
      const trigger = blockSubmenuTrigger().value;
      const submenu = blockConvertElement.value;
      const menu = blockMenuElement.value;
      if (!trigger || !submenu || !menu || !blockConvertMenu.value) return;
      const bounds = menu.getBoundingClientRect();
      const triggerBounds = trigger.getBoundingClientRect();
      const x =
        bounds.right + submenu.offsetWidth <= window.innerWidth - 8
          ? bounds.right - 1
          : bounds.left - submenu.offsetWidth + 1;
      submenu.dataset.surfaceSide = x < bounds.left ? 'left' : 'right';
      blockConvertMenu.value = {
        x: Math.max(8, Math.min(x, window.innerWidth - submenu.offsetWidth - 8)),
        y: Math.max(
          8,
          Math.min(triggerBounds.top - 5, window.innerHeight - submenu.offsetHeight - 8),
        ),
      };
      if (focusMenu) submenu.focus({ preventScroll: true });
    });
  }

  function onBlockMenuKeydown(event: KeyboardEvent) {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      !event.isComposing &&
      event.key.toLowerCase() === 'c'
    ) {
      event.preventDefault();
      event.stopPropagation();
      void blockMenuAction(defaultCopyAction.value);
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.isComposing) {
      const action = (
        {
          ArrowUp: 'move-up',
          ArrowDown: 'move-down',
          ArrowRight: 'indent',
          ArrowLeft: 'outdent',
        } as Record<string, string>
      )[event.key];
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (blockMenuMoveAvailable(action)) void blockMenuAction(action);
        return;
      }
    }
    const inSubmenu = !!blockConvertElement.value?.contains(event.target as globalThis.Node);
    if (
      (event.key === 'Escape' && blockConvertMenu.value) ||
      (event.key === 'ArrowLeft' && inSubmenu)
    ) {
      event.preventDefault();
      event.stopPropagation();
      closeBlockConvertMenu(true);
      return;
    }
    if (
      event.key === 'ArrowRight' &&
      (event.target === blockConvertTrigger.value ||
        event.target === blockWrapTrigger.value ||
        event.target === blockCopyTrigger.value)
    ) {
      event.preventDefault();
      openBlockConvertMenu(
        true,
        event.target === blockCopyTrigger.value
          ? 'copy'
          : event.target === blockWrapTrigger.value
            ? 'wrap'
            : 'convert',
      );
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBlockMenu();
      getEditor()?.action((ctx) => ctx.get(editorViewCtx).focus());
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const menu = inSubmenu ? blockConvertElement.value : blockMenuElement.value;
    const items = [
      ...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ].filter((button) => button.closest('[role="menu"]') === menu);
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : current < 0
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    if (!inSubmenu) closeBlockConvertMenu();
    items[next]?.focus();
  }

  function dismissBlockMenuOnPointer(event: PointerEvent) {
    if (
      blockMenu.value &&
      !(event.target instanceof globalThis.Node && blockMenuElement.value?.contains(event.target))
    ) {
      closeBlockMenu();
    }
  }

  function dismissBlockMenuOnContext(event: MouseEvent) {
    if (
      blockMenu.value &&
      !event.defaultPrevented &&
      !(event.target instanceof globalThis.Node && root.value?.contains(event.target))
    ) {
      closeBlockMenu();
    }
  }

  function dismissBlockMenuOnScroll() {
    if (blockMenu.value) closeBlockMenu();
  }

  function mount() {
    window.addEventListener('pointerdown', dismissBlockMenuOnPointer, true);
    window.addEventListener('contextmenu', dismissBlockMenuOnContext);
    window.addEventListener('mousedown', preserveSelectedContext, true);
    window.addEventListener('pointerdown', preserveSelectedContext, true);
    window.addEventListener('contextmenu', openSelectedContext, true);
    window.addEventListener('scroll', dismissBlockMenuOnScroll, true);
    window.addEventListener('resize', dismissBlockMenuOnScroll);
  }

  function dispose() {
    closeBlockConvertMenu();
    blockMenu.value = null;
    window.removeEventListener('pointerdown', dismissBlockMenuOnPointer, true);
    window.removeEventListener('contextmenu', dismissBlockMenuOnContext);
    window.removeEventListener('mousedown', preserveSelectedContext, true);
    window.removeEventListener('pointerdown', preserveSelectedContext, true);
    window.removeEventListener('contextmenu', openSelectedContext, true);
    window.removeEventListener('scroll', dismissBlockMenuOnScroll, true);
    window.removeEventListener('resize', dismissBlockMenuOnScroll);
  }

  return {
    blockMenu,
    blockMenuElement,
    blockConvertTrigger,
    blockCopyTrigger,
    blockWrapTrigger,
    blockSubmenuKind,
    blockConvertElement,
    blockConvertMenu,
    blockMenuTable,
    specialCopyFormats,
    blockMenuSelectionCount,
    blockMenuCommandAvailable,
    blockMenuMoveAvailable,
    rememberRightClickSelection,
    openBlockMenu,
    closeBlockMenu,
    blockShortcut,
    blockMenuAction,
    openBlockConvertMenu,
    closeBlockConvertMenu,
    scheduleCloseBlockConvertMenu,
    onBlockMenuKeydown,
    mount,
    dispose,
  };
}
