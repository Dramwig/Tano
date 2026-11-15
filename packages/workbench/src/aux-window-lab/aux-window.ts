/**
 * Prototype primitive for VS Code–style auxiliary windows: a native window
 * opened with `window.open()` that shares this window's JavaScript realm, so
 * Vue can render straight into it without booting a second workbench.
 *
 * See docs/aux-window-prototype.md. Nothing in production uses this yet.
 */

export type AuxWindowOptions = {
  /** Popup name; reusing a name navigates the existing popup instead of opening a new one. */
  name: string;
  title: string;
  width: number;
  height: number;
  /** Screen position in CSS pixels (window.open features use the opener's zoom). */
  left?: number;
  top?: number;
};

export type AuxWindow = {
  window: Window;
  document: Document;
  /** Empty element inside the popup body to mount UI into. */
  mount: HTMLElement;
  /** Milliseconds `window.open` took to return. */
  openMs: number;
  /** Number of <style>/<link rel=stylesheet> nodes mirrored into the popup. */
  styles: () => number;
  /** Resolves when the popup is closed by any means (title bar, Alt+F4, opener code). */
  closed: Promise<void>;
  close(): void;
};

export class AuxWindowError extends Error {}

function features(options: AuxWindowOptions) {
  const parts = [`width=${Math.round(options.width)}`, `height=${Math.round(options.height)}`];
  if (options.left !== undefined) parts.push(`left=${Math.round(options.left)}`);
  if (options.top !== undefined) parts.push(`top=${Math.round(options.top)}`);
  // A features string makes Chromium treat this as a popup window rather than a tab.
  parts.push('popup=yes');
  return parts.join(',');
}

/** Stylesheet nodes that must exist in every window rendering workbench UI. */
function isStyleNode(node: Node): node is HTMLStyleElement | HTMLLinkElement {
  return node.nodeName === 'STYLE' ||
    (node.nodeName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet');
}

/**
 * Keeps the popup's <head> stylesheets and <html> attributes (theme, locale,
 * CSS variables) identical to the opener's. Vite injects styles lazily during
 * development and themes switch at runtime, so a one-time copy is not enough.
 */
function mirrorDocument(source: Document, target: Document) {
  const copies = new Map<Node, Node>();
  const add = (node: Node) => {
    if (!isStyleNode(node) || copies.has(node)) return;
    const copy = target.importNode(node, true);
    copies.set(node, copy);
    target.head.append(copy);
  };
  const syncAttributes = () => {
    const from = source.documentElement;
    const to = target.documentElement;
    for (const attribute of [...to.attributes]) if (!from.hasAttribute(attribute.name)) to.removeAttribute(attribute.name);
    for (const attribute of [...from.attributes]) to.setAttribute(attribute.name, attribute.value);
    target.body.className = source.body.className;
  };
  source.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(add);
  syncAttributes();
  const headObserver = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(add);
      record.removedNodes.forEach((node) => {
        const copy = copies.get(node);
        copies.delete(node);
        (copy as ChildNode | undefined)?.remove();
      });
      // Vite HMR rewrites <style> text in place.
      if (record.type === 'characterData' || record.type === 'childList') {
        const style = (record.target.nodeName === 'STYLE' ? record.target : record.target.parentNode) as Node | null;
        const copy = style && copies.get(style);
        if (copy && style) copy.textContent = style.textContent;
      }
    }
  });
  headObserver.observe(source.head, { childList: true, subtree: true, characterData: true });
  const rootObserver = new MutationObserver(syncAttributes);
  rootObserver.observe(source.documentElement, { attributes: true });
  rootObserver.observe(source.body, { attributes: true, attributeFilter: ['class'] });
  return {
    count: () => copies.size,
    stop() { headObserver.disconnect(); rootObserver.disconnect(); },
  };
}

export function openAuxWindow(options: AuxWindowOptions, opener: Window = window): AuxWindow {
  const started = performance.now();
  // 'about:blank' inherits the opener's origin, which keeps the popup scriptable.
  // window.open('') is denied by some WebViews (tauri-apps/tauri#16425).
  const popup = opener.open('about:blank', options.name, features(options));
  const openMs = performance.now() - started;
  if (!popup) throw new AuxWindowError('window.open 返回了 null：宿主没有处理新窗口请求，或请求被拒绝。');
  let target: Document;
  try {
    target = popup.document;
  } catch (error) {
    popup.close();
    throw new AuxWindowError(`新窗口不同源，无法共享 JS：${String(error)}`);
  }
  // about:blank starts with an empty document; give it a minimal skeleton.
  if (!target.head) target.documentElement.append(target.createElement('head'));
  if (!target.body) target.documentElement.append(target.createElement('body'));
  target.title = options.title;
  const charset = target.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  target.head.prepend(charset);
  const mirror = mirrorDocument(opener.document, target);
  const mount = target.createElement('div');
  mount.className = 'aux-window-root';
  target.body.append(mount);

  let finish!: () => void;
  const closed = new Promise<void>((resolve) => { finish = resolve; });
  let done = false;
  const dispose = () => {
    if (done) return;
    done = true;
    mirror.stop();
    opener.clearInterval(poll);
    opener.removeEventListener('pagehide', closeWithOpener);
    finish();
  };
  // 'pagehide' fires in the popup when it closes; poll as a fallback because a
  // natively destroyed window may not run its unload steps.
  popup.addEventListener('pagehide', dispose);
  const poll = opener.setInterval(() => { if (popup.closed) dispose(); }, 500);
  // VS Code closes auxiliary windows together with their main window.
  const closeWithOpener = () => popup.close();
  opener.addEventListener('pagehide', closeWithOpener);

  return {
    window: popup,
    document: target,
    mount,
    openMs,
    styles: mirror.count,
    closed,
    close() { popup.close(); dispose(); },
  };
}

/** Tauri window label of the popup's own WebView, when Tauri injected its IPC bridge there. */
export function nativeLabelOf(popup: Window): string | null {
  const internals = (popup as Window & {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
  }).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label ?? null;
}
