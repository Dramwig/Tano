import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { corePackages, integrity, sha256 } from './core-distribution.mjs';
import { publishCore } from './publish-core.mjs';

const directories = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tano-core-publisher-')); directories.push(root);
  const out = join(root, 'artifacts/core-registry'); await mkdir(out, { recursive: true });
  const manifest = { format: 2, version: '0.8.2', dirty: false, sourceCommit: 'a'.repeat(40), npmRegistry: 'https://registry.npmjs.org/', packages: [] };
  for (const name of corePackages) {
    const bytes = Buffer.from(name), file = `${name}.tgz`; await writeFile(join(out, file), bytes);
    manifest.packages.push({ name: `@tano/${name}`, publishedName: `@tano.page/${name}`, version: manifest.version,
      file, sha256: sha256(bytes), integrity: integrity(bytes) });
  }
  const bytes = Buffer.from('native'); await writeFile(join(out, 'native.crate'), bytes);
  manifest.native = { name: 'tano-native', version: manifest.version, file: 'native.crate', sha256: sha256(bytes) };
  const manifestBytes = JSON.stringify(manifest);
  await writeFile(join(out, 'core-registry.json'), manifestBytes);
  await mkdir(join(out, 'smoke'));
  await writeFile(join(out, 'smoke/summary.json'), JSON.stringify({ sourceCommit: manifest.sourceCommit,
    distributionSha256: sha256(manifestBytes), passed: ['installation', 'workbench-production-build', 'mcp-roundtrip'] }));
  const evidencePath = join(out, 'evidence.json');
  await writeFile(evidencePath, JSON.stringify({ sourceCommit: manifest.sourceCommit,
    commands: ['npm run check', 'npm run test:native', 'npm run mcp:smoke', 'npm run core:registry:smoke'].map(command => ({ command, exitCode: 0 })) }));
  return { root, out, manifest, evidencePath };
}
it('retries a partial publication by skipping only identical existing versions', async () => {
  const f = await fixture(), published = [];
  const run = (command, args) => {
    if (command === 'git') return args[0] === 'rev-parse' ? f.manifest.sourceCommit : '';
    if (args[1] === 'view') {
      const item = f.manifest.packages.find(p => args[2].startsWith(p.publishedName + '@'));
      if (item === f.manifest.packages[0]) return JSON.stringify({ dist: { integrity: item.integrity }, tanoCore: { sourceCommit: f.manifest.sourceCommit } });
      const error = new Error('missing'); error.stderr = 'E404'; throw error;
    }
    if (args[1] === 'publish') published.push(args[2]);
    return 'dramwig';
  };
  await publishCore({ ...f, apply: true, npmCli: '/npm.js', run,
    fetchImpl: async () => Response.json({ version: { checksum: f.manifest.native.sha256 } }) });
  expect(published).toHaveLength(4);
  expect(published.some(path => path.endsWith('protocol.tgz'))).toBe(false);
});
it('rejects a version collision before any remote writes', async () => {
  const f = await fixture(), commands = [];
  const run = (command, args) => {
    commands.push({ command, args });
    if (command === 'git') return args[0] === 'rev-parse' ? f.manifest.sourceCommit : '';
    if (args[1] === 'view') return JSON.stringify({ dist: { integrity: 'different' } });
    return 'dramwig';
  };
  await expect(publishCore({ ...f, apply: true, npmCli: '/npm.js', run })).rejects.toThrow('different code');
  expect(commands.some(c => c.command === 'cargo' || c.args[1] === 'publish')).toBe(false);
});
it('rejects modified archives before contacting a registry', async () => {
  const f = await fixture(); await writeFile(join(f.out, 'editor.tgz'), 'tampered');
  await expect(publishCore({ ...f, npmCli: '/npm.js', run: () => { throw new Error('unexpected network'); } })).rejects.toThrow('artifact changed');
});
