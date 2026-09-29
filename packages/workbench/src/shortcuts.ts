type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
>;

export function isSidebarToggleShortcut(event: KeyboardShortcutEvent) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.repeat &&
    event.key.toLowerCase() === 'b'
  );
}
