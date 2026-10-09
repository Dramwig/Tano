import { canonicalPluginJson, parsePluginPackage, pluginPackageLimit } from '@tano/protocol';
import type { PluginPackage, PluginPackageUsage, WorkspacePluginRule } from '@tano/protocol';
import { assistantHash } from '../assistant/hash';
import { PluginCacheStorage } from './cache-storage';

export interface PluginPackageRepository {
  load(workspaceId: string, integrity: string, signal: AbortSignal): Promise<string>;
  publish(workspaceId: string, integrity: string, content: string): Promise<void>;
  usage?(workspaceId: string): Promise<PluginPackageUsage>;
  remove?(workspaceId: string, integrity: string): Promise<void>;
}
export async function pluginIntegrity(pkg: PluginPackage) { return assistantHash(canonicalPluginJson(pkg)); }
export function pluginApplicationStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  if (typeof localStorage !== 'undefined') return localStorage;
  const memory = new Map<string, string>();
  return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } };
}

/** Content-addressed application cache; no executable code is written to the workspace. */
export class PluginPackageCache {
  private cache: PluginCacheStorage;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> = pluginApplicationStorage()) { this.cache = new PluginCacheStorage(storage); }
  async put(pkg: PluginPackage) {
    const parsed = parsePluginPackage(JSON.stringify(pkg));
    const integrity = await pluginIntegrity(parsed);
    const content = canonicalPluginJson(parsed);
    await this.cache.put({ integrity, pluginId: parsed.manifest.id, version: parsed.manifest.version, bytes: new TextEncoder().encode(content).length, savedAt: new Date().toISOString() }, content);
    return integrity;
  }
  async get(integrity: string) {
    const content = await this.cache.get(integrity);
    if (!content) return null;
    const pkg = parsePluginPackage(content);
    if (await pluginIntegrity(pkg) !== integrity) throw new Error('插件缓存校验失败，请重新导入原版本');
    if (!(await this.cache.entries()).some(entry => entry.integrity === integrity)) await this.put(pkg);
    return pkg;
  }
  entries() { return this.cache.entries(); }
  remove(integrity: string) { return this.cache.remove(integrity); }
  async resolve(workspaceId: string, rule: WorkspacePluginRule, signal: AbortSignal, repository?: PluginPackageRepository) {
    if (!rule.integrity) throw new Error('插件缺少内容摘要');
    let pkg = await this.get(rule.integrity);
    if (!pkg) {
      let content: string;
      if (repository) content = await repository.load(workspaceId, rule.integrity, signal);
      else if (rule.sourceUrl) content = await fetchPluginText(rule.sourceUrl, signal);
      else throw new Error('此设备尚无插件代码，请导入管理员提供的同版本插件包');
      pkg = parsePluginPackage(content);
      if (await pluginIntegrity(pkg) !== rule.integrity) throw new Error('下载的插件与工作区锁定版本不一致');
      await this.put(pkg);
    }
    if (canonicalPluginJson(pkg.manifest) !== canonicalPluginJson(rule.manifest)) throw new Error('插件清单与锁定版本不一致');
    if (signal.aborted) throw new Error('插件加载已取消');
    return pkg;
  }
}
export async function fetchPluginText(url: string, signal: AbortSignal, limit = pluginPackageLimit) {
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
  return readPluginResponse(response, limit);
}
export async function readPluginResponse(response: Response, limit = pluginPackageLimit) {
  if (!response.ok || !response.body) throw new Error(`插件请求失败（${response.status}）`);
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('插件响应超过大小限制');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
