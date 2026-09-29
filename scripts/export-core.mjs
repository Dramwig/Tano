import { mkdir, readFile, readdir, writeFile, lstat, rename } from 'node:fs/promises';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? join(root, 'artifacts/core'));
await mkdir(output, { recursive: true });
const packages = ['packages/protocol', 'packages/markdown', 'packages/editor', 'packages/workbench', 'apps/mcp'];
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const npmCli = process.env.npm_execpath;
if (!npmCli?.endsWith('.js')) throw new Error('Run through npm run core:export -- <output-directory>');
const files = [];
for (const folder of packages) {
  const packed = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', output], { cwd: join(root, folder), encoding: 'utf8' }))[0];
  if (packed.version !== version) throw new Error(`${packed.name} version differs from public Tano ${version}`);
  const bytes = await readFile(join(output, packed.filename));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = packed.filename.replace(/\.tgz$/, `-${sha256.slice(0, 12)}.tgz`);
  await rename(join(output, packed.filename), join(output, file));
  files.push({ name: packed.name, version: packed.version, file, sha256 });
}
async function collect(folder, prefix = '') {
  const entries = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const p = join(folder, entry.name), name = prefix + entry.name;
    if ((await lstat(p)).isSymbolicLink()) throw new Error('Core export does not follow symlinks');
    if (entry.isDirectory()) entries.push(...await collect(p, name + '/'));
    else entries.push({ path: name, content: (await readFile(p)).toString('base64') });
  }
  return entries;
}
const native = await collect(join(root, 'crates/tano-native/src'), 'src/');
for (const name of ['Cargo.toml', 'Cargo.lock', 'build.rs', 'LICENSE']) native.push({ path: name, content: (await readFile(join(root, 'crates/tano-native', name))).toString('base64') });
const nativeBytes = Buffer.from(JSON.stringify(native));
await writeFile(join(output, 'tano-native.json'), nativeBytes);
let commit = 'uncommitted';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
await writeFile(join(output, 'core-manifest.json'), JSON.stringify({ format: 1, version, sourceCommit: commit, dirty, packages: files, native: {file: 'tano-native.json', sha256: createHash('sha256').update(nativeBytes).digest('hex')} }, null, 2) + '\n');
console.log(`Core distribution exported to ${relative(root, output)} (${commit}${dirty ? ', working changes' : ''})`);
