// Publish a durable discovery manifest without overwriting an existing release asset.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const tag = process.argv[2];
const repository = process.env.GITHUB_REPOSITORY ?? 'Dramwig/Tano';
if (!/^core-v\d+\.\d+\.\d+$/.test(tag ?? '') || repository !== 'Dramwig/Tano')
  throw new Error('Expected an official stable Core tag');
const file = resolve(process.argv[3] ?? 'artifacts/core-registry/core-registry.json');
const bytes = await readFile(file);
const manifest = JSON.parse(bytes);
if (manifest.dirty !== false || `core-v${manifest.version}` !== tag)
  throw new Error('Only a clean manifest matching the release tag can be published');
const gh = args => execFileSync('gh', [...args, '--repo', repository], { encoding: 'utf8' });
const release = JSON.parse(gh(['release', 'view', tag, '--json', 'assets']));
// Also repair an existing Core Release created outside this workflow. Local
// assets and registry manifests must never displace the Product updater feed.
gh(['release', 'edit', tag, '--latest=false']);
if (release.assets.some(asset => asset.name === 'core-registry.json')) {
  const existing = gh(['release', 'download', tag, '--pattern', 'core-registry.json', '--output', '-']);
  if (existing !== bytes.toString()) throw new Error('Immutable Core manifest already differs; do not overwrite it');
  console.log('Identical Core manifest already published.');
} else {
  gh(['release', 'upload', tag, file]);
  console.log(`https://github.com/${repository}/releases/download/${tag}/core-registry.json`);
}
