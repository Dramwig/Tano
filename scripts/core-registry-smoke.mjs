// Install the actual staged archives through an isolated npm registry before publication.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'artifacts/core-registry');
const manifest = JSON.parse(await readFile(join(directory, 'core-registry.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
if (!npmCli?.endsWith('.js')) throw new Error('Run through npm run core:registry:smoke -- <artifact-directory>');
const project = await mkdtemp(join(tmpdir(), 'tano-registry-install-'));
const verifiedProject = await realpath(project);
const logDirectory = join(directory, 'smoke');
await mkdir(logDirectory, { recursive: true });
await writeFile(join(logDirectory, 'summary.json'), JSON.stringify({ sourceCommit: manifest.sourceCommit, passed: [], status: 'running' }) + '\n');
const packages = new Map();
for (const item of manifest.packages) {
  const { execFileSync } = await import('node:child_process');
  const pkg = JSON.parse(execFileSync('tar', ['-xOzf', join(directory, item.file), 'package/package.json'], { encoding: 'utf8' }));
  packages.set(item.publishedName, { item, pkg, bytes: await readFile(join(directory, item.file)) });
}
let origin;
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, origin).pathname).slice(1);
  if (path.startsWith('archives/')) {
    const pkg = [...packages.values()].find(p => p.item.file === path.slice(9));
    if (pkg) { response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(pkg.bytes); return; }
  }
  const pkg = packages.get(path);
  if (!pkg) { response.writeHead(404); response.end(); return; }
  const metadata = { ...pkg.pkg, dist: { integrity: pkg.item.integrity, tarball: `${origin}/archives/${pkg.item.file}` } };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ name: pkg.pkg.name, 'dist-tags': { latest: pkg.pkg.version }, versions: { [pkg.pkg.version]: metadata } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const run = async (name, command, args, cwd = project) => {
  const { createWriteStream } = await import('node:fs');
  const log = createWriteStream(join(logDirectory, `${name}.log`));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, windowsHide: true });
      child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`${name} failed (${code}); see ${join(logDirectory, `${name}.log`)}`)));
    });
  } finally { await new Promise(resolve => log.end(resolve)); }
};
try {
  const scopes = new Set(manifest.packages.map(p => p.publishedName.split('/')[0]));
  await writeFile(join(project, '.npmrc'), [...scopes].map(scope => `${scope}:registry=${origin}`).join('\n') + '\n');
  const dependencies = Object.fromEntries(manifest.packages.map(p => [p.name,
    p.name === p.publishedName ? p.version : `npm:${p.publishedName}@${p.version}`]));
  const devDependencies = {};
  for (const name of ['vite', '@vitejs/plugin-vue', 'vue', 'pinia'])
    devDependencies[name] = JSON.parse(await readFile(resolve('node_modules', name, 'package.json'), 'utf8')).version;
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'tano-registry-smoke', private: true, type: 'module', dependencies,
    devDependencies }, null, 2));
  await run('install', process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund']);
  for (const item of manifest.packages) {
    const pkg = JSON.parse(await readFile(join(project, 'node_modules', item.name, 'package.json'), 'utf8'));
    assert.equal(pkg.name, item.publishedName); assert.equal(pkg.version, manifest.version);
    assert.equal(pkg.tanoCore.sourceCommit, manifest.sourceCommit);
  }
  await writeFile(join(project, 'index.html'), '<div id="app"></div><script type="module" src="/main.ts"></script>');
  await writeFile(join(project, 'main.ts'), `import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Workbench from '@tano/workbench';
import Editor from '@tano/editor';
import { mergeMarkdown } from '@tano/markdown';
import * as protocol from '@tano/protocol';
console.log(Editor, protocol, mergeMarkdown('a', 'a', 'b'));
createApp(Workbench).use(createPinia()).mount('#app');\n`);
  // Match the actual cloud consumer: absolute public asset URLs belong to its host.
  await writeFile(join(project, 'vite.config.mjs'), "import { defineConfig } from 'vite'; import vue from '@vitejs/plugin-vue'; export default defineConfig({ plugins: [vue({ template: { transformAssetUrls: { includeAbsolute: false } } })], build: { outDir: 'dist' } });\n");
  await run('build', process.execPath, [join(project, 'node_modules/vite/bin/vite.js'), 'build']);
  await run('mcp', process.execPath, [resolve('scripts/mcp-smoke.mjs'), join(project, 'node_modules/@tano/mcp/dist/tano-mcp.cjs')], process.cwd());
  await writeFile(join(logDirectory, 'summary.json'), JSON.stringify({ sourceCommit: manifest.sourceCommit,
    distributionSha256: createHash('sha256').update(await readFile(join(directory, 'core-registry.json'))).digest('hex'),
    passed: ['installation', 'workbench-production-build', 'mcp-roundtrip'] }, null, 2) + '\n');
  console.log(`PASS isolated registry installation, Vue/workbench production build and shipped MCP roundtrip: Core ${manifest.version}`);
} finally {
  await new Promise(resolve => server.close(resolve));
  if (await realpath(project) !== verifiedProject) throw new Error('Temporary installation directory changed; refusing cleanup');
  await rm(project, { recursive: true, force: true });
}
