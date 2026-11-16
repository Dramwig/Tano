import { readFile, mkdir, writeFile, realpath, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { protocol, verifyPlugin } from './plugin-build.mjs';

async function boundedRead(path, limit) {
  if ((await stat(path)).size > limit) throw new Error(`File exceeds ${limit} bytes: ${path}`);
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error(`File exceeds ${limit} bytes: ${path}`);
  return bytes.toString('utf8');
}
export async function preparePluginRelease(packagePath, destination, options) {
  const api = await protocol();
  const { pkg, canonical, integrity } = await verifyPlugin(await boundedRead(packagePath, api.pluginPackageLimit));
  const timestamp = new Date().toISOString();
  const release = { publisher: options.publisher, manifest: pkg.manifest, integrity, bytes: Buffer.byteLength(canonical), publishedAt: timestamp,
    source: options.source, license: options.license, notes: options.notes ? await boundedRead(options.notes, 16000) : '', status: 'published' };
  const checked = api.parsePluginCatalog(JSON.stringify({ catalogVersion: 1, name: 'Submission', updatedAt: timestamp,
    publishers: [{ id: options.publisher, name: options.publisher, homepage: options.source, pluginIds: [pkg.manifest.id] }], releases: [release] }));
  // An author only produces a submission. Inclusion in the operator's reviewed
  // index and publisher assignment is a separate, repository-controlled action.
  await mkdir(destination, { recursive: false });
  await mkdir(join(destination, 'packages'));
  await writeFile(join(destination, 'packages', `${integrity}.json`), canonical, { flag: 'wx' });
  await writeFile(join(destination, 'release.json'), JSON.stringify(checked.releases[0], null, 2) + '\n', { flag: 'wx' });
  return checked.releases[0];
}

/** Builds a new immutable directory; index.json is emitted last, only after every package verifies. */
export async function buildPluginCatalog(indexPath, destination, options) {
  const api = await protocol();
  if ((!options.previous) === (!options.initial)) throw new Error('Specify --previous <last-published-index.json>, or --initial for a new catalog');
  const catalog = api.parsePluginCatalog(await boundedRead(indexPath, api.pluginCatalogLimit));
  const indexContent = JSON.stringify(catalog, null, 2) + '\n';
  api.parsePluginCatalog(indexContent);
  if (options.previous) api.assertPluginCatalogTransition(api.parsePluginCatalog(await boundedRead(options.previous, api.pluginCatalogLimit)), catalog);
  const packageRoot = await realpath(resolve(options.packages));
  const unique = new Map(catalog.releases.map(release => [release.integrity, release]));
  if ([...unique.values()].reduce((sum, release) => sum + release.bytes, 0) > 256 * 1024 * 1024) throw new Error('Catalog packages exceed the 256 MiB build limit');
  const readPackage = async release => {
    const path = await realpath(join(packageRoot, `${release.integrity}.json`));
    const rel = relative(packageRoot, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Package symlink escapes the selected package directory');
    const { pkg, canonical, integrity } = await verifyPlugin(await boundedRead(path, api.pluginPackageLimit));
    if (integrity !== release.integrity || Buffer.byteLength(canonical) !== release.bytes || api.canonicalPluginJson(pkg.manifest) !== api.canonicalPluginJson(release.manifest))
      throw new Error(`Package does not match reviewed release: ${release.manifest.id}@${release.manifest.version}`);
    return canonical;
  };
  // Validate every release (not just unique digests), so a reused digest cannot
  // conceal a second forged manifest. Validate before creating output files.
  for (const release of catalog.releases) await readPackage(release);
  await mkdir(destination, { recursive: false });
  await mkdir(join(destination, 'packages'));
  for (const release of unique.values()) await writeFile(join(destination, 'packages', `${release.integrity}.json`), await readPackage(release), { flag: 'wx' });
  await writeFile(join(destination, 'index.json'), indexContent, { flag: 'wx' });
  return catalog;
}
