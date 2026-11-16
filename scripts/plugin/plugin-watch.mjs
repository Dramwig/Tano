import { watch } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildPlugin } from './plugin-build.mjs';

/** Serves only the in-memory build on loopback, with a per-process secret and exact Origin. */
export async function startPluginWatch(directory, { origin, port = 0, log = () => {} }) {
  if (origin !== 'tauri://localhost' && (typeof origin !== 'string' || !/^https?:\/\//.test(origin) || new URL(origin).origin !== origin)) throw new Error('--origin must be the exact HTTP(S) or tauri://localhost origin of the Tano application');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid development port');
  const token = randomBytes(24).toString('hex'), path = `/${token}/package.json`;
  let latest, error = '', closed = false, building = false, dirty = false, timer;
  async function rebuild() {
    if (closed) return;
    if (building) { dirty = true; return; }
    building = true;
    do {
      dirty = false;
      try { latest = await buildPlugin(directory); error = ''; log(`Built ${latest.pkg.manifest.id}@${latest.pkg.manifest.version} ${latest.integrity.slice(0, 12)}`); }
      catch (cause) { error = String(cause).slice(0, 2000); log(error); }
    } while (dirty && !closed);
    building = false;
  }
  await rebuild();
  const server = createServer((request, response) => {
    const address = server.address();
    if (request.headers.host !== `127.0.0.1:${address.port}` || request.headers.origin !== origin || request.url !== path || !['GET', 'OPTIONS'].includes(request.method)) {
      response.writeHead(403, { 'Cache-Control': 'no-store' }); response.end(); return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Access-Control-Expose-Headers', 'ETag');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET'); response.setHeader('Access-Control-Allow-Headers', 'If-None-Match');
      response.setHeader('Access-Control-Allow-Private-Network', 'true'); response.writeHead(204); response.end(); return;
    }
    if (error || !latest) { response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(error || 'Build not ready'); return; }
    const etag = `"${latest.integrity}"`; response.setHeader('ETag', etag);
    if (request.headers['if-none-match'] === etag) { response.writeHead(304); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); response.end(latest.canonical);
  });
  server.headersTimeout = 5000; server.requestTimeout = 5000; server.maxConnections = 16;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let watcher;
  try {
    watcher = watch(directory, { recursive: true }, (_event, filename) => {
      if (filename && (/(^|[/\\])(node_modules|\.git)([/\\]|$)/.test(filename) || /\.tano-plugin\.json$/.test(filename))) return;
      clearTimeout(timer); timer = setTimeout(() => { void rebuild(); }, 150);
    });
  } catch (cause) { server.closeAllConnections(); server.close(); throw cause; }
  return { url: `http://127.0.0.1:${server.address().port}${path}`, async close() {
    if (closed) return; closed = true; clearTimeout(timer); watcher.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
