/** Only page whitespace opens the view menu; content keeps its own context actions. */
export function isBlankPageTarget(target: EventTarget | null): target is Element {
  return target instanceof Element && !target.closest(
    '.tano-prose > *, .tano-block-handle, .document-title, .frontmatter-panel, .cm-editor',
  );
}
