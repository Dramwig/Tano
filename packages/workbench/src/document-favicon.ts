import { h, onBeforeUnmount, onMounted, render, watch } from 'vue';
import { builtinWorkspaceIcon } from './workspace-icons';
import { workspaceIconComponents } from './workspace-icon-components';
import { workspaceEmojiArtwork } from './workspace-emoji';

interface Favicon { href: string; type: string }
let emojiSheet: Promise<HTMLImageElement> | undefined;

/** Keep the browser favicon identical to the chosen document artwork. */
export async function documentIconFavicon(icon: string): Promise<Favicon | null> {
  if (!icon) return null;
  if (/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(icon)) return { href: icon, type: 'image/png' };
  const builtin = builtinWorkspaceIcon(icon);
  if (builtin) {
    const host = document.createElement('div');
    try {
      render(h(workspaceIconComponents[builtin.id], { size: 32, color: '#252820' }), host);
      const svg = host.querySelector('svg')!;
      // XMLSerializer supplies the SVG namespace; Vue's plain xmlns attribute would duplicate it.
      svg.removeAttribute('xmlns');
      // SVG favicons follow the browser's color scheme, independently of the editor theme.
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = '@media(prefers-color-scheme:dark){svg{stroke:#e6e9e0}}';
      svg.append(style);
      return { href: `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`, type: 'image/svg+xml' };
    } finally { render(null, host); }
  }
  if (icon.startsWith('icon:') || icon.startsWith('data:')) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const artwork = workspaceEmojiArtwork(icon);
  if (artwork) {
    emojiSheet ??= (async () => {
      const image = new Image();
      image.src = artwork.url;
      await image.decode();
      return image;
    })().catch(error => { emojiSheet = undefined; throw error; });
    context.drawImage(await emojiSheet, artwork.x, artwork.y, artwork.size, artwork.size, 0, 0, 32, 32);
  } else {
    context.font = '28px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(icon, 16, 17, 32);
  }
  return { href: canvas.toDataURL('image/png'), type: 'image/png' };
}

/** Restore the host's original favicon links, including their sizes/media, on exit. */
export function createDocumentFavicon(renderIcon = documentIconFavicon) {
  let revision = 0;
  let disposed = false;
  let custom: HTMLLinkElement | undefined;
  let defaults: { link: HTMLLinkElement; marker: Comment }[] = [];
  function restore() {
    custom?.remove();
    custom = undefined;
    for (const { link, marker } of defaults) marker.replaceWith(link);
    defaults = [];
  }
  return {
    async update(icon: string) {
      if (disposed) return;
      const expected = ++revision;
      // Do not leave the previous article's icon visible while decoding a new one.
      restore();
      if (!icon) return;
      let favicon: Favicon | null;
      try { favicon = await renderIcon(icon); }
      catch { return; } // A decorative image failure must not interrupt editing.
      if (disposed || expected !== revision || !favicon) return;
      defaults = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map(link => {
        const marker = document.createComment('document favicon');
        link.replaceWith(marker);
        return { link, marker };
      });
      custom = document.createElement('link');
      custom.rel = 'icon';
      custom.type = favicon.type;
      custom.href = favicon.href;
      custom.dataset.tanoDocumentFavicon = '';
      document.head.append(custom);
    },
    dispose() { disposed = true; revision++; restore(); },
  };
}

export function useDocumentFavicon(icon: () => string) {
  let favicon: ReturnType<typeof createDocumentFavicon> | undefined;
  let stop: (() => void) | undefined;
  onMounted(() => {
    favicon = createDocumentFavicon();
    stop = watch(icon, value => { void favicon!.update(value); }, { immediate: true });
  });
  onBeforeUnmount(() => { stop?.(); favicon?.dispose(); });
}
