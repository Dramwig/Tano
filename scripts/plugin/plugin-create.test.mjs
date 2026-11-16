import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { createPlugin } from './plugin-create.mjs';
import { buildPlugin, verifyPlugin } from './plugin-build.mjs';

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
