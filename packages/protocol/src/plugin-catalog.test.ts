import { expect, it } from 'vitest';
import { assertPluginCatalogTransition, comparePluginVersions, parsePluginCatalog, type PluginReleaseCatalog } from './plugin-catalog';

const catalog = (): PluginReleaseCatalog => ({ catalogVersion: 1, name: '测试目录', updatedAt: '2026-10-09T00:00:00.000Z',
  publishers: [{ id: 'author', name: '作者', homepage: 'https://example.com/author', pluginIds: ['example'] }],
  releases: [{ publisher: 'author', manifest: { manifestVersion: 1, id: 'example', name: '示例', version: '1.0.0', description: '', objectTypes: [], relationTypes: [] },
    integrity: 'a'.repeat(64), bytes: 100, publishedAt: '2026-10-09T00:00:00.000Z', source: 'https://example.com/revision/1', license: 'MIT', notes: '第一行\n第二行', status: 'published' }] });
it('requires bounded, owned, unique releases and safe data-only links', () => {
  expect(parsePluginCatalog(JSON.stringify(catalog()))).toEqual(catalog());
  const invalid = [
    (value: PluginReleaseCatalog) => value.publishers.push({ ...value.publishers[0]!, id: 'other' }),
    (value: PluginReleaseCatalog) => value.releases.push(value.releases[0]!),
    (value: PluginReleaseCatalog) => { value.publishers = []; delete (value.releases[0] as Partial<PluginReleaseCatalog['releases'][0]>).publisher; },
    (value: PluginReleaseCatalog) => { value.releases[0]!.source = 'javascript:alert(1)'; },
    (value: PluginReleaseCatalog) => { value.publishers[0]!.homepage = 'https://user:secret@example.com/'; },
    (value: PluginReleaseCatalog) => { value.releases[0]!.status = 'withdrawn'; },
    (value: PluginReleaseCatalog) => { value.releases[0]!.bytes = 4 * 1024 * 1024 + 1; },
    (value: PluginReleaseCatalog) => { value.updatedAt = '2026-02-30T00:00:00.000Z'; },
  ];
  for (const mutate of invalid) { const value = catalog(); mutate(value); expect(() => parsePluginCatalog(JSON.stringify(value))).toThrow(); }
});
it('keeps version history, publisher ownership and reviewed bytes immutable across catalog builds', () => {
  const before = catalog(), after = catalog();
  after.releases.push({ ...after.releases[0]!, manifest: { ...after.releases[0]!.manifest, version: '2.0.0' }, integrity: 'b'.repeat(64) });
  expect(() => assertPluginCatalogTransition(before, after)).not.toThrow();
  after.releases[0]!.status = 'withdrawn'; after.releases[0]!.reason = '存在问题';
  expect(() => assertPluginCatalogTransition(before, after)).not.toThrow();
  expect(() => assertPluginCatalogTransition(after, before)).toThrow();
  for (const key of ['integrity', 'source', 'license', 'notes'] as const) {
    const changed = catalog(); changed.releases[0]![key] = 'changed';
    expect(() => assertPluginCatalogTransition(before, changed)).toThrow('不可覆盖');
  }
  const removed = catalog(); removed.releases = []; expect(() => assertPluginCatalogTransition(before, removed)).toThrow('不能从目录删除');
  const reassigned = catalog(); reassigned.publishers[0]!.pluginIds = []; expect(() => assertPluginCatalogTransition(before, reassigned)).toThrow('转移');
  const older = catalog(); older.updatedAt = '2025-10-09T00:00:00.000Z'; expect(() => assertPluginCatalogTransition(before, older)).toThrow('倒退');
});
it('orders numeric version triplets rather than lexicographic labels', () => {
  expect(comparePluginVersions('1.10.0', '1.9.0')).toBe(1);
  expect(comparePluginVersions('0.99.9', '1.0.0')).toBe(-1);
  expect(comparePluginVersions('10000000000000000001.0.0', '10000000000000000000.0.0')).toBe(1);
});
