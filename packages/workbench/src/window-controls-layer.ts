import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

/** Keep native window chrome above overlays and inside the active modal's
 * non-inert subtree. A manual popover escapes dialog clipping/stacking without
 * dismissing the dialog or making the rest of the workbench interactive. */
export function useWindowControlsLayer() {
  const controls = ref<HTMLElement>();
  const target = ref<HTMLElement>();
  let observer: MutationObserver | undefined;
  let dialogs: HTMLDialogElement[] = [];
  let disposed = false;

  async function sync(records: MutationRecord[] = []) {
    const open = [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')];
    dialogs = dialogs.filter(dialog => open.includes(dialog));
    // Opening order, rather than DOM order, decides which nested modal is active.
    for (const record of records) {
      if (record.type !== 'attributes' || record.oldValue !== null) continue;
      const dialog = record.target as HTMLDialogElement;
      if (!open.includes(dialog)) continue;
      dialogs = dialogs.filter(item => item !== dialog);
      dialogs.push(dialog);
    }
    for (const dialog of open) if (!dialogs.includes(dialog)) dialogs.push(dialog);
    const next = dialogs.at(-1) ?? document.body;
    // A close/showModal pair in one turn can leave the popover open but below
    // the re-promoted dialog. Re-promote the controls even if their parent stays.
    const reopened = records.some(record => record.type === 'attributes'
      && record.target === next && record.oldValue === null);
    if (target.value === next && !reopened && controls.value?.matches(':popover-open')) return;
    controls.value?.hidePopover();
    target.value = next;
    await nextTick();
    if (!disposed && controls.value?.isConnected) controls.value.showPopover();
  }

  onMounted(() => {
    observer = new MutationObserver(records => void sync(records));
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['open'], attributeOldValue: true,
    });
    void sync();
  });
  onBeforeUnmount(() => {
    disposed = true;
    observer?.disconnect();
    controls.value?.hidePopover();
  });
  return { controls, target };
}
