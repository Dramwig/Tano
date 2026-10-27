// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { integrity, publicationAllowed, sha256 } from './core-distribution.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function publishCore({ root = repository, apply = false, evidencePath,
  npmCli = process.env.npm_execpath, run = execFileSync, fetchImpl = fetch } = {}) {
  if (!npmCli?.endsWith('.js')) throw new Error('Run through npm run core:publish');
  const directory = join(root, 'artifacts/core-registry');
  const manifest = JSON.parse(await readFile(join(directory, 'core-registry.json'), 'utf8'));
  const npm = args => run(process.execPath, [npmCli, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe', windowsHide: true });
  const git = args => run('git', args, { cwd: root, encoding: 'utf8' }).trim();
  for (const item of [...manifest.packages, manifest.native]) {
    if (!/^[\w.-]+\.(tgz|crate)$/.test(item.file)) throw new Error('Unsafe Core artifact path');
    const bytes = await readFile(join(directory, item.file));
    if (sha256(bytes) !== item.sha256 || (item.integrity && integrity(bytes) !== item.integrity))
      throw new Error(`Core artifact changed: ${item.file}`);
  }
  if (!apply) {
    for (const item of manifest.packages)
      npm(['publish', join(directory, item.file), '--dry-run', '--ignore-scripts', '--access', 'public', '--registry', manifest.npmRegistry]);
    console.log(`Dry run only: ${manifest.packages.map(p => `${p.publishedName}@${p.version}`).join(', ')}, ${manifest.native.name}@${manifest.native.version}. No packages uploaded.`);
    return manifest;
  }
  const evidence = evidencePath ? JSON.parse(await readFile(resolve(evidencePath), 'utf8')) : undefined;
  publicationAllowed(manifest, evidence);
  const smoke = JSON.parse(await readFile(join(directory, 'smoke/summary.json'), 'utf8'));
  if (smoke.sourceCommit !== manifest.sourceCommit || smoke.distributionSha256 !== sha256(await readFile(join(directory, 'core-registry.json'))) ||
      !['installation', 'workbench-production-build', 'mcp-roundtrip'].every(name => smoke.passed?.includes(name)))
    throw new Error('Registry installation smoke must pass for these exact distribution artifacts');
  if (git(['status', '--porcelain']) || git(['rev-parse', 'HEAD']) !== manifest.sourceCommit ||
      git(['rev-parse', `core-v${manifest.version}^{commit}`]) !== manifest.sourceCommit)
    throw new Error('Publish only from the clean, locally validated immutable Core tag');
  run('git', ['merge-base', '--is-ancestor', manifest.sourceCommit, 'origin/main'], { cwd: root });
  // Repack from the validated source before calling this command; Rust's publisher must
  // publish exactly the prepared archive, not silently reuse a modified source tree.
  npm(['whoami', '--registry', manifest.npmRegistry]);
  const pending = [];
  for (const item of manifest.packages) {
    try {
      const existing = JSON.parse(npm(['view', `${item.publishedName}@${item.version}`, '--json', '--registry', manifest.npmRegistry]));
      if (existing.dist?.integrity !== item.integrity || existing.tanoCore?.sourceCommit !== manifest.sourceCommit)
        throw new Error(`Immutable npm version already contains different code: ${item.publishedName}@${item.version}`);
    } catch (error) {
      if (/E404/.test(String(error.stderr))) pending.push(item);
      else throw error;
    }
  }
  const nativeUrl = `https://crates.io/api/v1/crates/tano-native/${manifest.version}`;
  const nativeResponse = await fetchImpl(nativeUrl, { headers: { 'User-Agent': 'Tano-Core-distribution (https://github.com/Dramwig/Tano)' }, signal: AbortSignal.timeout(30_000) });
  let publishNative = false;
  if (nativeResponse.status === 404) publishNative = true;
  else {
    if (!nativeResponse.ok) throw new Error(`Cannot query crates.io: HTTP ${nativeResponse.status}`);
    if ((await nativeResponse.json()).version?.checksum !== manifest.native.sha256)
      throw new Error('Immutable Rust version already contains different code');
  }
  // Complete all collision checks before the first remote write. Retrying a partial
  // publication skips only versions whose exact bytes and provenance already match.
  if (publishNative) {
    run('cargo', ['package', '--manifest-path', join(root, 'crates/tano-native/Cargo.toml'),
      '--target-dir', join(directory, 'native-target'), '--locked', '--no-verify'], { cwd: root, stdio: 'inherit' });
    const packed = await readFile(join(directory, 'native-target/package', manifest.native.file));
    if (sha256(packed) !== manifest.native.sha256) throw new Error('Rust archive changed; prepare the distribution again');
    run('cargo', ['publish', '--manifest-path', join(root, 'crates/tano-native/Cargo.toml'),
      '--target-dir', join(directory, 'native-target'), '--locked', '--no-verify'], { cwd: root, stdio: 'inherit' });
  }
  for (const item of pending)
    run(process.execPath, [npmCli, 'publish', join(directory, item.file), '--ignore-scripts', '--access', 'public', '--loglevel=warn', '--registry', manifest.npmRegistry],
      { cwd: root, stdio: 'inherit', windowsHide: true });
  console.log(`Core ${manifest.version} published. Consumer: npm run core:sync -- --registry "${join(directory, 'core-registry.json')}"`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const evidenceIndex = args.indexOf('--evidence');
  const valid = evidenceIndex < 0 ? args : args.filter((_, index) => index !== evidenceIndex && index !== evidenceIndex + 1);
  if (valid.some(arg => !['--apply', '--dry-run'].includes(arg)) ||
      args.includes('--apply') && args.includes('--dry-run') || evidenceIndex >= 0 && !args[evidenceIndex + 1]) {
    console.error('Usage: npm run core:publish -- [--dry-run | --apply --evidence <json-file>]');
    process.exitCode = 1;
  } else publishCore({ apply: args.includes('--apply'), evidencePath: evidenceIndex < 0 ? undefined : args[evidenceIndex + 1] })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
