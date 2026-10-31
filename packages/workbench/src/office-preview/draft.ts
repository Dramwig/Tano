import type { SheetEdit } from './edit';
export interface SpreadsheetDraft { base: Uint8Array; edits: SheetEdit[] }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tano-spreadsheet-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function draft(key: string, value?: SpreadsheetDraft | null, expectedEdits?: SheetEdit[]): Promise<SpreadsheetDraft | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('drafts');
      const request = store.get(key);
      if (value !== undefined) request.onsuccess = () => {
        const previous = request.result as SpreadsheetDraft | undefined;
        // Two panes must not silently replace each other's unsaved operations.
        const expected = expectedEdits ?? value?.edits.slice(0, -1);
        if (expected && JSON.stringify(previous?.edits ?? []) !== JSON.stringify(expected)) {
          reject(new Error('另一窗口已修改此文件的草稿，请重新打开后继续')); tx.abort(); return;
        }
        if (value === null) store.delete(key); else store.put(value, key);
      };
      tx.oncomplete = () => resolve(value === undefined ? request.result : undefined);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('无法保存本地草稿'));
    });
  } finally { db.close(); }
}
export function serializeWorkbook(base: Uint8Array, path: string, edits: SheetEdit[], latest?: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./edit.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { finish(); reject(new Error('工作簿保存超时，本地草稿已保留')); }, 30000);
    worker.onmessage = event => { finish(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.bytes); };
    worker.onerror = () => { finish(); reject(new Error('无法生成工作簿，本地草稿已保留')); };
    worker.postMessage({ bytes: base, extension: path.split('.').at(-1)?.toLowerCase(), edits, latest });
  });
}
