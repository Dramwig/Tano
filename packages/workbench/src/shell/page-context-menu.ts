import { isElement } from '@tano/editor/dom-realm';
/** Only page whitespace opens the view menu; content keeps its own context actions. */
export function isBlankPageTarget(target: EventTarget | null): target is Element {
  return isElement(target) && !target.closest(
    '.tano-prose > *, .tano-block-handle, .document-title, .frontmatter-panel, .cm-editor',
  );
}
