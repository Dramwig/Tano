import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { workspaceEmojiGroups, workspaceBuiltinIconGroups } from '../packages/workbench/src/workspace-icons.ts';
import { workspaceEmojiCodepoint } from '../packages/workbench/src/workspace-emoji-codepoint.ts';

const version = '17.0.3';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages/workbench/src/assets/emoji/twemoji');
const prefix = `twemoji-${version}/`;
const source = `https://github.com/jdecked/twemoji/tree/v${version}`;
const archiveUrl = `https://codeload.github.com/jdecked/twemoji/zip/refs/tags/v${version}`;
const groups = [...workspaceEmojiGroups, ...workspaceBuiltinIconGroups];
const codepoints = [...new Set([
  ...workspaceEmojiGroups.flatMap(group => group.icons.map(icon => workspaceEmojiCodepoint(icon.value))),
  ...groups.map(group => workspaceEmojiCodepoint(group.symbol)),
])].sort();
const paths = new Set([
  ...codepoints.map(id => `${prefix}assets/svg/${id}.svg`),
  `${prefix}LICENSE-GRAPHICS`,
]);

const response = await fetch(archiveUrl);
if (!response.ok) throw new Error(`Cannot download Twemoji: HTTP ${response.status}`);
const archive = new Uint8Array(await response.arrayBuffer());
const files = unzipSync(archive, { filter: file => paths.has(file.name) });
for (const path of paths) if (!files[path]) throw new Error(`Missing upstream asset: ${path}`);

await mkdir(target, { recursive: true });
const assets = {};
for (const id of codepoints) {
  const bytes = files[`${prefix}assets/svg/${id}.svg`];
  await writeFile(join(target, `${id}.svg`), bytes);
  assets[`${id}.svg`] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(join(target, 'LICENSE-GRAPHICS'), files[`${prefix}LICENSE-GRAPHICS`]);
await writeFile(join(target, 'manifest.json'), JSON.stringify({
  version, source, archiveUrl,
  archiveSha256: createHash('sha256').update(archive).digest('hex'),
  assets,
}, null, 2) + '\n');
await writeFile(join(target, 'README.md'), `# Bundled workspace emoji

These ${codepoints.length} unmodified SVGs come from [Twemoji ${version}](${source}).
Copyright Twitter, Inc. and other Twemoji contributors. Graphics are licensed
under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The full license is retained in [LICENSE-GRAPHICS](LICENSE-GRAPHICS).

Tano rasterizes these sources to 64-pixel RGBA artwork and packs them into one
lossless [WebP sprite](sprite.webp), with 4-pixel transparent gutters per cell.
This rasterization and arrangement are the only modifications; artwork colors
are preserved. [sprite.json](sprite.json) records the grid, coordinates, and
output hash. The browser loads this single local image for the picker, category
directory, and workspace icons; the SVGs are generation sources only.
Resources work offline. Workspace settings continue to store Unicode emoji
strings. Unbundled custom symbols fall back to the system emoji font.
Localized names and search tags are described in the separately licensed
[metadata catalog](../emojibase/README.md).

Regenerate the catalog subset from the pinned release with
\`node scripts/sync-workspace-emoji.mjs\`, which also rebuilds the sprite.
To rebuild offline from retained SVGs, run \`npm run emoji:generate\`.
\`npm run emoji:check\` verifies source hashes, catalog coordinates, and the
generated image. Source archive and per-file SHA-256 hashes are recorded in
[manifest.json](manifest.json). No SVG source artwork is changed.
`);
console.log(`Bundled ${codepoints.length} Twemoji ${version} SVGs with license and source hashes.`);
await import('./build-workspace-emoji-sprite.mjs');
