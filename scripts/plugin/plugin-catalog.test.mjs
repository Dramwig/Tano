import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { preparePluginRelease, buildPluginCatalog } from './plugin-catalog.mjs';

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const root = resolve(tmpdir()) + sep, absolute = resolve(directory);
    if (!absolute.startsWith(root) || !absolute.slice(root.length).startsWith('tano-catalog-')) throw new Error('Unsafe test cleanup');
    await rm(absolute, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tano-catalog-')); directories.push(root);
  const pkg = { packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: 'example', name: '示例', version: '1.0.0', description: '', objectTypes: [], relationTypes: [], permissions: [], commands: [], views: [] }, source: 'await tano.notify("ready");' };
  const packagePath = join(root, 'input.json'); await writeFile(packagePath, JSON.stringify(pkg));
  const submission = join(root, 'submission');
  const release = await preparePluginRelease(packagePath, submission, { publisher: 'author', source: 'https://example.com/source/commit', license: 'MIT' });
  const catalog = { catalogVersion: 1, name: '私有审核目录', updatedAt: release.publishedAt,
    publishers: [{ id: 'author', name: '作者', homepage: 'https://example.com/author', pluginIds: ['example'] }], releases: [release] };
  const index = join(root, 'reviewed.json'); await writeFile(index, JSON.stringify(catalog));
  return { root, pkg, catalog, index, release, packages: join(submission, 'packages') };
}
it('prepares a reviewable submission and builds a verified static directory without overwriting output', async () => {
  const fixtureData = await fixture(); const { root, index, release, packages } = fixtureData;
  const output = join(root, 'published');
  await buildPluginCatalog(index, output, { packages, initial: true });
  expect(JSON.parse(await readFile(join(output, 'index.json'), 'utf8')).releases[0].integrity).toBe(release.integrity);
  expect(await readFile(join(output, 'packages', `${release.integrity}.json`), 'utf8')).toContain('ready');
  await expect(buildPluginCatalog(index, output, { packages, previous: join(output, 'index.json') })).rejects.toThrow();
  await expect(buildPluginCatalog(index, join(root, 'not-reviewed'), { packages })).rejects.toThrow('--previous');
});
it('permits withdrawal but refuses history deletion, republishing and changes to reviewed version bytes', async () => {
  const { root, index, catalog, release, packages } = await fixture();
  const output = join(root, 'published'); await buildPluginCatalog(index, output, { packages, initial: true });
  const previous = join(output, 'index.json');
  release.status = 'withdrawn'; release.reason = '修复中'; await writeFile(index, JSON.stringify(catalog));
  const withdrawn = join(root, 'withdrawn'); await buildPluginCatalog(index, withdrawn, { packages, previous });
  delete release.reason; release.status = 'published'; await writeFile(index, JSON.stringify(catalog));
  await expect(buildPluginCatalog(index, join(root, 'republished'), { packages, previous: join(withdrawn, 'index.json') })).rejects.toThrow('不可重新上架');
  catalog.releases = []; await writeFile(index, JSON.stringify(catalog));
  await expect(buildPluginCatalog(index, join(root, 'deleted'), { packages, previous })).rejects.toThrow('不能从目录删除');
  catalog.releases = [{ ...release, integrity: 'a'.repeat(64) }]; await writeFile(index, JSON.stringify(catalog));
  await expect(buildPluginCatalog(index, join(root, 'overwritten'), { packages, previous })).rejects.toThrow('不可覆盖');
});
it('rejects tampered package content before writing an index', async () => {
  const { root, index, release, packages, pkg } = await fixture();
  await writeFile(join(packages, `${release.integrity}.json`), JSON.stringify({ ...pkg, source: 'unreviewed()' }));
  const output = join(root, 'tampered');
  await expect(buildPluginCatalog(index, output, { packages, initial: true })).rejects.toThrow('does not match');
  await expect(readFile(join(output, 'index.json'))).rejects.toThrow();
});
