import { canonicalPluginJson, parsePluginCatalog, parsePluginPackage, pluginCatalogHttps, pluginCatalogLimit, type PluginCatalogRelease, type PluginPackage, type PluginReleaseCatalog } from '@tano/protocol';
import { fetchPluginText, pluginIntegrity } from './packages';

/** Supplied by the product host, never by a workspace or an executing plugin. */
export interface PluginCatalogProvider {
  readonly source: string;
  list(signal: AbortSignal): Promise<PluginReleaseCatalog>;
  download(release: PluginCatalogRelease, signal: AbortSignal): Promise<{ pkg: PluginPackage; sourceUrl?: string }>;
}
export async function verifyCatalogPackage(release: PluginCatalogRelease, pkg: PluginPackage) {
  const canonical = canonicalPluginJson(pkg);
  if (new TextEncoder().encode(canonical).length !== release.bytes || await pluginIntegrity(pkg) !== release.integrity ||
      canonicalPluginJson(pkg.manifest) !== canonicalPluginJson(release.manifest)) throw new Error('下载的插件与目录版本不一致，未安装');
}
/** Index and packages use the same HTTPS origin. No credentials, redirects or arbitrary download URLs. */
export class HttpPluginCatalog implements PluginCatalogProvider {
  readonly source: string;
  private readonly base: URL;
  constructor(url: string) {
    this.source = pluginCatalogHttps(url);
    const parsed = new URL(this.source);
    if (!parsed.pathname.endsWith('/index.json') || parsed.search) throw new Error('插件目录地址必须以 /index.json 结尾且不带查询参数');
    this.base = new URL('./', parsed);
  }
  async list(signal: AbortSignal) {
    const scoped = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    const catalog = parsePluginCatalog(await fetchPluginText(this.source, scoped, pluginCatalogLimit));
    scoped.throwIfAborted(); return catalog;
  }
  async download(release: PluginCatalogRelease, signal: AbortSignal) {
    const scoped = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    // Refresh the index before fetching and again before returning. A stale detail
    // panel or a withdrawal during download must not silently install that release.
    const available = async () => {
      const current = (await this.list(scoped)).releases.find(item => item.manifest.id === release.manifest.id && item.manifest.version === release.manifest.version);
      if (!current || current.status !== 'published' || canonicalPluginJson(current) !== canonicalPluginJson(release)) throw new Error('此目录版本已撤回或变化，请刷新目录');
    };
    await available();
    const sourceUrl = new URL(`packages/${release.integrity}.json`, this.base).href;
    const pkg = parsePluginPackage(await fetchPluginText(sourceUrl, scoped));
    await verifyCatalogPackage(release, pkg); await available(); scoped.throwIfAborted();
    return { pkg, sourceUrl };
  }
}
