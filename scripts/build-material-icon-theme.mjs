import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { verifyPlugin } from './plugin-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '5.40.0';
const url = `https://registry.npmjs.org/material-icon-theme/-/material-icon-theme-${version}.tgz`;
const integrity = 'IrvgusbwtqxhUtVgUy0nToJcfN7CYVRdbBxKMfbo0vab9flVBHA5INZ9UiE5SgRj+PM6opCl5nn5TZdpm2UaxA==';
const target = join(root, 'examples/plugins/material-icon-theme');
const temporary = await mkdtemp(join(tmpdir(), 'tano-material-theme-'));
try {
  // Optional archive path supports offline rebuilding; the same pinned digest is required.
  const archive = process.argv[2] ? await readFile(resolve(process.argv[2])) : await (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Material Icon Theme download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  })();
  if (createHash('sha512').update(archive).digest('base64') !== integrity) throw new Error('Upstream archive integrity mismatch');
  const archivePath = join(temporary, 'source.tgz');
  await writeFile(archivePath, archive);
  execFileSync('tar', ['-xf', archivePath, '-C', temporary]);
  const source = join(temporary, 'package');
  const upstream = JSON.parse(await readFile(join(source, 'dist/material-icons.json'), 'utf8'));
  const license = await readFile(join(source, 'LICENSE'), 'utf8');
  const icons = {}, images = new Map(), pairs = new Map();
  const image = async name => {
    if (!images.has(name)) {
      const path = resolve(source, 'dist', upstream.iconDefinitions[name].iconPath);
      if (!path.startsWith(join(source, 'icons') + sep) || !path.endsWith('.svg')) throw new Error('Unexpected icon path');
      const png = await sharp(path).resize(64, 64).png({ palette: true, colours: 64, effort: 10 }).toBuffer();
      images.set(name, `data:image/png;base64,${png.toString('base64')}`);
    }
    return images.get(name);
  };
  const reference = async (normal, light = normal) => {
    const key = `${normal}|${light}`;
    if (!pairs.has(key)) {
      const id = `i-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
      if (Object.hasOwn(icons, id)) throw new Error('Icon ID collision');
      icons[id] = { color: 'currentColor', paths: [], silhouette: 'none', image: await image(normal),
        ...(light === normal ? {} : { lightImage: await image(light) }) };
      pairs.set(key, id);
    }
    return pairs.get(key);
  };
  const theme = { id: 'material', label: 'Material Icon Theme', notice: `Material Icon Theme ${version}\n${url}\n\n${license}`, icons };
  for (const field of ['file', 'folder', 'folderExpanded']) theme[field] = await reference(upstream[field]);
  for (const field of ['fileNames', 'fileExtensions', 'folderNames', 'folderNamesExpanded']) {
    theme[field] = {};
    for (const [name, icon] of Object.entries(upstream[field])) {
      // VS Code also accepts path-qualified associations; Tano matches basenames only.
      if (/[\/\\]/.test(name)) continue;
      const normalized = name.toLowerCase();
      const id = await reference(icon, upstream.light?.[field]?.[name] ?? icon);
      if (Object.hasOwn(theme[field], normalized) && theme[field][normalized] !== id) throw new Error(`Case collision: ${name}`);
      theme[field][normalized] = id;
    }
  }
  const manifest = { manifestVersion: 1, id: 'material-icon-theme', name: 'Material 文件图标', version: '1.0.0',
    description: `Material Icon Theme ${version} 的同页独立适配版（非官方）。彩色文件与目录图标，支持目录展开和深浅色变体；离线可用，无脚本权限。原作：Material Extensions，MIT。`,
    objectTypes: [], relationTypes: [], appearance: { version: 2, icons: [theme] } };
  const { canonical, integrity: digest } = await verifyPlugin(JSON.stringify({ packageVersion: 1, manifest }));
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(target, 'material-icon-theme-1.0.0.tano-plugin.json'), canonical + '\n');
  await writeFile(join(target, 'LICENSE'), license);
  await writeFile(join(target, 'upstream.json'), JSON.stringify({ version, url, integrity: `sha512-${integrity}`,
    rendering: '64×64 PNG, 64-color palette', icons: Object.keys(icons).length,
    associations: Object.fromEntries(['fileNames', 'fileExtensions', 'folderNames', 'folderNamesExpanded'].map(field => [field, Object.keys(theme[field]).length])),
    bytes: Buffer.byteLength(canonical), sha256: digest }, null, 2) + '\n');
  console.log(`Built ${Object.keys(icons).length} icons; ${Buffer.byteLength(canonical)} bytes; SHA-256 ${digest}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
