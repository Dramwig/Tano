// SPDX-License-Identifier: MIT
// Kept in both repositories so release automation never needs an unpinned tool download.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function versionParts(value) {
  if (!stable.test(value)) throw new Error(`Expected a stable version: ${value}`);
  const parts = value.split('.').map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part)))
    throw new Error('Version exceeds safe integer range');
  return parts;
}
export function compareVersions(a, b) {
  const left = versionParts(a),
    right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export function nextVersion(current, requested) {
  const parts = versionParts(current);
  const index = ['major', 'minor', 'patch'].indexOf(requested);
  if (index >= 0) {
    parts[index]++;
    for (let i = index + 1; i < 3; i++) parts[i] = 0;
    requested = parts.join('.');
  }
  if (compareVersions(requested, current) < 0)
    throw new Error('Release version cannot go backwards');
  return requested;
}
export function validatePlan(plan, pkg) {
  const kind = pkg.name === 'tano' ? 'core' : pkg.name === 'tano-cloud' ? 'product' : undefined;
  if (!kind || plan.format !== 1 || plan.kind !== kind || plan.version !== pkg.version)
    throw new Error('Release plan does not match this repository and package version');
  versionParts(plan.version);
  if (!(kind === 'core' ? ['core'] : ['cloud', 'desktop', 'all']).includes(plan.scope))
    throw new Error('Invalid release scope');
  const tag = `${kind === 'core' ? 'core-v' : 'v'}${plan.version}`;
  if (plan.tag !== tag || plan.notes !== `.github/releases/${tag}.md`)
    throw new Error('Invalid release tag or notes path');
  return plan;
}
export function output(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!/^[a-z_]+$/.test(key) || /[\r\n]/.test(String(value)))
      throw new Error('Invalid workflow output');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
export function readPlan(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const plan = validatePlan(
    JSON.parse(readFileSync(join(root, '.github/release-plan.json'), 'utf8')),
    pkg,
  );
  if (!existsSync(join(root, plan.notes))) throw new Error('Release notes are missing');
  return plan;
}
export async function prepareRelease(root, requested, scope) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const kind = pkg.name === 'tano' ? 'core' : 'product';
  const version = nextVersion(pkg.version, requested);
  const tag = `${kind === 'core' ? 'core-v' : 'v'}${version}`;
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const tags = git('tag', '--list', kind === 'core' ? 'core-v*' : 'v*')
    .split('\n')
    .filter(Boolean);
  if (tags.includes(tag)) throw new Error(`Tag ${tag} already exists; use a higher version`);
  const previous = tags
    .filter((t) => stable.test(t.replace(/^(core-)?v/, '')))
    .sort((a, b) => compareVersions(b.replace(/^(core-)?v/, ''), a.replace(/^(core-)?v/, '')))[0];
  if (previous && compareVersions(version, previous.replace(/^(core-)?v/, '')) <= 0)
    throw new Error('Version must exceed all existing release tags');
  const plan = {
    format: 1,
    kind,
    version,
    tag,
    scope: kind === 'core' ? 'core' : scope,
    notes: `.github/releases/${tag}.md`,
  };
  validatePlan(plan, { ...pkg, version });
  // Only use Git data as text. Commit messages are never evaluated by a shell.
  const changes = git('log', '--format=- %s (%h)', previous ? `${previous}..HEAD` : 'HEAD');
  if (kind === 'core')
    (await import(pathToFileURL(join(root, 'scripts/version.mjs')))).setVersions(root, version);
  else
    (await import(pathToFileURL(join(root, 'scripts/set-product-version.mjs')))).setProductVersion(
      root,
      version,
    );
  mkdirSync(join(root, '.github/releases'), { recursive: true });
  writeFileSync(
    join(root, plan.notes),
    `# ${kind === 'core' ? 'Tano Core' : 'Tano'} ${version}\n\n${changes || '- Initial release'}\n`,
  );
  writeFileSync(join(root, '.github/release-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  output({ version, tag, notes: plan.notes, branch: `codex/release-${kind}-${version}` });
  return plan;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    if (process.argv[2] === 'prepare')
      console.log(await prepareRelease(root, process.argv[3], process.argv[4] ?? 'all'));
    else if (process.argv[2] === 'check') {
      const plan = readPlan(root);
      if (process.env.TANO_RELEASE_TAG && plan.tag !== process.env.TANO_RELEASE_TAG)
        throw new Error('Selected tag differs from release plan');
      output({ version: plan.version, tag: plan.tag, scope: plan.scope, notes: plan.notes });
      console.log(`Release plan verified: ${plan.tag} (${plan.scope})`);
    } else
      throw new Error(
        'Usage: release-plan.mjs prepare <patch|minor|major|X.Y.Z> [cloud|desktop|all] | check',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
