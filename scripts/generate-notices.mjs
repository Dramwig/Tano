import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sections = ['Tano third-party notices\n\nThird-party code retains the licenses reproduced below. This inventory includes build and development dependencies. Lockfiles identify exact versions.'];
async function notices(folder) {
  const parts = [];
  for (const item of (await readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (item.isFile() && /^(licen[sc]e|copying|notice|copyright|ofl)([._-]|$)/i.test(item.name))
      parts.push(`${item.name}\n${await readFile(join(folder, item.name), 'utf8')}`);
    if (item.isDirectory() && /^(licenses|licences)$/i.test(item.name)) {
      for (const name of (await readdir(join(folder, item.name))).sort())
        parts.push(`${item.name}/${name}\n${await readFile(join(folder, item.name, name), 'utf8')}`);
    }
  }
  return parts.join('\n\n');
}
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
for (const [name, record] of Object.entries(lock.packages).sort(([a],[b]) => a.localeCompare(b))) {
  if (!name.includes('node_modules/') || record.link) continue;
  const folder = join(root, name);
  let pkg;
  try { pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && record.optional) continue; throw e; }
  const license = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'See package source');
  sections.push(`${pkg.name}@${pkg.version} (npm)\nLicense: ${license}\n${pkg.homepage ?? ''}\n\n${await notices(folder)}`);
}
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version=1', '--manifest-path', 'apps/client/src-tauri/Cargo.toml'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
for (const pkg of metadata.packages.filter(p => p.source).sort((a,b) => a.id.localeCompare(b.id))) {
  let body = await notices(dirname(pkg.manifest_path));
  if (!body && pkg.license_file) body = await readFile(resolve(dirname(pkg.manifest_path), pkg.license_file), 'utf8');
  sections.push(`${pkg.name}@${pkg.version} (Cargo)\nLicense: ${pkg.license ?? 'See package source'}\n${pkg.repository ?? ''}\n\n${body}`);
}
const text = sections.join('\n\n' + '='.repeat(78) + '\n\n') + '\n';
const iconNotices = await Promise.all([
  ['Lobe Icons @lobehub/icons-static-svg 1.95.1 (bundled model SVGs)', 'https://github.com/lobehub/lobe-icons', 'packages/workbench/src/assets/model-icons/lobehub'],
  ['Material Icon Theme 5.38.1 (bundled SVGs)', 'https://github.com/material-extensions/vscode-material-icon-theme', 'packages/editor/src/language-icons/material'],
  ['Devicon 7330accdbc47e2dc0c19789a48533c4a3c50fe58 (bundled SVGs)', 'https://github.com/devicons/devicon', 'packages/editor/src/language-icons/devicon'],
  ['Phosphor Icons 2b75f3ad12b420c9504ef05df8d2564a28f8500e (bundled duotone SVGs)', 'https://github.com/phosphor-icons/core', 'packages/editor/src/callout-icons/phosphor'],
  ['Twemoji 17.0.3 (local WebP sprite derived from original SVGs)', 'https://github.com/jdecked/twemoji/tree/v17.0.3', 'packages/workbench/src/assets/emoji/twemoji', 'CC-BY-4.0', 'LICENSE-GRAPHICS', 'Copyright Twitter, Inc. and other Twemoji contributors. Tano rasterizes and arranges the artwork in a lossless sprite sheet with transparent gutters; artwork colors are unchanged.'],
  ['Emojibase Data 17.0.0 (localized workspace emoji metadata)', 'https://github.com/milesj/emojibase', 'packages/workbench/src/assets/emoji/emojibase', 'MIT', 'LICENSE', 'Copyright (c) 2017-2019 Miles Johnson. Tano selects base emoji and combines Simplified Chinese and English names and search tags.'],
].map(async ([name, url, folder, license = 'MIT', licenseFile = 'LICENSE', attribution = '']) =>
  `${name}\nLicense: ${license}\n${url}\n${attribution}\n\n${await readFile(join(root, folder, licenseFile), 'utf8')}`,
));
for (const target of ['apps/client/public/THIRD_PARTY_NOTICES.txt', 'apps/mcp/THIRD_PARTY_NOTICES.txt']) {
  await mkdir(dirname(join(root, target)), { recursive: true });
  await writeFile(join(root, target), target.startsWith('apps/client/')
    ? text + '\n' + '='.repeat(78) + '\n\n' + iconNotices.join('\n\n' + '='.repeat(78) + '\n\n') + '\n'
    : text);
}
console.log(`Generated notices for ${sections.length - 1} dependencies.`);
