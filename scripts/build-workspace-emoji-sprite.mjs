import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { workspaceEmojiGroups, workspaceBuiltinIconGroups } from '../packages/workbench/src/workspace-icons.ts';
import { workspaceEmojiCodepoint } from '../packages/workbench/src/workspace-emoji-codepoint.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages/workbench/src/assets/emoji/twemoji');
const sourceManifest = await readFile(join(target, 'manifest.json'));
const source = JSON.parse(sourceManifest);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const groups = [...workspaceEmojiGroups, ...workspaceBuiltinIconGroups];
const ids = [...new Set([
  ...workspaceEmojiGroups.flatMap(group => group.icons.map(icon => workspaceEmojiCodepoint(icon.value))),
  ...groups.map(group => workspaceEmojiCodepoint(group.symbol)),
])].sort();
const artworkSize = 64;
const padding = 4;
const cellSize = artworkSize + padding * 2;
const columns = Math.ceil(Math.sqrt(ids.length));
const rows = Math.ceil(ids.length / columns);
const width = columns * cellSize;
const height = rows * cellSize;
const cells = Object.fromEntries(ids.map((id, index) => [id, [index % columns, Math.floor(index / columns)]]));
const metadata = {
  version: source.version, source: source.source, sourceManifestSha256: hash(sourceManifest),
  image: 'sprite.webp', columns, rows, cellSize, artworkSize, padding, cells,
};
const inputs = [];
for (const id of ids) {
  const bytes = await readFile(join(target, `${id}.svg`));
  if (hash(bytes) !== source.assets[`${id}.svg`]) throw new Error(`Upstream artwork hash mismatch: ${id}`);
  inputs.push(bytes);
}

if (process.argv.includes('--check')) {
  const bytes = await readFile(join(target, metadata.image));
  const saved = JSON.parse(await readFile(join(target, 'sprite.json'), 'utf8'));
  const { sha256, ...savedMetadata } = saved;
  const image = await sharp(bytes).metadata();
  if (JSON.stringify(savedMetadata) !== JSON.stringify(metadata) || sha256 !== hash(bytes)
    || image.width !== width || image.height !== height || image.format !== 'webp' || !image.hasAlpha) {
    throw new Error('Workspace emoji sprite is stale. Run npm run emoji:generate.');
  }
  console.log(`Verified ${ids.length} emoji cells and local WebP sprite (${width} × ${height}).`);
} else {
  // Copy RGBA pixels directly so semi-transparent artwork never gets recolored by compositing.
  const pixels = Buffer.alloc(width * height * 4);
  for (const [index, svg] of inputs.entries()) {
    const tile = await sharp(svg, { density: 144 }).resize(artworkSize, artworkSize).ensureAlpha().raw().toBuffer();
    const [column, row] = cells[ids[index]];
    for (let y = 0; y < artworkSize; y++) {
      tile.copy(pixels, ((row * cellSize + padding + y) * width + column * cellSize + padding) * 4,
        y * artworkSize * 4, (y + 1) * artworkSize * 4);
    }
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
  await writeFile(join(target, metadata.image), bytes);
  await writeFile(join(target, 'sprite.json'), JSON.stringify({ ...metadata, sha256: hash(bytes) }, null, 2) + '\n');
  console.log(`Packed ${ids.length} Twemoji into one ${width} × ${height} lossless WebP (${Math.round(bytes.length / 1024)} KiB).`);
}
