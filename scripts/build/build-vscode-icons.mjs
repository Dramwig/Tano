import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import sharp from 'sharp';
import { verifyPlugin } from '../plugin/plugin-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const version = '13.0.0', commit = '866d4f48701ba71e39d309e9e519bcf2eaf1c3e2';
const rasterSize = 32;
const paletteColors = 32;
const url = `https://codeload.github.com/vscode-icons/vscode-icons/tar.gz/${commit}`;
const archiveHash = '29446f67bc94d3bdb8be6590d13c1194c84391790787e829e25cdb4b218eab78';
const target = join(root, 'examples/plugins/vscode-icons');
const temporary = await mkdtemp(join(tmpdir(), 'tano-vscode-icons-'));
try {
  const archive = process.argv[2] ? await readFile(resolve(process.argv[2])) : await (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`vscode-icons download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  })();
  if (createHash('sha256').update(archive).digest('hex') !== archiveHash) throw new Error('Upstream archive integrity mismatch');
  const archivePath = join(temporary, 'source.tgz');
  await writeFile(archivePath, archive);
  execFileSync('tar', ['-xf', archivePath, '-C', temporary]);
  const source = join(temporary, `vscode-icons-${commit}`);
  // Read only the upstream association catalogs and their language metadata.
  // Redirect the runtime enum import to avoid importing the extension or VS Code APIs.
  const catalogs = await build({ stdin: {
    contents: "export { extensions as files } from './supportedExtensions'; export { extensions as folders } from './supportedFolders';",
    resolveDir: join(source, 'src/iconsManifest'), loader: 'ts',
  }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  plugins: [{ name: 'association-data-only', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/models$/ }, () => ({ path: join(source, 'src/models/extensions/fileFormat.ts') }));
  } }] });
  const { files, folders } = await import(`data:text/javascript;base64,${Buffer.from(catalogs.outputFiles[0].text).toString('base64')}`);
  const license = await readFile(join(source, 'LICENSE'), 'utf8');
  const artworkNotice = `vscode-icons ${version}\nCopyright The vscode-icons Contributors\nSource: https://github.com/vscode-icons/vscode-icons/tree/${commit}\n\nArtwork license: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).\nhttps://creativecommons.org/licenses/by-sa/4.0/\nhttps://creativecommons.org/licenses/by-sa/4.0/legalcode\nChanges by Tano: converted SVG artwork into transparent ${rasterSize}x${rasterSize} PNGs with a ${paletteColors}-color palette (no dithering); adapted file associations for Tano. These artwork adaptations remain CC BY-SA 4.0.\nBranded icons retain their respective copyright licenses and trademarks, as stated by upstream. No affiliation or endorsement is implied.\nThe separately licensed LSPosed/xposed artwork is omitted; its associations use the generic file fallback.\n\nUpstream source code license:\n${license}`;
  const icons = {}, images = new Map(), pairs = new Map();
  const image = async filename => {
    if (!images.has(filename)) {
      const path = resolve(source, 'icons', filename);
      if (!path.startsWith(join(source, 'icons') + sep) || !path.endsWith('.svg')) throw new Error(`Unexpected icon path: ${filename}`);
      // Small UI artwork needs no dithering; keep both full themes within demo storage.
      const png = await sharp(path).resize(rasterSize, rasterSize).png({ palette: true, colours: paletteColors, dither: 0, effort: 10 }).toBuffer();
      images.set(filename, `data:image/png;base64,${png.toString('base64')}`);
    }
    return images.get(filename);
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
  const theme = { id: 'classic', label: 'vscode-icons', notice: artworkNotice, icons,
    fileNames: {}, fileExtensions: {}, folderNames: {}, folderNamesExpanded: {} };
  for (const [field, filename] of Object.entries({file:'default_file.svg', folder:'default_folder.svg', folderExpanded:'default_folder_opened.svg'})) {
    theme[field] = await reference(filename);
  }
  const sorted = collection => collection.supported.filter(item => item.icon && !item.disabled && item.icon !== 'xposed')
    .sort((a, b) => a.icon < b.icon ? -1 : a.icon > b.icon ? 1 : 0);
  const language = { fileNames: {}, fileExtensions: {} }, explicit = { fileNames: {}, fileExtensions: {} };
  const assign = (map, name, id) => {
    if (!name.trim() || /[\/\\]/.test(name)) return;
    // The host matches case-insensitively; match upstream's final assignment order.
    map[name.toLowerCase()] = id;
  };
  for (const item of sorted(files)) {
    if (item.format !== 0) throw new Error(`Unsupported file format: ${item.icon}`);
    const id = await reference(`file_type_${item.icon}.svg`, `file_type_${item.light ? 'light_' : ''}${item.icon}.svg`);
    for (const lang of item.languages ?? []) {
      for (const name of lang.knownExtensions ?? []) assign(language.fileExtensions, name, id);
      for (const name of lang.knownFilenames ?? []) assign(language.fileNames, name, id);
    }
    const names = [...(item.extensions ?? []), ...(item.filenamesGlob ?? []).flatMap(name => (item.extensionsGlob ?? []).map(ext => `${name}.${ext}`))];
    for (const name of names) assign(item.filename ? explicit.fileNames : explicit.fileExtensions, item.filename ? name : name.replace(/^\./, ''), id);
  }
  // Like upstream's Zed export: concrete file associations override known language suffixes.
  for (const field of ['fileNames', 'fileExtensions']) theme[field] = { ...language[field], ...explicit[field] };
  for (const item of sorted(folders)) {
    if (item.format !== 0) throw new Error(`Unsupported folder format: ${item.icon}`);
    for (const [field, suffix] of [['folderNames',''], ['folderNamesExpanded','_opened']]) {
      const id = await reference(`folder_type_${item.icon}${suffix}.svg`, `folder_type_${item.light ? 'light_' : ''}${item.icon}${suffix}.svg`);
      for (const name of item.extensions ?? []) assign(theme[field], name, id);
    }
  }
  // Do not carry unused alternate artwork into the installable package.
  const used = new Set([theme.file, theme.folder, theme.folderExpanded, ...['fileNames','fileExtensions','folderNames','folderNamesExpanded'].flatMap(field => Object.values(theme[field]))]);
  for (const id of Object.keys(icons)) if (!used.has(id)) delete icons[id];
  const manifest = { manifestVersion: 1, id: 'vscode-icons', name: 'vscode-icons 文件图标', version: '1.0.0',
    description: `vscode-icons ${version} 的同页独立适配版（非官方）。经典彩色文件与文件夹图标，支持展开与深浅色变体，离线可用，无脚本权限。图标：CC BY-SA 4.0，品牌图标保留各自权利；适配代码：MIT。`,
    objectTypes: [], relationTypes: [], appearance: { version: 2, icons: [theme] } };
  const { canonical, integrity } = await verifyPlugin(JSON.stringify({ packageVersion: 1, manifest }));
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(target, 'vscode-icons-1.0.0.tano-plugin.json'), canonical + '\n');
  await writeFile(join(target, 'LICENSE'), license);
  await writeFile(join(target, 'CC-BY-SA-4.0.txt'), await readFile(join(root, 'packages/workbench/src/assets/covers/CC-BY-SA-4.0.txt'), 'utf8'));
  await writeFile(join(target, 'NOTICE.txt'), artworkNotice + '\n');
  await writeFile(join(target, 'upstream.json'), JSON.stringify({ version, commit, url, archiveSha256: archiveHash,
    rendering: `${rasterSize}×${rasterSize} PNG, ${paletteColors}-color palette, no dithering`, artworkLicense: 'CC-BY-SA-4.0; branded artwork retains its respective licenses',
    excludedArtwork: ['file_type_xposed.svg'], icons: Object.keys(icons).length,
    associations: Object.fromEntries(['fileNames','fileExtensions','folderNames','folderNamesExpanded'].map(field => [field, Object.keys(theme[field]).length])),
    bytes: Buffer.byteLength(canonical), sha256: integrity }, null, 2) + '\n');
  console.log(`Built ${Object.keys(icons).length} icons; ${Buffer.byteLength(canonical)} bytes; SHA-256 ${integrity}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
