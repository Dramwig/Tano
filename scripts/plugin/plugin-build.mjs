import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let parser;
export async function protocol() {
  if (!parser) {
    const built = await build({ entryPoints: [join(root, 'packages/protocol/src/index.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
    parser = import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  }
  return parser;
}
async function collectBinaryAssets(dir, prefix = '', out = {}) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return out; throw error; }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectBinaryAssets(full, rel, out);
    } else if (entry.isFile()) {
      out[rel] = new Uint8Array(await readFile(full));
    }
  }
  return out;
}
export async function verifyPlugin(content) {
  const { parsePluginPackage, canonicalPluginJson, isPluginArchiveV2Bytes, unpackPluginArchiveV2 } = await protocol();
  if (content instanceof Uint8Array && isPluginArchiveV2Bytes(content)) {
    const archive = unpackPluginArchiveV2(content);
    const canonical = canonicalPluginJson(archive.pkg);
    return {
      pkg: archive.pkg,
      canonical,
      integrity: createHash('sha256').update(canonical).digest('hex'),
      archiveDigest: createHash('sha256').update(content).digest('hex'),
      binaryAssets: archive.binaryAssets,
      packageVersion: 2,
    };
  }
  const text = content instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: true }).decode(content) : content;
  const pkg = parsePluginPackage(text), canonical = canonicalPluginJson(pkg);
  return { pkg, canonical, integrity: createHash('sha256').update(canonical).digest('hex'), packageVersion: 1 };
}
export async function buildPlugin(target) {
  const { parsePluginManifest, parsePluginPackage, externalizeHeavyIconAssets } = await protocol();
  const rawManifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
  if (rawManifest && typeof rawManifest === 'object' && !Array.isArray(rawManifest)) {
    delete rawManifest.$schema;
  }
  const manifest = parsePluginManifest(rawManifest);
  const binaryAssets = await collectBinaryAssets(join(target, 'assets', 'bin'));
  if (manifest.manifestVersion === 1) {
    const pkg = externalizeHeavyIconAssets(parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest })));
    return { ...(await verifyPlugin(JSON.stringify(pkg))), binaryAssets };
  }
  const bundled = await build({ entryPoints: [join(target, 'main.ts')], bundle: true, platform: 'browser', format: 'iife', globalName: 'TanoPlugin', write: false, logLevel: 'silent', target: 'es2022' });
  let entries = [];
  try { entries = await readdir(join(target, 'ui')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const ui = {};
  for (const entry of entries.filter(name => /\.(ts|tsx|js|jsx)$/.test(name))) {
    const id = entry.replace(/\.(ts|tsx|js|jsx)$/, '');
    if (manifest.manifestVersion !== 2 || !manifest.views.some(view => view.id === id)) throw new Error(`UI entry ${entry} has no declared view`);
    if (Object.hasOwn(ui, id)) throw new Error(`Duplicate UI entry for ${id}`);
    const built = await build({ entryPoints: [join(target, 'ui', entry)], outfile: join(target, 'ui', 'bundle.js'), bundle: true,
      platform: 'browser', format: 'iife', globalName: 'TanoPluginView', write: false, minify: true, target: 'es2022', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
      loader: { '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.txt': 'text' }, logLevel: 'silent' });
    const optional = async extension => { try { return await readFile(join(target, 'ui', `${id}.${extension}`), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } };
    ui[id] = { html: await optional('html'), css: (built.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '') + await optional('css'),
      source: `${built.outputFiles.find(file => file.path.endsWith('.js')).text}\nawait TanoPluginView.default(tanoView);` };
  }
  let automationSource;
  if (manifest.manifestVersion === 2 && manifest.automations?.length) {
    const automation = await build({ entryPoints: [join(target, 'automation.ts')], bundle: true, platform: 'neutral', format: 'iife', globalName: 'TanoAutomation',
      write: false, logLevel: 'silent', target: 'es2022' });
    automationSource = `${automation.outputFiles[0].text}\nreturn await TanoAutomation.default(tano, execution);`;
  }
  const pkg = externalizeHeavyIconAssets(parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest, source: `${bundled.outputFiles[0].text}\nif (typeof TanoPlugin.deactivate === 'function') tano.lifecycle.onDeactivate(() => TanoPlugin.deactivate());\nawait TanoPlugin.default(tano);`, ...(Object.keys(ui).length ? { ui } : {}), ...(automationSource ? { automationSource } : {}) })));
  return { ...(await verifyPlugin(JSON.stringify(pkg))), binaryAssets };
}
export async function buildPluginZip(target) {
  const { packPluginArchiveV2 } = await protocol();
  const built = await buildPlugin(target);
  const archiveBytes = packPluginArchiveV2({ pkg: built.pkg, binaryAssets: built.binaryAssets });
  const archiveDigest = createHash('sha256').update(archiveBytes).digest('hex');
  return { ...built, archiveBytes, archiveDigest, packageVersion: 2 };
}
