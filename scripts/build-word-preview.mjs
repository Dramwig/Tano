import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { buildPlugin } from './plugin-build.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'examples/plugins/word-preview');
const destination = resolve(root, 'packages/workbench/src/plugins/word-preview');
async function license(directory) {
  const names = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'LICENSE-MIT', 'LICENSE.markdown'];
  let result = '';
  for (const name of names) { try { result = await readFile(resolve(directory, name), 'utf8'); break; } catch {} }
  if (!result) {
    const readme = await readFile(resolve(directory, 'README.md'), 'utf8');
    const start = readme.search(/^#+ License/m);
    if (start >= 0) result = readme.slice(start);
  }
  if (!result) throw new Error('License missing: ' + directory);
  for (const name of ['NOTICE', 'THIRD_PARTY_NOTICES.txt']) { try { result += '\n' + await readFile(resolve(directory, name), 'utf8'); } catch {} }
  return result;
}
const notices = ['Word Preview for Tano — MIT\n'];
// Resolve licenses from actual bundle inputs, including nested dependency versions.
const inventory = await build({ entryPoints: [resolve(source, 'ui/document.ts')], absWorkingDir: root,
  outfile: 'inventory.js', bundle: true, platform: 'browser', format: 'iife', write: false, metafile: true,
  loader: { '.txt': 'text' }, logLevel: 'silent' });
const directories = new Set(Object.keys(inventory.metafile.inputs).flatMap(input => {
  const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  return match ? [resolve(root, match[1])] : [];
}));
// Browser distributions also contain prebundled dependency code not visible to esbuild.
async function collectEmbeddedDependencies(directory) {
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const require = createRequire(resolve(directory, 'package.json'));
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const dependency = dirname(require.resolve(`${name}/package.json`));
    if (directories.has(dependency)) continue;
    directories.add(dependency); await collectEmbeddedDependencies(dependency);
  }
}
await collectEmbeddedDependencies(resolve(root, 'node_modules/jszip'));
await collectEmbeddedDependencies(resolve(root, 'node_modules/cfb'));
for (const directory of [...directories].sort()) {
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  notices.push(`${pkg.name}@${pkg.version}\n${await license(directory)}`);
}
await writeFile(resolve(source, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));
const result = await buildPlugin(source);
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, 'bundle.tano-plugin.json'), result.canonical + '\n');
await writeFile(resolve(destination, 'manifest.json'), await readFile(resolve(source, 'manifest.json')));
console.log(`Word Preview: ${Buffer.byteLength(result.canonical)} bytes, SHA-256 ${result.integrity}`);
