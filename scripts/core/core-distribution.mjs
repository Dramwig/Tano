// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';

export const corePackages = ['protocol', 'markdown', 'editor', 'workbench', 'mcp'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

export function distributionConfig(config) {
  if (config.format !== 1 || !/^@[a-z0-9][a-z0-9._-]*$/.test(config.npmScope ?? '') ||
      config.nativePackage !== 'tano-native') throw new Error('Invalid Core distribution configuration');
  const url = new URL(config.npmRegistry);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Core npm registry must be an HTTPS URL without credentials');
  return { ...config, npmRegistry: url.href.replace(/\/?$/, '/') };
}

// Keep public import names stable even when the publishing account has another scope.
export function publishPackage(pkg, config, sourceCommit) {
  const expected = new Set(corePackages.map(name => `@tano/${name}`));
  if (!expected.has(pkg.name)) throw new Error(`Unexpected Core package: ${pkg.name}`);
  const publishedName = `${config.npmScope}/${pkg.name.split('/')[1]}`;
  const result = structuredClone(pkg);
  result.name = publishedName;
  delete result.private;
  delete result.scripts;
  delete result.devDependencies;
  result.publishConfig = { registry: config.npmRegistry, access: 'public' };
  result.repository = { type: 'git', url: 'git+https://github.com/Dramwig/Tano.git' };
  result.tanoCore = { sourceCommit, version: pkg.version, importName: pkg.name };
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(result[field] ?? {})) {
      if (!expected.has(name)) continue;
      const target = `${config.npmScope}/${name.split('/')[1]}`;
      result[field][name] = target === name ? pkg.version : `npm:${target}@${pkg.version}`;
    }
  }
  return result;
}

export function publicationAllowed(manifest, evidence) {
  if (manifest.format !== 2 || manifest.packages?.length !== corePackages.length ||
      JSON.stringify(manifest.packages.map(p => p.name).sort()) !==
        JSON.stringify(corePackages.map(name => `@tano/${name}`).sort()) ||
      manifest.packages.some(p => p.version !== manifest.version || !/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(p.publishedName ?? '')) ||
      manifest.native?.name !== 'tano-native' || manifest.native.version !== manifest.version)
    throw new Error('Publication requires exactly five npm packages and one matching native crate');
  const registry = new URL(manifest.npmRegistry);
  if (registry.protocol !== 'https:' || registry.username || registry.password || registry.search || registry.hash)
    throw new Error('Invalid npm publication registry');
  if (manifest.dirty !== false || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? '') ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version ?? ''))
    throw new Error('Publication requires a clean, stable Core release');
  if (evidence?.sourceCommit !== manifest.sourceCommit)
    throw new Error('Local release evidence must identify this exact Core commit');
  for (const command of ['npm run check', 'npm run test:native', 'npm run mcp:smoke', 'npm run core:registry:smoke']) {
    if (!evidence.commands?.some(item => item.command === command && item.exitCode === 0))
      throw new Error(`Missing successful local release evidence: ${command}`);
  }
}
