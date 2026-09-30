import { observePanelPosition } from './panel-position';

const openEvent = 'tano-editor-panel-open';

export function createEditorPanel<T extends 'div' | 'span'>(tag: T, className: string, label: string): HTMLElementTagNameMap[T] {
  const panel = document.createElement(tag);
  panel.className = `tano-editor-panel ${className}`;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', label);
  panel.hidden = true;
  return panel;
}

export function announceEditorPanel(root: HTMLElement, anchor: Element) {
  root.dispatchEvent(new CustomEvent(openEvent, { detail: anchor }));
}

export function onOtherEditorPanel(root: HTMLElement, anchor: Element | (() => Element | null), close: () => void) {
  const listener = (event: Event) => {
    const current = typeof anchor === 'function' ? anchor() : anchor;
    if ((event as CustomEvent<Element>).detail !== current) close();
  };
  root.addEventListener(openEvent, listener);
  return () => root.removeEventListener(openEvent, listener);
}

export function activateEditorPanel(options: {
  panel: HTMLElement;
  anchor: Element;
  position: () => void;
  close: () => void;
}) {
  const { panel, anchor, position, close } = options;
  const onOutside = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node) || panel.contains(target) || anchor.contains(target)) return;
    close();
  };
  position();
  const stopPositioning = observePanelPosition(position);
  document.addEventListener('pointerdown', onOutside, true);
  return () => {
    stopPositioning();
    document.removeEventListener('pointerdown', onOutside, true);
  };
}
