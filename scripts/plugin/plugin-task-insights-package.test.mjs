import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPlugin, verifyPlugin } from './plugin-build.mjs';

it('ships an installable React/Chart.js package with bundled styles, licenses and read-only permissions', async () => {
  const result = await buildPlugin(resolve('examples/plugins/task-insights'));
  expect(result.pkg.manifest.permissions).toEqual(['objects.read', 'ui']);
  expect(result.pkg.manifest.networkOrigins).toEqual([]);
  expect((await verifyPlugin(result.canonical)).integrity).toBe(result.integrity);
  expect(Buffer.byteLength(result.canonical)).toBeLessThan(4 * 1024 * 1024);
  expect(result.pkg.ui.dashboard.css).toContain('.chart');
  // Text imports must remain inside the package, including the actual installed licenses.
  const notices = await readFile('examples/plugins/task-insights/THIRD_PARTY_NOTICES.txt', 'utf8');
  for (const name of ['react', 'react-dom', 'scheduler', 'chart.js', '@kurkle/color']) {
    const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
    expect(notices).toContain(`${name}@${pkg.version}`);
    expect(result.pkg.ui.dashboard.source).toContain(`${name}@${pkg.version}`);
  }
  expect(result.pkg.ui.dashboard.source).toContain('Permission is hereby granted');
});
