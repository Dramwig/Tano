import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { verifyPlugin } from './plugin-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'examples/plugins/excalidraw');
const destination = join(root, 'packages/workbench/src/plugins/excalidraw');
const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
const fontsRoot = join(root, 'node_modules/@excalidraw/excalidraw/dist/prod');
const fonts = new Map();
for (const family of await readdir(join(fontsRoot, 'fonts'))) {
  if (family === 'Xiaolai') continue; // System CJK glyphs keep the offline package bounded.
  for (const name of await readdir(join(fontsRoot, 'fonts', family))) if (name.endsWith('.woff2')) {
    fonts.set(`./fonts/${family}/${name}`, `data:font/woff2;base64,${(await readFile(join(fontsRoot, 'fonts', family, name))).toString('base64')}`);
  }
}
const offlineFonts = { name: 'excalidraw-offline-fonts', setup(builder) {
  builder.onLoad({ filter: /@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/].*\.(js|css)$/ }, async ({ path }) => {
    // This plugin renders in Simplified Chinese; English fallback is inline in Excalidraw.
    if (/[\\/]locales[\\/]/.test(path) && !/[\\/]zh-CN-/.test(path)) return { contents: 'export default {};', loader: 'js' };
    let contents = await readFile(path, 'utf8');
    for (const [uri, data] of fonts) contents = contents.replaceAll(uri, data);
    // The tiny Excalifont subset contains no CJK glyphs, so the browser uses its
    // system fallback. A valid local font avoids both network and failed loads.
    const fallback = [...fonts.entries()].find(([uri]) => uri.includes('Excalifont') && uri.includes('623ccf'))?.[1];
    if (!fallback) throw new Error('Pinned offline fallback font is missing');
    contents = contents.replace(/\.\/fonts\/Xiaolai\/[^"'\s)]+\.woff2/g, fallback);
    return { contents, loader: path.endsWith('.css') ? 'css' : 'js', resolveDir: dirname(path) };
  });
} };
const uiOptions = { entryPoints: [join(folder, 'ui/board.tsx')], outfile: join(folder, 'ui/bundle.js'), bundle: true,
  platform: 'browser', format: 'iife', globalName: 'TanoExcalidraw', write: false, minify: true, target: 'es2022', jsx: 'automatic',
  conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.txt': 'text', '.woff2': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, plugins: [offlineFonts], metafile: true, logLevel: 'warning' };
await mkdir(folder, { recursive: true });
// First build discovers precisely the npm packages carried by this plugin.
try { await readFile(join(folder, 'THIRD_PARTY_NOTICES.txt')); }
catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(join(folder, 'THIRD_PARTY_NOTICES.txt'), 'Excalidraw for Tano\n'); }
const discovery = await build(uiOptions);
const names = new Map();
for (const input of Object.keys(discovery.metafile.inputs)) {
  const normalized = input.replaceAll('\\', '/'), index = normalized.lastIndexOf('node_modules/');
  if (index < 0) continue;
  const part = normalized.slice(index + 'node_modules/'.length);
  const name = part.startsWith('@') ? part.split('/').slice(0, 2).join('/') : part.split('/')[0];
  const path = resolve(root, normalized.slice(0, index) + 'node_modules/' + name);
  names.set(path, name);
}
const notices = ['Excalidraw for Tano\n\nExcalidraw and its bundled dependencies retain their original licenses.\nChinese text uses system fonts; Xiaolai is not bundled.\n', await readFile(join(folder, 'UPSTREAM_LICENSES.txt'), 'utf8')];
for (const [path] of [...names].sort(([a], [b]) => a.localeCompare(b))) {
  const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  const licenses = [];
  for (const file of await readdir(path, { withFileTypes: true })) if (file.isFile() && /^(licen[sc]e|copying|notice|ofl)([._-]|$)/i.test(file.name)) licenses.push(await readFile(join(path, file.name), 'utf8'));
  notices.push(`${pkg.name}@${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses)}\n${licenses.join('\n\n')}`);
}
await writeFile(join(folder, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n========================================\n\n') + '\n');
const [ui, worker] = await Promise.all([build(uiOptions), build({ entryPoints: [join(folder, 'main.ts')], bundle: true, platform: 'browser', format: 'iife', globalName: 'TanoPlugin', write: false, minify: true, target: 'es2022' })]);
const js = ui.outputFiles.find(file => file.path.endsWith('.js')).text + '\nexport default TanoExcalidraw.default;';
// Decode locally with a browser API and execute a blob module under the existing CSP.
// No eval, network, workers, or relaxed resource quotas are needed.
const compressed = gzipSync(js, { level: 9 }).toString('base64');
const source = `const bytes=Uint8Array.from(atob(${JSON.stringify(compressed)}),c=>c.charCodeAt(0));const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));const blob=await new Response(stream).blob();const url=URL.createObjectURL(new Blob([blob],{type:'text/javascript'}));try{await(await import(url)).default(tanoView)}finally{URL.revokeObjectURL(url)}`;
const pkg = { packageVersion: 1, manifest, source: worker.outputFiles[0].text + '\nawait TanoPlugin.default(tano);', ui: { board: { html: '', css: ui.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '', source } } };
const result = await verifyPlugin(JSON.stringify(pkg));
await mkdir(destination, { recursive: true });
await writeFile(join(destination, 'bundle.tano-plugin.json'), result.canonical + '\n');
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Excalidraw ${manifest.version}: ${Buffer.byteLength(result.canonical)} bytes, SHA-256 ${result.integrity}`);
