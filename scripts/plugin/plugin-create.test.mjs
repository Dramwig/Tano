import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { createPlugin } from './plugin-create.mjs';
import { buildPlugin, buildPluginZip, verifyPlugin } from './plugin-build.mjs';

it.each(['vanilla', 'vue', 'react'])('creates a typechecked, portable, independently verified %s package', async template => {
  const artifacts = resolve('artifacts'); await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'plugin-scaffold-')), target = join(directory, 'example-plugin');
  try {
    await createPlugin(target, template);
    execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--project', join(target, 'tsconfig.json')], { windowsHide: true, encoding: 'utf8' });
    const built = await buildPlugin(target);
    expect((await verifyPlugin(built.canonical)).integrity).toBe(built.integrity);
    expect(built.pkg.manifest.apiVersion).toBe(1);
    expect(built.pkg.manifest.permissions).toEqual(template === 'vanilla' ? ['documents.read'] : ['documents.read', 'ui']);
    if (template !== 'vanilla') {
      expect(built.pkg.ui.main.source).toContain('Permission is hereby granted');
      expect(built.pkg.ui.main.html).toContain('id="app"'); expect(built.pkg.ui.main.css).toContain('system-ui');
    }
    await expect(createPlugin(target, template)).rejects.toThrow();
    expect(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).id).toBe('example-plugin');
  } finally {
    if (!resolve(directory).startsWith(artifacts + sep)) throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  }
// This integration test starts tsc and bundles a real plugin, including React/Vue.
}, 30_000);

it('packs deterministic v2 ZIP archives with assets/bin and strips $schema from manifest.json', async () => {
  const artifacts = resolve('artifacts');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'plugin-zip-'));
  const target = join(directory, 'zip-plugin');
  try {
    await createPlugin(target, 'vanilla');
    const manifestPath = join(target, 'manifest.json');
    const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
    raw.$schema = 'https://tano.page/schemas/manifest.schema.json';
    await writeFile(manifestPath, JSON.stringify(raw, null, 2));

    await mkdir(join(target, 'assets', 'bin'), { recursive: true });
    const binPayload = new Uint8Array([1, 2, 3, 4, 5]);
    await writeFile(join(target, 'assets', 'bin', 'dict.bin'), binPayload);

    const first = await buildPluginZip(target);
    const second = await buildPluginZip(target);
    expect(first.archiveDigest).toBe(second.archiveDigest);
    expect(first.archiveBytes).toEqual(second.archiveBytes);

    const verified = await verifyPlugin(first.archiveBytes);
    expect(verified.packageVersion).toBe(2);
    expect(verified.integrity).toBe(first.integrity);
    expect(verified.archiveDigest).toBe(first.archiveDigest);
    expect(verified.binaryAssets['dict.bin']).toEqual(binPayload);
    expect('$schema' in verified.pkg.manifest).toBe(false);
  } finally {
    if (!resolve(directory).startsWith(artifacts + sep)) throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
