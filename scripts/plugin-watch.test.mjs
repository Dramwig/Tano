import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startPluginWatch } from './plugin-watch.mjs';
import { buildPlugin, verifyPlugin } from './plugin-build.mjs';

it('serves only the requested origin and secret path, rebuilds, recovers and supports conditional requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tano-plugin-watch-'));
  const origin = 'http://127.0.0.1:43845';
  let watcher;
  try {
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ manifestVersion: 2, apiVersion: 1, id: 'watch-test', name: '开发示例', version: '1.0.0',
      description: '', objectTypes: [], relationTypes: [], permissions: [], commands: [], views: [] }));
    await writeFile(join(directory, 'main.ts'), 'export default async function(tano) { await tano.notify("first-build"); }');
    const built = await buildPlugin(directory);
    expect((await verifyPlugin(built.canonical)).integrity).toBe(built.integrity);
    watcher = await startPluginWatch(directory, { origin });
    const request = (headers = {}, url = watcher.url, method = 'GET') => fetch(url, { headers: { Origin: origin, ...headers }, method });
    const first = await request(); expect(first.status).toBe(200);
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect((await verifyPlugin(await first.text())).integrity).toBe(built.integrity);
    expect((await request({ 'If-None-Match': first.headers.get('ETag') })).status).toBe(304);
    expect((await request({ Origin: 'https://untrusted.invalid' })).status).toBe(403);
    const wrongHostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(watcher.url, { headers: { Host: 'evil.invalid', Origin: origin } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(wrongHostStatus).toBe(403);
    expect((await fetch(watcher.url)).status).toBe(403);
    expect((await request({}, new URL('/manifest.json', watcher.url))).status).toBe(403);
    expect((await request({}, watcher.url, 'POST')).status).toBe(403);
    const preflight = await request({}, watcher.url, 'OPTIONS'); expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('If-None-Match');
    await writeFile(join(directory, 'main.ts'), 'export default function BROKEN {');
    await expect.poll(async () => (await request()).status, { timeout: 5000 }).toBe(503);
    await writeFile(join(directory, 'main.ts'), 'export default async function(tano) { await tano.notify("second-build"); }');
    await expect.poll(async () => { const response = await request(); return response.ok ? (await response.json()).source : ''; }, { timeout: 5000 }).toContain('second-build');
    const second = await request(); expect(second.headers.get('ETag')).not.toBe(first.headers.get('ETag'));
    await watcher.close(); await expect(request()).rejects.toThrow();
  } finally {
    await watcher?.close();
    const absolute = resolve(directory), root = resolve(tmpdir()) + sep;
    if (!absolute.startsWith(root) || !absolute.slice(root.length).startsWith('tano-plugin-watch-')) throw new Error('Unsafe test cleanup path');
    await rm(absolute, { recursive: true, force: true });
  }
}, 15000);
