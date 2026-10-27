// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corePackages, distributionConfig, integrity, publishPackage, sha256 } from './core-distribution.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function prepareRegistry(root = repository, npmCli = process.env.npm_execpath, configRoot = root) {
  root = resolve(root);
  if (!npmCli?.endsWith('.js')) throw new Error('Run through npm run core:registry:prepare');
  const config = distributionConfig(JSON.parse(await readFile(join(configRoot, 'core-distribution.json'), 'utf8')));
  const source = join(root, 'artifacts/core');
  const original = JSON.parse(await readFile(join(source, 'core-manifest.json'), 'utf8'));
  const out = join(root, 'artifacts/core-registry');
  await mkdir(out, { recursive: true });
  const verifiedOutput = await realpath(out);
  const removeStage = async stage => {
    let target;
    try { target = await realpath(stage); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const rel = relative(verifiedOutput, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe Core staging directory');
    await rm(stage, { recursive: true, force: true });
  };
  const manifest = { format: 2, version: original.version, sourceCommit: original.sourceCommit,
    dirty: original.dirty, npmRegistry: config.npmRegistry, packages: [] };
  // Pack each staged package separately. Source package manifests remain private workspaces.
  for (const name of corePackages) {
    const item = original.packages.find(item => item.name === `@tano/${name}`);
    if (!item || item.version !== original.version || !/^[\w.-]+\.tgz$/.test(item.file))
      throw new Error(`Missing or invalid Core package ${name}`);
    const bytes = await readFile(join(source, item.file));
    if (sha256(bytes) !== item.sha256) throw new Error(`Damaged Core artifact: ${item.file}`);
    const stage = join(out, `stage-${name}`);
    // This fixed staging path is under the repository's ignored artifacts directory.
    await removeStage(stage);
    await mkdir(stage);
    execFileSync('tar', ['-xzf', join(source, item.file), '-C', stage], { cwd: root, stdio: 'pipe' });
    const pkgPath = join(stage, 'package/package.json');
    const pkg = publishPackage(JSON.parse(await readFile(pkgPath, 'utf8')), config, original.sourceCommit);
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    const packed = JSON.parse(execFileSync(process.execPath,
      [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', out],
      { cwd: dirname(pkgPath), encoding: 'utf8', windowsHide: true }))[0];
    const packedBytes = await readFile(join(out, packed.filename));
    const file = packed.filename.replace(/\.tgz$/, `-${sha256(packedBytes).slice(0, 12)}.tgz`);
    await rename(join(out, packed.filename), join(out, file));
    manifest.packages.push({ name: item.name, publishedName: pkg.name, version: pkg.version,
      file, sha256: sha256(packedBytes), integrity: integrity(packedBytes) });
    await removeStage(stage);
  }
  execFileSync('cargo', ['package', '--manifest-path', join(root, 'crates/tano-native/Cargo.toml'),
    '--target-dir', join(out, 'native-target'), '--locked', '--no-verify', '--allow-dirty'],
  { cwd: root, stdio: 'inherit', windowsHide: true });
  const nativeFile = `${config.nativePackage}-${original.version}.crate`;
  await copyFile(join(out, 'native-target/package', nativeFile), join(out, nativeFile));
  const nativeBytes = await readFile(join(out, nativeFile));
  manifest.native = { name: config.nativePackage, version: original.version,
    file: nativeFile, sha256: sha256(nativeBytes), registry: 'crates-io' };
  // Refuse an export that changed while registry artifacts were being prepared.
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  manifest.dirty ||= head !== original.sourceCommit ||
    Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
  const path = join(out, 'core-registry.json');
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Prepared five npm packages and one Rust crate: ${path}${manifest.dirty ? ' (development preview; not publishable)' : ''}`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  prepareRegistry().catch(error => { console.error(error.message); process.exitCode = 1; });
