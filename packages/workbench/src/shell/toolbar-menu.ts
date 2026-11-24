export const toolbarMenuOpenEvent = 'tano-toolbar-menu-open';

export function announceToolbarMenuOpen(owner: object | undefined): void {
  if (typeof window === 'undefined' || !owner) return;
  window.dispatchEvent(new CustomEvent(toolbarMenuOpenEvent, { detail: owner }));
}

export function isAnotherToolbarMenu(event: Event, owner: object | undefined): boolean {
  return (event as CustomEvent<object>).detail !== owner;
}
