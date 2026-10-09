import { afterEach, expect, it, vi } from 'vitest';
import { canonicalPluginJson, parsePluginPackage, type PluginReleaseCatalog } from '@tano/protocol';
import { documentOverviewPlugin } from './example';
import { pluginIntegrity } from './packages';
import { HttpPluginCatalog, verifyCatalogPackage } from './catalog';

afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const pkg = parsePluginPackage(JSON.stringify(documentOverviewPlugin));
  const content = canonicalPluginJson(pkg);
  const release = { publisher: 'author', manifest: pkg.manifest, integrity: await pluginIntegrity(pkg), bytes: new TextEncoder().encode(content).length,
    publishedAt: '2026-10-09T00:00:00.000Z', source: 'https://example.com/source/commit', license: 'MIT', notes: '', status: 'published' as const };
  const catalog: PluginReleaseCatalog = { catalogVersion: 1, name: '测试目录', updatedAt: release.publishedAt,
    publishers: [{ id: 'author', name: '作者', homepage: 'https://example.com', pluginIds: [pkg.manifest.id] }], releases: [release] };
  return { pkg, content, release, catalog, provider: new HttpPluginCatalog('https://catalog.example.com/plugins/index.json') };
}
it('downloads exact reviewed bytes without cookies or redirects and refreshes before and after download', async () => {
  const { content, release, catalog, provider } = await fixture();
  const request = vi.fn(async (url: string, _options?: RequestInit) => new Response(url.endsWith('/index.json') ? JSON.stringify(catalog) : content));
  vi.stubGlobal('fetch', request);
  const downloaded = await provider.download(release, new AbortController().signal);
  expect(downloaded.sourceUrl).toBe(`https://catalog.example.com/plugins/packages/${release.integrity}.json`);
  expect(request).toHaveBeenCalledTimes(3);
  for (const args of request.mock.calls) expect(args[1]).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
});
it.each(['before', 'during'])('rejects a withdrawn release %s a download', async timing => {
  const { content, release, catalog, provider } = await fixture();
  const withdrawn = structuredClone(catalog); withdrawn.releases[0]!.status = 'withdrawn'; withdrawn.releases[0]!.reason = '撤回';
  let requests = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests++;
    return new Response(url.endsWith('/index.json') ? JSON.stringify(timing === 'before' || requests > 2 ? withdrawn : catalog) : content);
  }));
  await expect(provider.download(release, new AbortController().signal)).rejects.toThrow('撤回');
  expect(requests).toBe(timing === 'before' ? 1 : 3);
});
it('rejects bad bytes, manifests, sizes, unsafe configuration and cancelled downloads', async () => {
  const { pkg, release, catalog, provider } = await fixture();
  await expect(verifyCatalogPackage({ ...release, bytes: release.bytes + 1 }, pkg)).rejects.toThrow('不一致');
  await expect(verifyCatalogPackage({ ...release, integrity: 'a'.repeat(64) }, pkg)).rejects.toThrow('不一致');
  await expect(verifyCatalogPackage({ ...release, manifest: { ...release.manifest, name: 'Forged' } }, pkg)).rejects.toThrow('不一致');
  for (const url of ['http://example.com/index.json', 'https://user@example.com/index.json', 'https://example.com/index.json?secret=x', 'https://example.com/other.json']) expect(() => new HttpPluginCatalog(url)).toThrow();
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return new Response(JSON.stringify(catalog)); }));
  await expect(provider.download(release, controller.signal)).rejects.toThrow();
});
