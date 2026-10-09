import { canonicalPluginJson, parsePluginManifest, pluginPackageLimit, pluginRecord, pluginText, type PluginManifest } from './extensions';

export const pluginCatalogLimit = 4 * 1024 * 1024;
export interface PluginPublisher { id: string; name: string; homepage: string; pluginIds: string[] }
export interface PluginCatalogRelease {
  publisher: string;
  manifest: PluginManifest;
  integrity: string;
  bytes: number;
  publishedAt: string;
  source: string;
  license: string;
  notes: string;
  status: 'published' | 'withdrawn';
  reason?: string;
}
/** A curated, data-only index. The configured catalog operator owns publisher assignments. */
export interface PluginReleaseCatalog {
  catalogVersion: 1;
  name: string;
  updatedAt: string;
  publishers: PluginPublisher[];
  releases: PluginCatalogRelease[];
}
export function pluginCatalogHttps(value: unknown): string {
  if (!pluginText(value, 2048)) throw new Error('插件目录地址无效');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('插件目录地址必须为无凭据的 HTTPS 地址');
  return url.href;
}
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function keys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!pluginRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('插件目录包含不支持的字段');
}
export function parsePluginCatalog(content: string): PluginReleaseCatalog {
  if (new TextEncoder().encode(content).length > pluginCatalogLimit) throw new Error('插件目录不能超过 4 MiB');
  const value = JSON.parse(content);
  keys(value, ['catalogVersion', 'name', 'updatedAt', 'publishers', 'releases']);
  if (value.catalogVersion !== 1 || !pluginText(value.name, 100) || !date(value.updatedAt) ||
      !Array.isArray(value.publishers) || value.publishers.length > 1000 || !Array.isArray(value.releases) || value.releases.length > 1000)
    throw new Error('插件目录格式或容量无效');
  const owners = new Map<string, string>();
  const publisherIds = new Set<string>();
  const publishers = value.publishers.map((item): PluginPublisher => {
    keys(item, ['id', 'name', 'homepage', 'pluginIds']);
    if (!identifier(item.id) || publisherIds.has(item.id) || !pluginText(item.name, 100) || !Array.isArray(item.pluginIds) || item.pluginIds.length > 1000) throw new Error('插件发布者无效或重复');
    publisherIds.add(item.id);
    const pluginIds = item.pluginIds.map(id => {
      if (!identifier(id) || owners.has(id)) throw new Error('插件 ID 必须分配给唯一发布者');
      owners.set(id, item.id as string); return id;
    });
    return { id: item.id, name: item.name, homepage: pluginCatalogHttps(item.homepage), pluginIds };
  });
  const versions = new Set<string>();
  const releases = value.releases.map((item): PluginCatalogRelease => {
    keys(item, ['publisher', 'manifest', 'integrity', 'bytes', 'publishedAt', 'source', 'license', 'notes', 'status', 'reason']);
    const manifest = parsePluginManifest(item.manifest);
    const key = `${manifest.id}@${manifest.version}`;
    if (typeof item.publisher !== 'string' || !publisherIds.has(item.publisher) || owners.get(manifest.id) !== item.publisher || versions.has(key)) throw new Error('插件发布者不匹配或版本重复');
    if (!/^(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})\.(0|[1-9]\d{0,19})$/.test(manifest.version)) throw new Error('目录版本必须为无前导零的数字三段版本号');
    versions.add(key);
    if (typeof item.integrity !== 'string' || !/^[a-f0-9]{64}$/.test(item.integrity) ||
      !Number.isSafeInteger(item.bytes) || Number(item.bytes) < 1 || Number(item.bytes) > pluginPackageLimit || !date(item.publishedAt) ||
      !pluginText(item.license, 100) || typeof item.notes !== 'string' || item.notes.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item.notes) ||
      !['published', 'withdrawn'].includes(String(item.status)) || (item.status === 'withdrawn' ? !pluginText(item.reason, 500) : item.reason !== undefined))
      throw new Error('插件发布版本无效');
    return { publisher: item.publisher as string, manifest, integrity: item.integrity, bytes: Number(item.bytes), publishedAt: item.publishedAt,
      source: pluginCatalogHttps(item.source), license: item.license, notes: item.notes, status: item.status as PluginCatalogRelease['status'],
      ...(item.status === 'withdrawn' ? { reason: item.reason as string } : {}) };
  });
  return { catalogVersion: 1, name: value.name, updatedAt: value.updatedAt, publishers, releases };
}
/** Published identities and bytes are immutable. Withdrawal is permanent and retains the audit trail. */
export function assertPluginCatalogTransition(previous: PluginReleaseCatalog, next: PluginReleaseCatalog) {
  if (next.updatedAt < previous.updatedAt) throw new Error('目录更新时间不能倒退');
  for (const publisher of previous.publishers) {
    const current = next.publishers.find(item => item.id === publisher.id);
    if (!current || publisher.pluginIds.some(id => !current.pluginIds.includes(id))) throw new Error('不能移除发布者或转移已分配的插件 ID');
  }
  for (const release of previous.releases) {
    const current = next.releases.find(item => item.manifest.id === release.manifest.id && item.manifest.version === release.manifest.version);
    if (!current) throw new Error('已发布版本只能撤回，不能从目录删除');
    const immutable = ({ status: _status, reason: _reason, ...value }: PluginCatalogRelease) => canonicalPluginJson(value);
    if (immutable(release) !== immutable(current)) throw new Error('已发布版本不可覆盖，请增加版本号');
    if (release.status === 'withdrawn' && current.status !== 'withdrawn') throw new Error('已撤回版本不可重新上架，请发布新版本');
  }
}
/** Numeric triplets without Number precision loss, including older manifests with leading zeros. */
export function comparePluginVersions(left: string, right: string): number {
  for (let i = 0; i < 3; i++) {
    const a = BigInt(left.split('.')[i]!), b = BigInt(right.split('.')[i]!);
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}
