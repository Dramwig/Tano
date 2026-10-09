import { pluginCacheLimit } from '@tano/protocol';

export interface PluginCacheEntry { integrity: string; pluginId: string; version: string; bytes: number; savedAt: string }
export type PluginStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;
const indexKey = 'tano.plugin-cache-index.v1';
const packageKey = (integrity: string) => `tano.plugin-package.v1.${integrity}`;
let database: Promise<IDBDatabase> | undefined;
const storageOperations = new WeakMap<PluginStorage, Promise<unknown>>();
function serialize<T>(storage: PluginStorage, run: () => Promise<T>): Promise<T> {
  const result = (storageOperations.get(storage) ?? Promise.resolve()).then(run, run);
  storageOperations.set(storage, result.catch(() => {}));
  return result;
}
function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tano-plugin-cache-v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('packages'); request.result.createObjectStore('metadata', { keyPath: 'integrity' }); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(new Error('无法打开插件应用缓存')); };
    request.onblocked = () => { database = undefined; reject(new Error('插件缓存正由其他窗口使用，请关闭旧窗口后重试')); };
  });
}
const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
function checkQuota(entries: PluginCacheEntry[], entry: PluginCacheEntry) {
  if (entries.filter(row => row.integrity !== entry.integrity).reduce((sum, row) => sum + row.bytes, 0) + entry.bytes > pluginCacheLimit)
    throw new Error('插件代码缓存已达 64 MiB，请在版本与维护中清理不需要的缓存');
}

/** IndexedDB is application data. The small-storage fallback keeps embedded/test hosts compatible. */
export class PluginCacheStorage {
  private indexed: boolean;
  constructor(private storage: PluginStorage) {
    this.indexed = typeof indexedDB !== 'undefined' && typeof localStorage !== 'undefined' && storage === localStorage;
  }
  async entries(): Promise<PluginCacheEntry[]> {
    if (this.indexed) return requestValue((await openDatabase()).transaction('metadata').objectStore('metadata').getAll());
    const rows = JSON.parse(this.storage.getItem(indexKey) ?? '[]');
    if (!Array.isArray(rows) || rows.some(row => typeof row.integrity !== 'string' || !Number.isFinite(row.bytes) || row.bytes < 0)) throw new Error('插件缓存索引损坏，原缓存已保留');
    return rows;
  }
  async get(integrity: string): Promise<string | null> {
    if (this.indexed) return (await requestValue<string | undefined>((await openDatabase()).transaction('packages').objectStore('packages').get(integrity))) ?? this.storage.getItem(packageKey(integrity));
    return this.storage.getItem(packageKey(integrity));
  }
  put(entry: PluginCacheEntry, content: string) {
    return this.indexed ? this.write(entry, content) : serialize(this.storage, () => this.write(entry, content));
  }
  private async write(entry: PluginCacheEntry, content: string) {
    if (this.indexed) {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['packages', 'metadata'], 'readwrite');
        let failure: unknown;
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(failure ?? new Error('设备存储空间不足，插件缓存未写入'));
        transaction.onerror = () => {};
        const metadata = transaction.objectStore('metadata'), request = metadata.getAll();
        request.onsuccess = () => {
          try { checkQuota(request.result, entry); metadata.put(entry); transaction.objectStore('packages').put(content, entry.integrity); }
          catch (error) { failure = error; transaction.abort(); }
        };
      });
      this.storage.removeItem?.(packageKey(entry.integrity));
      return;
    }
    const rows = await this.entries(); checkQuota(rows, entry);
    const key = packageKey(entry.integrity), previous = this.storage.getItem(key);
    try {
      this.storage.setItem(key, content);
      this.storage.setItem(indexKey, JSON.stringify([...rows.filter(row => row.integrity !== entry.integrity), entry]));
    } catch {
      if (previous !== null) this.storage.setItem(key, previous); else if (this.storage.removeItem) this.storage.removeItem(key); else this.storage.setItem(key, '');
      throw new Error('设备存储空间不足，插件缓存未写入');
    }
  }
  remove(integrity: string) { return this.indexed ? this.delete(integrity) : serialize(this.storage, () => this.delete(integrity)); }
  private async delete(integrity: string) {
    if (this.indexed) {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['packages', 'metadata'], 'readwrite');
        transaction.objectStore('packages').delete(integrity); transaction.objectStore('metadata').delete(integrity);
        transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
      });
    } else this.storage.setItem(indexKey, JSON.stringify((await this.entries()).filter(row => row.integrity !== integrity)));
    if (this.storage.removeItem) this.storage.removeItem(packageKey(integrity)); else this.storage.setItem(packageKey(integrity), '');
  }
}
