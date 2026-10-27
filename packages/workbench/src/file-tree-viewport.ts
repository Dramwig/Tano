import { computed, nextTick, ref, watch, type Ref } from 'vue';
import type { FileTreeRow } from './file-tree-model';

// styles.css: .tree-row is 32px high with 1px margins above and below.
export const treeRowHeight = 34;
const overscan = 8;

/** Virtualize only the flat large-tree branch; keep focused/editing rows mounted. */
export function useFileTreeViewport(element: Ref<HTMLElement | undefined>, enabled: Ref<boolean>,
  rows: Ref<FileTreeRow[]>, pinned: () => (string | undefined)[]) {
  const top = ref(0), height = ref(600), focused = ref('');
  let container: HTMLElement | undefined;
  let update = () => {};
  const rowIndices = computed(() => new Map(rows.value.map((row, index) => [row.file.id, index])));
  const windowRows = computed(() => {
    if (!enabled.value) return rows.value.map((row, index) => ({ ...row, index }));
    const count = Math.ceil(height.value / treeRowHeight) + overscan * 2;
    const start = Math.min(Math.max(0, rows.value.length - count), Math.max(0, Math.floor(top.value / treeRowHeight) - overscan));
    const indices = new Set<number>();
    for (let i = start; i < Math.min(rows.value.length, start + count); i++) indices.add(i);
    for (const id of [focused.value, ...pinned()]) {
      const index = id ? rowIndices.value.get(id) : undefined;
      if (index !== undefined) indices.add(index);
    }
    return [...indices].sort((a, b) => a - b).map(index => ({ ...rows.value[index]!, index }));
  });
  watch([element, enabled], ([tree, active], _, cleanup) => {
    if (!tree || !active) return;
    const scroll = tree.closest<HTMLElement>('.tree-scroll') ?? tree.parentElement;
    if (!scroll) return;
    container = scroll;
    update = () => {
      top.value = Math.max(0, scroll.getBoundingClientRect().top - tree.getBoundingClientRect().top);
      height.value = scroll.clientHeight || 600;
    };
    scroll.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(scroll);
    update();
    cleanup(() => { scroll.removeEventListener('scroll', update); observer?.disconnect(); container = undefined; update = () => {}; });
  }, { flush: 'post' });

  function reveal(id: string) {
    const index = rowIndices.value.get(id);
    if (!enabled.value || index === undefined || !container) return;
    const rowTop = index * treeRowHeight;
    if (rowTop < top.value) container.scrollTop += rowTop - top.value;
    else if (rowTop + treeRowHeight > top.value + height.value)
      container.scrollTop += rowTop + treeRowHeight - top.value - height.value;
    update();
  }
  async function focus(id: string) {
    focused.value = id;
    reveal(id);
    await nextTick();
    const row = [...(element.value?.querySelectorAll<HTMLElement>('.tree-row[data-entry-id]') ?? [])]
      .find(row => row.dataset.entryId === id);
    row?.focus({ preventScroll: true });
  }
  return { windowRows, focused, reveal, focus };
}
