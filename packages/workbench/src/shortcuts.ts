type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
> & { target?: EventTarget | null; keyCode?: number };

export function isSidebarToggleShortcut(event: KeyboardShortcutEvent) {
  const target = event.target;
  // Formatting shortcuts belong to the focused editor or input.
  if (target instanceof Element && target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
  )) return false;
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.repeat &&
    event.key.toLowerCase() === 'b'
  );
}
