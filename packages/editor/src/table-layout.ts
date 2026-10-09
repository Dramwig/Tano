import { Mark } from '@milkdown/kit/prose/model';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { columnResizingPluginKey, TableMap } from '@milkdown/kit/prose/tables';
import { closeHistory } from '@milkdown/kit/prose/history';
import { defaultTableColumnWidth, minimumTableColumnWidth } from '@tano/protocol';
import type { TableColor, TableLayout } from '@tano/protocol';

export const tableLayoutKey = new PluginKey('tanoTableLayout');

function content(node: Node): string {
  return JSON.stringify(node.toJSON(), (key, value) =>
    key === 'colwidth' || key === 'layoutId' || key === 'autoWidth' || key === 'background' || key === 'foreground' ? undefined : value);
}

export function sameMarkdownContent(before: Node, after: Node) {
  if (before.eq(after)) return true;
  if (before.type !== after.type || before.childCount !== after.childCount ||
      before.text !== after.text || !Mark.sameSet(before.marks, after.marks)) return false;
  const attrs = (node: Node) => {
    const { colwidth: _width, layoutId: _id, autoWidth: _auto, background: _background, foreground: _foreground, ...rest } = node.attrs;
    return JSON.stringify(rest);
  };
  if (attrs(before) !== attrs(after)) return false;
  for (let i = 0; i < before.childCount; i++)
    if (!sameMarkdownContent(before.child(i), after.child(i))) return false;
  return true;
}

export function tablesInDocument(doc: Node) {
  const tables: { node: Node; pos: number; layout: TableLayout }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return;
    const widths: number[] = [];
    node.firstChild?.forEach(cell => {
      for (let i = 0; i < cell.attrs.colspan; i++)
        widths.push(Math.max(minimumTableColumnWidth, Math.round(cell.attrs.colwidth?.[i] || defaultTableColumnWidth)));
    });
    const backgrounds: (TableColor | null)[][] = [];
    const foregrounds: (TableColor | null)[][] = [];
    node.forEach(row => {
      const colors: (TableColor | null)[] = [];
      const textColors: (TableColor | null)[] = [];
      row.forEach(cell => {
        colors.push(cell.attrs.background ?? null);
        textColors.push(cell.attrs.foreground ?? null);
      });
      backgrounds.push(colors);
      foregrounds.push(textColors);
    });
    if (widths.length) tables.push({ node, pos, layout: {
      id: node.attrs.layoutId ?? '', widths,
      ...(node.attrs.autoWidth ? { autoWidth: true as const } : {}),
      ...(backgrounds.some(row => row.some(Boolean)) ? { backgrounds } : {}),
      ...(foregrounds.some(row => row.some(Boolean)) ? { foregrounds } : {}),
      anchor: {
        content: content(node),
        before: doc.textBetween(Math.max(0, pos - 80), pos, '\n').slice(-80),
        after: doc.textBetween(pos + node.nodeSize, Math.min(doc.content.size, pos + node.nodeSize + 80), '\n').slice(0, 80),
      },
    } });
    return false;
  });
  return tables;
}

/** Only restore an unambiguous content/context match; duplicate tables never use their ordinal. */
export function matchTableLayout(table: TableLayout, tables: readonly TableLayout[], saved: readonly TableLayout[]) {
  const byId = table.id && saved.find(item => item.id === table.id);
  if (byId) return byId;
  const sameContent = (item: TableLayout) => item.anchor.content === table.anchor.content && item.widths.length === table.widths.length;
  const candidates = saved.filter(sameContent);
  const peers = tables.filter(sameContent);
  if (candidates.length === 1 && peers.length === 1) return candidates[0];
  const sameContext = (item: TableLayout) => sameContent(item) &&
    item.anchor.before === table.anchor.before && item.anchor.after === table.anchor.after;
  const contextual = candidates.filter(sameContext);
  return contextual.length === 1 && peers.filter(sameContext).length === 1 ? contextual[0] : undefined;
}

export function tableLayouts(
  initial: () => readonly TableLayout[],
  changed: (tables: TableLayout[]) => void,
  readonly: () => boolean,
) {
  let saved = [...initial()];
  let orphaned = [...saved];
  let publishing = saved.length > 0;
  let lastPublished = '';
  const normalize = (view: EditorView) => {
    view.dispatch(view.state.tr.setMeta(tableLayoutKey, saved).setMeta('addToHistory', false));
  };
  return new Plugin({
    key: tableLayoutKey,
    filterTransaction(tr, state) {
      const resizing = columnResizingPluginKey.getState(state);
      if (tr.docChanged && resizing?.dragging) {
        closeHistory(tr);
        // Commit the mode switch with the resize so undo restores automatic fitting.
        const cell = state.doc.resolve(resizing.activeHandle);
        const pos = tr.mapping.map(cell.before(-1));
        const table = tr.doc.nodeAt(pos);
        if (table?.type.name === 'table' && table.attrs.autoWidth) {
          tr.setNodeMarkup(pos, undefined, { ...table.attrs, autoWidth: false });
          // Include the other columns in the same undo step. Their automatic widths
          // may change after undo; redo must still restore the original fixed table.
          for (const offset of new Set(TableMap.get(table).map)) {
            const cell = table.nodeAt(offset)!;
            tr.setNodeMarkup(pos + 1 + offset, undefined, cell.attrs);
          }
        }
      }
      return true;
    },
    appendTransaction(transactions, _previous, state) {
      const supplied = transactions.find(tr => tr.getMeta(tableLayoutKey));
      if (supplied) {
        saved = supplied.getMeta(tableLayoutKey);
        orphaned = [...saved];
        publishing = saved.length > 0;
      }
      if (!supplied && !transactions.some(tr => tr.docChanged)) return null;
      const tables = tablesInDocument(state.doc);
      const snapshots = tables.map(table => table.layout);
      const used = new Set<string>();
      const tr = state.tr;
      for (const table of tables) {
        const matched = matchTableLayout(table.layout, snapshots, saved);
        const id = table.layout.id && !used.has(table.layout.id)
          ? table.layout.id : matched && !used.has(matched.id) ? matched.id : crypto.randomUUID();
        used.add(id);
        orphaned = orphaned.filter(item => item.id !== id);
        const restoring = matched && (supplied || table.node.attrs.layoutId !== id);
        const autoWidth = restoring ? matched.autoWidth === true : table.node.attrs.autoWidth;
        if (table.node.attrs.layoutId !== id || table.node.attrs.autoWidth !== autoWidth)
          tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, layoutId: id, autoWidth });
        const widths = restoring ? matched.widths : table.layout.widths;
        const map = TableMap.get(table.node);
        for (const offset of new Set(map.map)) {
          const cell = table.node.nodeAt(offset)!;
          const column = map.colCount(offset);
          const colwidth = Array.from({ length: cell.attrs.colspan }, (_, i) => widths[column + i] ?? defaultTableColumnWidth);
          const row = map.findCell(offset).top;
          const background = restoring ? matched.backgrounds?.[row]?.[column] ?? null : cell.attrs.background;
          const foreground = restoring ? matched.foregrounds?.[row]?.[column] ?? null : cell.attrs.foreground;
          if (JSON.stringify(cell.attrs.colwidth) !== JSON.stringify(colwidth) || cell.attrs.background !== background || cell.attrs.foreground !== foreground)
            tr.setNodeMarkup(table.pos + 1 + offset, undefined, { ...cell.attrs, colwidth, background, foreground });
        }
      }
      return tr.docChanged ? tr.setMeta('addToHistory', false).setMeta('tanoTableLayoutNormalize', true) : null;
    },
    view(view) {
      // Node views exist before the first hydration transaction.
      queueMicrotask(() => { if (!view.isDestroyed) normalize(view); });
      return {
        update(view, previous) {
          const finishedDrag = columnResizingPluginKey.getState(previous)?.dragging &&
            !columnResizingPluginKey.getState(view.state)?.dragging;
          if (previous.doc.eq(view.state.doc) && !finishedDrag) return;
          const tables = tablesInDocument(view.state.doc).map(item => item.layout);
          if (tables.some(table => !table.id)) return;
          if (tables.some(table => table.backgrounds || table.foregrounds || !table.autoWidth)) publishing = true;
          if (!publishing || readonly() || columnResizingPluginKey.getState(view.state)?.dragging) return;
          const customized = tables.filter(table => saved.some(item => item.id === table.id) ||
            table.backgrounds || table.foregrounds || !table.autoWidth)
            // Container measurements are presentation state, never portable layout changes.
            .map(table => table.autoWidth ? { ...table, widths: table.widths.map(() => defaultTableColumnWidth) } : table);
          const next = [...customized, ...orphaned];
          const serialized = JSON.stringify(next);
          if (serialized === lastPublished || serialized === JSON.stringify(saved)) return;
          lastPublished = serialized;
          saved = next;
          changed(next);
        },
      };
    },
  });
}
