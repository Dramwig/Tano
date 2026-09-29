import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
// @ts-expect-error Release tooling runs directly in Node without a TypeScript build.
import { checkVersions, setVersions } from './version.mjs';

it('updates application manifests, workspace dependencies and both native lockfiles together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tano-version-'));
  const files = [
    'package.json', 'package-lock.json',
    'apps/client/src-tauri/tauri.conf.json',
    'apps/client/src-tauri/Cargo.toml', 'apps/client/src-tauri/Cargo.lock',
    'crates/tano-native/Cargo.toml', 'crates/tano-native/Cargo.lock',
  ];
  for (const parent of ['apps', 'packages']) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = `${parent}/${entry.name}/package.json`;
      try {
        await readFile(file);
        files.push(file);
      } catch { /* Standalone protocol packages are independently versioned. */ }
    }
  }
  try {
    for (const file of files) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await copyFile(file, join(root, file));
    }
    const initial = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
    expect(checkVersions(root)).toBe(initial);
    const originals = await Promise.all(files.map((file) => readFile(join(root, file), 'utf8')));
    expect(setVersions(root, initial)).toBe(initial);
    expect(await Promise.all(files.map((file) => readFile(join(root, file), 'utf8')))).toEqual(originals);
    expect(setVersions(root, '1.2.3')).toBe('1.2.3');
    expect(checkVersions(root, 'core-v1.2.3')).toBe('1.2.3');
    const client = JSON.parse(await readFile(join(root, 'apps/client/package.json'), 'utf8'));
    const editor = JSON.parse(await readFile(join(root, 'packages/editor/package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
    expect(client.dependencies['@tano/workbench']).toBe('1.2.3');
    expect(editor.dependencies['@tano/protocol']).toBe('^1.2.3');
    expect(lock.packages['apps/client'].dependencies['@tano/workbench']).toBe('1.2.3');
    expect(() => checkVersions(root, 'core-v1.2.4')).toThrow('Tag');
    expect(() => checkVersions(root, 'v1.2.3')).toThrow('Tag');
    client.version = '1.2.4';
    await writeFile(join(root, 'apps/client/package.json'), JSON.stringify(client));
    expect(() => checkVersions(root)).toThrow('apps/client');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
