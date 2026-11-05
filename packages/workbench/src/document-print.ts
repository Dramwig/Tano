import { basename } from '@tano/protocol';
import { withDocumentSnapshot, type DocumentExportOptions } from './document-export';
import { t } from './i18n';
import { isTauri } from '@tauri-apps/api/core';

let printing = false;

export function preparePrintContent(snapshot: HTMLElement) {
  // Every tab becomes a named section on paper; its editing menu is not printable content.
  snapshot.querySelectorAll<HTMLElement>('.tano-tabs').forEach(tabs => {
    tabs.querySelector(':scope > .tano-enhanced-header')?.remove();
    tabs.querySelectorAll<HTMLElement>(':scope > .tano-enhanced-content > .tano-panel').forEach((panel, index) => {
      const header = panel.querySelector(':scope > .tano-enhanced-header');
      if (!header) return;
      const title = document.createElement('h3');
      title.className = 'document-print-panel-title';
      title.textContent = header.textContent?.trim() || t('标签页 {0}', [index + 1]);
      header.replaceWith(title);
    });
  });
  snapshot.querySelectorAll('table').forEach(table => {
    const first = table.tBodies[0]?.rows[0];
    if (!table.tHead && first?.cells.length && [...first.cells].every(cell => cell.tagName === 'TH')) table.createTHead().append(first);
  });
}

/** Keep the static snapshot alive until the system preview is closed, including cancellation. */
export async function printDocument(options: DocumentExportOptions): Promise<void> {
  if (printing) return;
  printing = true;
  try {
    if (isTauri()) {
      const { openDocumentPrintWindow } = await import('./print-window');
      await withDocumentSnapshot(options, async snapshot => {
        preparePrintContent(snapshot);
        await openDocumentPrintWindow(snapshot, options.title || basename(options.path).replace(/\.(md|markdown)$/i, ''));
      }, { inlineImages: false, preserveReferenceLabels: true });
      return;
    }
    await withDocumentSnapshot(options, snapshot => new Promise<void>((resolve, reject) => {
      preparePrintContent(snapshot);
      const host = snapshot.parentElement!;
      const previousTitle = document.title;
      const title = options.title || basename(options.path).replace(/\.(md|markdown)$/i, '');
      const media = window.matchMedia('print');
      let entered = media.matches;
      const cleanup = () => {
        window.removeEventListener('beforeprint', beforePrint);
        window.removeEventListener('afterprint', finish);
        media.removeEventListener('change', mediaChange);
        document.documentElement.classList.remove('document-printing');
        if (document.title === title) document.title = previousTitle;
      };
      const finish = () => { cleanup(); resolve(); };
      const beforePrint = () => { entered = true; };
      const mediaChange = (event: MediaQueryListEvent) => {
        if (event.matches) entered = true;
        else if (entered) finish();
      };
      window.addEventListener('beforeprint', beforePrint);
      window.addEventListener('afterprint', finish);
      media.addEventListener('change', mediaChange);
      host.classList.add('document-print-root');
      document.documentElement.classList.add('document-printing');
      document.title = title;
      try {
        window.print();
      } catch (error) {
        cleanup();
        reject(error);
      }
    }), { inlineImages: false, preserveReferenceLabels: true });
  } finally {
    printing = false;
  }
}
