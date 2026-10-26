import { onBeforeUnmount, ref, type Ref } from 'vue';

// Each document menu owns one active submenu, including teleported panels.
const activeMenus = new WeakMap<Element, () => void>();

export function useDocumentSubmenu(trigger: Ref<HTMLButtonElement | undefined>) {
  const open = ref(false);
  let owner: Element | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelClose() { clearTimeout(closeTimer); }
  function close() {
    cancelClose();
    open.value = false;
    if (owner && activeMenus.get(owner) === close) activeMenus.delete(owner);
    owner = undefined;
  }
  function activate() {
    cancelClose();
    const parent = trigger.value?.closest('.document-dropdown');
    if (parent) {
      const previous = activeMenus.get(parent);
      if (previous !== close) previous?.();
      owner = parent;
      activeMenus.set(parent, close);
    }
    open.value = true;
  }
  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(close, 180);
  }

  onBeforeUnmount(close);
  return { open, activate, close, cancelClose, scheduleClose };
}
