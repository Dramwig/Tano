import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { buildPlugin, verifyPlugin } from './plugin-build.mjs';

it('packages the installable daily report with its independent background entry', async () => {
  const result = await buildPlugin(resolve('examples/plugins/daily-report'));
  expect(result.pkg.manifest.automations).toEqual([{ id: 'daily', label: '生成工作区日报' }]);
  expect(result.pkg.automationSource).toContain('documents.create');
  expect((await verifyPlugin(result.canonical)).integrity).toBe(result.integrity);
});

it('packages independent browser and server entries and binds server changes to the version digest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tano-plugin-automation-'));
  try {
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ manifestVersion: 2, apiVersion: 1, id: 'report', name: '报告', version: '1.0.0',
      description: '', objectTypes: [], relationTypes: [], permissions: ['documents.read'], commands: [], views: [], automations: [{ id: 'daily', label: '日报' }] }));
    await writeFile(join(directory, 'main.ts'), 'export default async function(tano) { await tano.notify("foreground"); }');
    await writeFile(join(directory, 'automation.ts'), 'export default async function(tano, execution) { return { entries: await tano.documents.list(), id: execution.runId }; }');
    const first = await buildPlugin(directory);
    expect(first.pkg.automationSource).toContain('TanoAutomation.default(tano, execution)');
    expect(first.pkg.source).not.toContain('execution.runId');
    expect(first.pkg.automationSource).not.toContain('foreground');
    expect((await verifyPlugin(first.canonical)).integrity).toBe(first.integrity);
    await writeFile(join(directory, 'automation.ts'), 'export default async function() { return { changed: true }; }');
    expect((await buildPlugin(directory)).integrity).not.toBe(first.integrity);
    await writeFile(join(directory, 'automation.ts'), 'import fs from "node:fs"; export default () => fs.readFileSync("/etc/passwd");');
    await expect(buildPlugin(directory)).rejects.toThrow();
  } finally {
    const absolute = resolve(directory), base = resolve(tmpdir()) + sep;
    if (!absolute.startsWith(base) || !absolute.slice(base.length).startsWith('tano-plugin-automation-')) throw new Error('Unsafe test cleanup');
    await rm(absolute, { recursive: true, force: true });
  }
});
