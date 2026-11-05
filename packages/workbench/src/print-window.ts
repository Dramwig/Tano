import { isTauri } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { t } from './i18n';

export const PRINT_READY = 'tano-print-ready';
export const PRINT_CONTENT = 'tano-print-content';
export const PRINT_LOADED = 'tano-print-loaded';
export interface PrintWindowContent {
  title: string;
  html: string;
  lang: string;
  css: string[];
  stylesheets: string[];
}

export function printWindowRequest() {
  if (!isTauri()) return null;
  const query = new URLSearchParams(window.location.search);
  const label = query.get('tanoPrint');
  const opener = query.get('printOpener');
  return label?.startsWith('print-') && label === getCurrentWindow().label && opener ? { label, opener } : null;
}

/** The host mounts only a static print surface, without opening a workspace or restoring an account. */
export async function startDocumentPrintWindow(signal?: AbortSignal) {
  if (!printWindowRequest()) return false;
  const [{ createApp, nextTick }, { default: PrintWindow }] = await Promise.all([import('vue'), import('./components/PrintWindow.vue')]);
  signal?.throwIfAborted();
  createApp(PrintWindow).mount('#app');
  await nextTick();
  return true;
}

async function windowContent(snapshot: HTMLElement, title: string): Promise<PrintWindowContent> {
  const copy = snapshot.cloneNode(true) as HTMLElement;
  // Blob URLs belong to the originating WebView. Copy their bytes before its renderer is released.
  await Promise.all([...copy.querySelectorAll<HTMLImageElement>('img[src]')].map(async image => {
    image.loading = 'eager';
    if (!image.src.startsWith('blob:')) { image.src = image.src; return; }
    const response = await fetch(image.src, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(t('无法读取打印图片'));
    const blob = await response.blob();
    image.src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(t('无法读取打印图片')));
      reader.readAsDataURL(blob);
    });
    image.removeAttribute('srcset');
  }));
  return {
    title, html: copy.outerHTML, lang: document.documentElement.lang || 'zh-CN',
    css: [...document.querySelectorAll('style')].map(style => style.textContent || ''),
    stylesheets: [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(link => link.href),
  };
}

export async function openDocumentPrintWindow(snapshot: HTMLElement, title: string) {
  const content = await windowContent(snapshot, title);
  const label = `print-${crypto.randomUUID()}`;
  let settle!: (error?: unknown) => void;
  const completed = new Promise<void>((resolve, reject) => { settle = error => error ? reject(error) : resolve(); });
  // Subscribe before creating the window so a fast child cannot outrun the handshake.
  const unlistenReady = await listen<{ label: string }>(PRINT_READY, event => {
    if (event.payload.label === label) void emitTo(label, PRINT_CONTENT, content).catch(settle);
  });
  let unlistenLoaded: (() => void) | undefined;
  let printWindow: WebviewWindow | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cleanupEvents: Array<() => void> = [];
  try {
    unlistenLoaded = await listen<{ label: string; error?: string }>(PRINT_LOADED, event => {
      if (event.payload.label === label) settle(event.payload.error ? new Error(event.payload.error) : undefined);
    });
    const query = new URLSearchParams({ tanoPrint: label, printOpener: getCurrentWindow().label });
    printWindow = new WebviewWindow(label, {
      url: `index.html?${query}`, title: `${t('打印')} · ${title} — Tano`,
      width: 1100, height: 800, minWidth: 680, minHeight: 520,
      center: true, visible: true, decorations: false, resizable: true,
      dragDropEnabled: false, backgroundColor: '#ffffff',
    });
    cleanupEvents.push(await printWindow.once<string>('tauri://error', event => settle(new Error(String(event.payload)))));
    cleanupEvents.push(await printWindow.once('tauri://destroyed', () => settle()));
    timeout = setTimeout(() => settle(new Error(t('打印窗口启动超时，请重试'))), 30000);
    await completed;
  } catch (error) {
    await printWindow?.destroy().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    unlistenReady(); unlistenLoaded?.(); cleanupEvents.forEach(unlisten => unlisten());
  }
}
